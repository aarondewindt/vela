package space.aarondewindt.vela.companion

import android.content.Context
import android.os.Build
import android.os.SystemClock
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import space.aarondewindt.vela.companion.health.HealthFailure

/** Private bounded observational storage. It never reads or mutates the health outbox. */
class SyncHistory(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("sync_diagnostics", Context.MODE_PRIVATE)
    fun read(): List<JSONObject> = safe(emptyList()) {
        synchronized(lock) { prune(parse()).reversed().map { JSONObject(it.toString()) } }
    }
    fun update(entry: JSONObject) = safe(Unit) {
        synchronized(lock) {
            val entries = parse().filterNot { it.optString("id") == entry.getString("id") } + JSONObject(entry.toString())
            check(preferences.edit().putString("attempts", JSONArray(prune(entries)).toString()).commit())
        }
    }
    fun recoverInterrupted() = safe(Unit) {
        synchronized(lock) {
            val entries = prune(parse())
            entries.filter { it.optString("status") == "running" && it.optString("id") !in active }.forEach {
                // No end time/duration is available after process death: never invent one.
                it.put("status", "interrupted")
            }
            check(preferences.edit().putString("attempts", JSONArray(entries).toString()).commit())
        }
    }
    private fun parse(): List<JSONObject> {
        val rows = JSONArray(preferences.getString("attempts", "[]"))
        return (0 until rows.length()).map { rows.getJSONObject(it) }
    }
    private fun prune(entries: List<JSONObject>): List<JSONObject> {
        val cutoff = Instant.now().minusSeconds(7 * 86400)
        val kept = entries.filter { runCatching { Instant.parse(it.getString("createdAt")) >= cutoff }.getOrDefault(false) }
            .sortedBy { Instant.parse(it.getString("createdAt")) }.takeLast(100).toMutableList()
        while (kept.isNotEmpty() && JSONArray(kept).toString().toByteArray(Charsets.UTF_8).size > 192 * 1024) kept.removeAt(0)
        return kept
    }
    private fun <T> safe(fallback: T, block: () -> T): T = try { block() } catch (_: Exception) {
        storageFailed = true
        fallback
    }
    companion object {
        private val lock = Any()
        val active = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        @Volatile var storageFailed = false
    }
}

fun diagnosticAppVersion(context: Context): String = runCatching {
    @Suppress("DEPRECATION")
    val info = context.packageManager.getPackageInfo(context.packageName, 0)
    "${info.versionName} (${info.longVersionCode})"
}.getOrDefault("unavailable").take(80)

fun diagnosticCategory(error: Throwable): String = when (error) {
    is CancellationException -> "cancelled"
    is HealthFailure -> error.kind.name.lowercase()
    is IOException -> "network"
    is DeviceRequestFailure -> "http"
    is IllegalStateException, is org.json.JSONException -> "receipt"
    else -> "unknown"
}
fun diagnosticError(error: Throwable): JSONObject {
    val category = diagnosticCategory(error)
    // No exception messages, response bodies, URLs, tokens or uncontrolled stack traces.
    val detail = when (category) {
        "permission" -> "Required Samsung read permission is missing. Grant access in the app."
        "authorization" -> "Check Samsung Data Read developer mode and package/signing identity."
        "availability" -> "Install, enable and initialize a supported Samsung Health version."
        "query" -> "Samsung SDK query failed. Inspect query stage and SDK code when available."
        "network" -> "Network request failed before a valid response. Pending snapshot retained."
        "http" -> "Vela rejected the request or is unavailable. Inspect HTTP status."
        "receipt" -> "Receipt or durable storage validation failed. Pending snapshot retained."
        "cancelled" -> "Operation cancelled. Pending snapshot retained if present."
        else -> "Operation failed. Check secure storage, provider and phone date/time."
    }
    return JSONObject().put("category", category).put("detail", detail).apply {
        (error as? HealthFailure)?.sdkCode?.let { put("sdkCode", it.take(100)) }
    }
}

