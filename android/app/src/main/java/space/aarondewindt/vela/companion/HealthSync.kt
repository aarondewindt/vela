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
            request("/api/health/ingest", JSONObject(pending))
            check(state.edit().remove("pending").putString("last_success", Instant.now().toString()).commit())
        }
        uploadPending()
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val days = historicalDay?.let { listOf(it) } ?: (1L..7L).map { today.minusDays(it) }
        val measurements = ManualSync(provider).readDays(days, zone)
        if (measurements.isEmpty()) return@withLock "No Samsung Health values available."
        val rows = JSONArray()
        measurements.forEach { m -> rows.put(JSONObject()
            .put("metric", m.metric).put("value", m.value).put("unit", "kcal")
            .put("date", m.date).put("timezone", m.timezone).put("observedAt", m.observedAt)
            .put("periodStart", m.periodStart).put("periodEnd", m.periodEnd)
            .put("measurementKind", "sdk_aggregate_semantics_unverified")) }
        checkPermission(provider)
        check(state.edit().putString("pending", JSONObject().put("version", 1)
            .put("source", "samsung_health").put("measurements", rows).toString()).commit())
        uploadPending()
        "Uploaded ${measurements.size} measurements. Missing values skipped."
    }
    private suspend fun checkPermission(provider: HealthProvider) {
        if (!provider.hasReadPermission()) throw space.aarondewindt.vela.companion.health.HealthFailure(
            space.aarondewindt.vela.companion.health.HealthFailure.Kind.PERMISSION,
            "Open the app and grant Samsung Health activity summary read access.")
    }
    companion object { val mutex = Mutex() }
}
