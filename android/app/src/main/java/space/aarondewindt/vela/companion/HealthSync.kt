package space.aarondewindt.vela.companion

import android.content.Context
import java.time.Instant
import java.time.Clock
import java.util.UUID
import kotlinx.coroutines.CancellationException
import space.aarondewindt.vela.companion.health.CalorieMetric
import space.aarondewindt.vela.companion.health.CalorieWindow
import space.aarondewindt.vela.companion.health.MetricReading
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import space.aarondewindt.vela.companion.health.HealthProvider
import space.aarondewindt.vela.companion.health.ManualSync
import space.aarondewindt.vela.companion.health.syncCalorieWindows

/** Shared by manual and background work. One process, one upload; the durable outbox precedes HTTP. */
class HealthSync(context: Context,
    private val clock: Clock = Clock.systemUTC(),
    private val send: (suspend (String, String, JSONObject?, String) -> JSONObject)? = null,
) {
    private val app = context.applicationContext
    private val state = app.getSharedPreferences("health_sync", Context.MODE_PRIVATE)
    suspend fun run(provider: HealthProvider, historicalDay: LocalDate? = null,
        trigger: String = "manual", workId: String? = null, retry: Int? = null,
        workerStopReason: (() -> Int?)? = null): String {
        require(trigger in setOf("manual", "automatic"))
        val attempt = SyncAttempt(SyncHistory(app), app, trigger, provider.source, workId, retry)
        var outcome = "failed"
        try {
            return mutex.withLock {
                attempt.data.put("startedAt", Instant.now().toString())
                attempt.stage("credential")
                val credential = DeviceCredentialStore(app).read()
                    ?: throw DeviceRequestFailure("Pair with Vela before syncing.", 401)
                val connection = DeviceConnection(credential.first)
                suspend fun request(path: String, body: JSONObject? = null, replay: Boolean = false): JSONObject {
                    val row = JSONObject().put("path", if (body == null) "verify" else "ingest")
                        .put("at", Instant.now().toString())
                    body?.let {
                        row.put("rows", it.getJSONArray("measurements").length()).put("replay", replay)
                        if (it.has("batchId")) row.put("batchId", it.getString("batchId"))
                    }
                    attempt.data.getJSONArray("requests").put(row)
                    attempt.save()
                    try {
                        val headers = mutableMapOf("x-vela-attempt-id" to attempt.id, "x-vela-trigger" to trigger,
                            "x-vela-replay" to replay.toString())
                        retry?.let { headers["x-vela-retry"] = it.coerceIn(0,100).toString() }
                        val response = send?.invoke(credential.first, path, body, credential.second)
                            ?: connection.request(path, body, credential.second, headers)
                        row.put("status", 200)
                        return response
                    } catch (failure: Exception) {
                        row.put("error", diagnosticCategory(failure))
                        (failure as? DeviceRequestFailure)?.status?.let { row.put("status", it) }
                        throw failure
                    } finally {
                        row.put("endedAt", Instant.now().toString())
                        attempt.save()
                    }
                }
                attempt.stage("verify")
                request("/api/devices/verify")
                // Permission is checked even before replaying private health data.
                attempt.stage("permission")
                checkPermission(provider)
                suspend fun uploadPending(replay: Boolean) {
                    val pending = state.getString("pending", null) ?: return
                    attempt.stage("read_pending_outbox")
                    val body = JSONObject(pending)
                    attempt.stage(if (replay) "replay_pending" else "upload")
                    val response = request("/api/health/ingest", body, replay)
                    attempt.stage("validate_receipt")
                    val rows = body.getJSONArray("measurements")
                    val results = response.getJSONArray("results")
                    validateUploadReceipt((0 until rows.length()).map {
                        rows.getJSONObject(it).let { row -> row.getString("metric") to row.getString("date") }
                    }, response.getInt("version"), (0 until results.length()).map {
                        results.getJSONObject(it).let { row ->
                            UploadReceipt(row.getString("metric"), row.getString("date"), row.getString("status"))
                        }
                    })
                    attempt.data.getJSONArray("requests").getJSONObject(attempt.data.getJSONArray("requests").length()-1)
                        .put("receipt", results)
                    attempt.save()
                    attempt.stage("acknowledge_outbox")
                    check(state.edit().remove("pending").putString("last_success", Instant.now().toString()).commit())
                }
                uploadPending(true)
                val capturedAt = clock.instant()
                val zone = ZoneId.systemDefault()
                val today = capturedAt.atZone(zone).toLocalDate()
                val days = historicalDay?.let { listOf(it) } ?: (1L..7L).map { today.minusDays(it) }
                val windows = syncCalorieWindows(capturedAt, zone, days)
                attempt.data.put("dateFrom", days.min().toString()).put("dateTo", today.toString())
                attempt.stage("sdk_calories")
                var missing = false
                val observedProvider = object : HealthProvider by provider {
                    override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
                        val query = JSONObject().put("metric", metric.name).put("date", window.date.toString())
                            .put("start", window.start.toString()).put("end", window.endExclusive.toString())
                            .put("at", Instant.now().toString())
                        val queries = attempt.data.getJSONArray("queries")
                        if (queries.length() < 150) queries.put(query)
                        attempt.save()
                        try {
                            val reading = provider.readCalories(window, metric)
                            query.put("rows", reading.rows.size)
                            reading.valueKcal?.takeIf { it.isFinite() }?.let { query.put("value", it.toDouble()) }
                            if (reading.valueKcal == null) missing = true
                            if (reading.error != null) query.put("error", "query")
                            return reading
                        } catch (failure: Exception) {
                            query.put("error", diagnosticCategory(failure))
                            throw failure
                        } finally {
                            query.put("endedAt", Instant.now().toString())
                            attempt.save()
                        }
                    }
                }
                val calories = ManualSync(observedProvider, Clock.fixed(capturedAt, zone)).readDays(days, zone)
                attempt.stage("sdk_additional_steps_sleep_bmr")
                val additionalQueries = mutableMapOf<String, JSONObject>()
                val measurements = calories + provider.readAdditionalMeasurements(windows) { q ->
                    runCatching {
                        val key = "${q.metric}:${q.at}"
                        val query = additionalQueries.getOrPut(key) {
                            JSONObject().put("metric", q.metric).put("at", q.at.toString()).put("end", q.end).apply {
                                q.start?.let { put("start", it) }
                                if (attempt.data.getJSONArray("queries").length() < 150) attempt.data.getJSONArray("queries").put(this)
                            }
                        }
                        q.endedAt?.let { query.put("endedAt", it.toString()) }
                        q.rows?.let { query.put("rows", it) }
                        if (q.failed) query.put("error", "query")
                        attempt.save()
                    }
                }
                attempt.data.put("readings", measurements.size)
                    .put("metrics", JSONArray(measurements.map { it.metric }.distinct()))
                attempt.save()
                if (measurements.isEmpty()) {
                    outcome = "no_data"
                    return@withLock "No Samsung Health values available."
                }
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
                attempt.stage("persist_outbox")
                check(state.edit().putString("pending", JSONObject().put("version", 1)
                    .put("attemptId", attempt.id).put("batchId", UUID.randomUUID().toString()).put("trigger", trigger)
                    .put("source", "samsung_health").put("measurements", rows).toString()).commit())
                uploadPending(false)
                outcome = if (missing) "partial" else "success"
                "Uploaded ${measurements.size} measurements. Missing values skipped."
            }
        } catch (failure: CancellationException) {
            workerStopReason?.invoke()?.let { attempt.data.put("workStopReason", it) }
            attempt.finish("cancelled", failure)
            throw failure
        } catch (failure: Exception) {
            attempt.finish("failed", failure)
            throw failure
        } finally {
            if (attempt.data.optString("status") == "running") attempt.finish(outcome)
        }
    }
    private suspend fun checkPermission(provider: HealthProvider) {
        if (!provider.hasReadPermission()) throw space.aarondewindt.vela.companion.health.HealthFailure(
            space.aarondewindt.vela.companion.health.HealthFailure.Kind.PERMISSION,
            "Open the app and grant Samsung Health activity summary, steps, sleep and body composition read access.")
    }
    companion object { val mutex = Mutex() }
}