class SyncAttempt(private val history: SyncHistory, context: Context, trigger: String,
    provider: String, workId: String?, retry: Int?,
) {
    val id = UUID.randomUUID().toString()
    private val monotonicStart = SystemClock.elapsedRealtime()
    val data = JSONObject().put("id", id).put("trigger", trigger)
        .put("createdAt", Instant.now().toString()).put("timezone", ZoneId.systemDefault().id)
        .put("status", "running").put("source", "samsung_health")
        .put("appVersion", diagnosticAppVersion(context)).put("os", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        .put("provider", provider.take(300)).put("metrics", JSONArray()).put("stages", JSONArray())
        .put("queries", JSONArray()).put("requests", JSONArray()).apply {
            workId?.let { put("workId", it) }; retry?.let { put("retry", it.coerceIn(0,100)) }
        }
    init {
        history.recoverInterrupted()
        SyncHistory.active.add(id)
        save()
    }
    fun save() { history.update(data) }
    fun stage(name: String) {
        val stages = data.getJSONArray("stages")
        if (stages.length() < 100) stages.put(JSONObject().put("name", name).put("at", Instant.now().toString()))
        save()
    }
    fun finish(status: String, error: Throwable? = null) {
        data.put("status", status).put("endedAt", Instant.now().toString())
            .put("durationMs", (SystemClock.elapsedRealtime() - monotonicStart).coerceIn(0, Int.MAX_VALUE.toLong()))
        error?.let {
            val diagnostic = diagnosticError(it)
            val stages = data.getJSONArray("stages")
            val lastStage = if (stages.length() == 0) "" else stages.getJSONObject(stages.length()-1).optString("name")
            if (lastStage == "credential" && it is DeviceRequestFailure) {
                diagnostic.put("category", "authorization").put("detail", "No device pairing available. Pair with Vela before syncing; no HTTP request was made.")
            }
            if (lastStage in setOf("read_pending_outbox", "persist_outbox", "acknowledge_outbox")) {
                diagnostic.put("category", "storage").put("detail", "Durable outbox storage failed. Inspect secure storage and retry.")
            }
            data.put("error", diagnostic)
        }
        save()
        SyncHistory.active.remove(id)
    }
}

/** Only an explicit UI action calls this. Empty reports and failed uploads retain all history. */
class DiagnosticUploader(private val context: Context,
    private val send: (suspend (String, String, JSONObject, String) -> JSONObject)? = null,
) {
    suspend fun snapshot(source: String, environment: String, permission: String, report: String?): JSONObject {
        val history = SyncHistory(context)
        history.recoverInterrupted()
        val state = context.getSharedPreferences("health_sync", Context.MODE_PRIVATE)
        val snapshot = JSONObject().put("version", 1).put("appVersion", diagnosticAppVersion(context))
            .put("capturedAt", Instant.now().toString())
            .put("diagnostic", JSONObject().put("source", source.take(300)).put("environment", environment.take(500))
                .put("permission", permission.take(160)).put("report", report?.take(32000) ?: JSONObject.NULL)
                .put("reportAvailable", report != null).put("pending", state.contains("pending"))
                .put("paused", state.getBoolean("paused", false)).put("historyAvailable", !SyncHistory.storageFailed)
                .put("background", backgroundSyncDiagnostics(context)))
            .put("attempts", JSONArray(history.read()))
        // Bound the encoded request as well as local storage; never delete local entries here.
        val attempts = snapshot.getJSONArray("attempts")
        while (snapshot.toString().toByteArray(Charsets.UTF_8).size > 262144 && attempts.length() > 0) {
            attempts.remove(attempts.length()-1)
        }
        return snapshot
    }
    suspend fun upload(snapshot: JSONObject): String {
        val credential = DeviceCredentialStore(context).read()
            ?: throw DeviceRequestFailure("Pair with Vela before sending debug logs.", 401)
        check(snapshot.toString().toByteArray(Charsets.UTF_8).size <= 262144) { "Diagnostic snapshot exceeds upload limit." }
        val response = send?.invoke(credential.first, "/api/devices/diagnostics", snapshot, credential.second)
            ?: DeviceConnection(credential.first).request("/api/devices/diagnostics", snapshot, credential.second)
        check(response.getInt("version") == 1 && response.getString("id").isNotBlank()) { "Invalid diagnostic receipt." }
        return "Debug logs sent to Vela at ${response.getString("receivedAt")}. View Dev Tools > Companion App."
    }
}
