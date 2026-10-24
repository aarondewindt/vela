package space.aarondewindt.vela.companion

import android.content.Context
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import space.aarondewindt.vela.companion.health.HealthProvider
import space.aarondewindt.vela.companion.health.ManualSync
import space.aarondewindt.vela.companion.health.calorieWindows

/** Shared by manual and background work. One process, one upload; the durable outbox precedes HTTP. */
class HealthSync(context: Context,
    private val send: (suspend (String, String, JSONObject?, String) -> JSONObject)? = null,
) {
    private val app = context.applicationContext
    private val state = app.getSharedPreferences("health_sync", Context.MODE_PRIVATE)
    suspend fun run(provider: HealthProvider, historicalDay: LocalDate? = null): String = mutex.withLock {
        val credential = DeviceCredentialStore(app).read()
            ?: throw DeviceRequestFailure("Pair with Vela before syncing.", 401)
        val connection = DeviceConnection(credential.first)
        suspend fun request(path: String, body: JSONObject? = null): JSONObject =
            send?.invoke(credential.first, path, body, credential.second)
                ?: connection.request(path, body, credential.second)
        request("/api/devices/verify")
        // Permission is checked even before replaying private health data.
        checkPermission(provider)
        suspend fun uploadPending() {
            val pending = state.getString("pending", null) ?: return
            val body = JSONObject(pending)
            val response = request("/api/health/ingest", body)
            val rows = body.getJSONArray("measurements")
            val results = response.getJSONArray("results")
            validateUploadReceipt((0 until rows.length()).map {
                rows.getJSONObject(it).let { row -> row.getString("metric") to row.getString("date") }
            }, response.getInt("version"), (0 until results.length()).map {
                results.getJSONObject(it).let { row ->
                    UploadReceipt(row.getString("metric"), row.getString("date"), row.getString("status"))
                }
            })
            check(state.edit().remove("pending").putString("last_success", Instant.now().toString()).commit())
        }
        uploadPending()
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val days = historicalDay?.let { listOf(it) } ?: (1L..7L).map { today.minusDays(it) }
        val calories = ManualSync(provider).readDays(days, zone)
        val now = Instant.now()
        val windows = days.flatMap { calorieWindows(now, zone, it) }
            .filter { it.endExclusive <= now.atZone(zone).toLocalDateTime() }
            .distinctBy { it.date }
        val measurements = calories + provider.readAdditionalMeasurements(windows)
        if (measurements.isEmpty()) return@withLock "No Samsung Health values available."
        val rows = JSONArray()
        measurements.forEach { m -> rows.put(JSONObject()
            .put("metric", m.metric).put("value", m.value).put("unit", m.unit)
            .put("date", m.date).put("timezone", m.timezone).put("observedAt", m.observedAt)
            .put("periodStart", m.periodStart).put("periodEnd", m.periodEnd)
            .put("measurementKind", m.measurementKind)
            .apply {
                m.sourceObservedAt?.let { put("sourceObservedAt", it) }
                m.sourceModifiedAt?.let { put("sourceModifiedAt", it) }
                m.upstreamId?.let { put("upstreamId", it) }
            }) }
        checkPermission(provider)
        check(state.edit().putString("pending", JSONObject().put("version", 1)
            .put("source", "samsung_health").put("measurements", rows).toString()).commit())
        uploadPending()
        "Uploaded ${measurements.size} measurements. Missing values skipped."
    }
    private suspend fun checkPermission(provider: HealthProvider) {
        if (!provider.hasReadPermission()) throw space.aarondewindt.vela.companion.health.HealthFailure(
            space.aarondewindt.vela.companion.health.HealthFailure.Kind.PERMISSION,
            "Open the app and grant Samsung Health activity summary, steps, sleep and body composition read access.")
    }
    companion object { val mutex = Mutex() }
}
