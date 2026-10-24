package space.aarondewindt.vela.companion

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject

@Composable
fun PairingCard() {
    val context = LocalContext.current
    val store = remember { DeviceCredentialStore(context) }
    val scope = rememberCoroutineScope()
    var origin by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("Android companion") }
    var sessionSecret by remember { mutableStateOf<String?>(null) }
    var pairingOrigin by remember { mutableStateOf<String?>(null) }
    var code by remember { mutableStateOf<String?>(null) }
    var expires by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Pair with Vela over HTTPS, then use Sync now below.") }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { block() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: DeviceRequestFailure) { message = failure.message ?: "Vela request failed." }
            catch (_: Exception) { message = "Connection or secure storage failed. Check HTTPS/server availability; retry or revoke the device in Vela and pair again." }
            finally { busy = false }
        }
    }
    Card {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Vela connection")
            Text(message)
            OutlinedTextField(value = origin, onValueChange = { origin = it }, label = { Text("HTTPS server origin") }, enabled = !busy)
            OutlinedTextField(value = name, onValueChange = { name = it.take(100) }, label = { Text("Device name") }, enabled = !busy)
            Button(enabled = !busy && name.isNotBlank(), onClick = { action {
                check(store.read() == null) { "Forget existing credentials before pairing" }
                val server = deviceOrigin(origin)
                val result = DeviceConnection(server).request("/api/devices/pairing/start", JSONObject().put("name", name).put("clientType", "android"))
                pairingOrigin = server
                sessionSecret = result.getString("sessionSecret")
                code = result.getString("code")
                expires = result.getString("expiresAt")
                message = "Open $server/settings/devices in your signed-in browser. Review the name and health:write permission."
            } }) { Text("Start pairing") }
            code?.let { Text("Pairing code: $it — expires $expires") }
            if (sessionSecret != null) Button(enabled = !busy, onClick = { action {
                val server = checkNotNull(pairingOrigin)
                val result = DeviceConnection(server).request("/api/devices/pairing/redeem", JSONObject().put("sessionSecret", sessionSecret))
                if (result.getString("status") == "pending") message = "Waiting for browser approval. Approve, then finish again."
                else {
                    HealthSync.mutex.withLock {
                        check(context.getSharedPreferences("health_sync", 0).edit().clear().commit())
                        store.save(server, result.getString("token"))
                    }
                    BackgroundSync.schedule(context)
                    sessionSecret = null
                    code = null
                    message = "Paired. Credential saved securely. No health data has been sent."
                }
            } }) { Text("Finish pairing after approval") }
            Button(enabled = !busy, onClick = { action {
                val saved = store.read()
                if (saved == null) message = "No saved credential."
                else {
                    DeviceConnection(saved.first).request("/api/devices/verify", token = saved.second)
                    message = "Connection verified with health:write permission. No health data sent."
                }
            } }) { Text("Check saved connection") }
            Button(enabled = !busy, onClick = { action {
                HealthSync.mutex.withLock {
                    store.clear()
                    check(context.getSharedPreferences("health_sync", 0).edit().clear().putBoolean("paused", true).commit())
                }
                BackgroundSync.cancel(context)
                sessionSecret = null
                code = null
                message = "Local credential forgotten. Revoke the device in Vela to remove server access."
            } }) { Text("Forget local credential") }
        }
    }
}
