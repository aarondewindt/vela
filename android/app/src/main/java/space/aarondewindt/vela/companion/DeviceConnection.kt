package space.aarondewindt.vela.companion

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.ByteArrayOutputStream
import java.net.URI
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Only ciphertext enters app-private, backup-disabled preferences. Keys never leave AndroidKeyStore. */
class DeviceCredentialStore(context: Context) {
    private val preferences = context.getSharedPreferences("device_credentials", Context.MODE_PRIVATE)
    private val alias = "vela.device.credentials.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    fun save(origin: String, token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val plain = JSONObject().put("origin", origin).put("token", token).toString().toByteArray(Charsets.UTF_8)
        val encrypted = cipher.doFinal(plain)
        check(preferences.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("data", Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit())
    }
    fun read(): Pair<String, String>? {
        val encrypted = preferences.getString("data", null) ?: return null
        val iv = preferences.getString("iv", null) ?: error("Credential storage unavailable")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
        val value = JSONObject(String(cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP)), Charsets.UTF_8))
        return value.getString("origin") to value.getString("token")
    }
    fun clear() { check(preferences.edit().clear().commit()) }
}

fun deviceOrigin(value: String): String {
    val uri = URI(value.trim())
    require(uri.scheme == "https" && !uri.host.isNullOrBlank() && uri.userInfo == null &&
        uri.query == null && uri.fragment == null && (uri.path.isNullOrEmpty() || uri.path == "/"))
    return URI("https", null, uri.host, uri.port, null, null, null).toASCIIString()
}

class DeviceRequestFailure(message: String, val status: Int? = null) : Exception(message)

/** No cookies, redirects, arbitrary trust managers or response-body logging. */
class DeviceConnection(val origin: String) {
    init { require(deviceOrigin(origin) == origin) }
    suspend fun request(path: String, body: JSONObject? = null, token: String? = null): JSONObject = withContext(Dispatchers.IO) {
        require(path in setOf("/api/devices/pairing/start", "/api/devices/pairing/redeem", "/api/devices/verify", "/api/health/ingest"))
        val connection = URI(origin + path).toURL().openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 15_000
            connection.readTimeout = 15_000
            connection.setRequestProperty("Accept", "application/json")
            token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
            if (body != null) {
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status != 200) throw DeviceRequestFailure(when (status) {
                    401 -> "Credential expired, revoked or already redeemed. Start pairing again if needed."
                    400 -> "Invalid health upload. Check phone date/time and update the companion app; inspect diagnostics before retrying."
                    403 -> "Vela requires HTTPS and health:write permission. Check server setup or pair again."
                    409 -> "Capture conflicts with a previous upload. Read Samsung Health again and retry sync."
                    413 -> "Upload too large. Update the companion app."
                    429 -> "Too many requests. Wait a minute and retry."
                    else -> "Vela request failed (HTTP $status)."
                }, status)
            val bytes = connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                val buffer = ByteArray(1024)
                while (output.size() <= 8192) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    output.write(buffer, 0, count)
                }
                output.toByteArray()
            }
            check(bytes.size <= 8192) { "Unexpected server response." }
            JSONObject(String(bytes, Charsets.UTF_8))
        } finally { connection.disconnect() }
    }
}
