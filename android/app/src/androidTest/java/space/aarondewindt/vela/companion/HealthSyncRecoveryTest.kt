package space.aarondewindt.vela.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

class HealthSyncRecoveryTest {
    @Test fun interruptedUploadIsReplayedByteForByteAfterRecreation() = runBlocking {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getApplicationContext(): Context = this
            override fun getSharedPreferences(name: String, mode: Int) =
                super.getSharedPreferences("recovery_test_$name", mode)
        }
        val preferences = context.getSharedPreferences("health_sync", 0)
        val credentials = DeviceCredentialStore(context)
        check(preferences.edit().clear().commit())
        credentials.save("https://example.com", "test-only-token")
        var original: String? = null
        val provider = object : HealthProvider {
            override val source = "test"
            override val environment = "test"
            override suspend fun hasReadPermission() = true
            override suspend fun requestReadPermission() = true
            override fun resolveAvailability() = Unit
            override suspend fun readAdditionalMeasurements(windows: List<CalorieWindow>): List<CalorieUpload> {
                val w = windows.first()
                val now = Instant.now()
                return listOf(dailyMetricUpload(w, "STEPS", 12345.0, "steps", "sdk_steps_total"),
                    dailyMetricUpload(w, "SLEEP", 8.5, "hours", "sdk_sleep_date_total"),
                    bmrUpload(1700, now.minusSeconds(60), null, "bmr-test-id", w.zone, now))
            }
            override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
                val now = Instant.now()
                return MetricReading(window, metric, now, now, listOf(AggregateRow(10f, now, now)))
            }
        }
        try {
            try {
                HealthSync(context) { _, path, body, _ ->
                    if (path == "/api/health/ingest") {
                        original = body.toString()
                        throw IOException("simulated response loss after server commit")
                    }
                    JSONObject()
                }.run(provider, LocalDate.now().minusDays(1))
                fail("Expected response loss")
            } catch (_: IOException) { }
            assertNotNull(original)
            val originalRows = JSONObject(checkNotNull(original)).getJSONArray("measurements")
            assertTrue((0 until originalRows.length()).any { originalRows.getJSONObject(it).optString("unit") == "kcal/day" })
            assertTrue(checkNotNull(original).contains("bmr-test-id"))
            assertEquals(original, preferences.getString("pending", null))
            try {
                HealthSync(context) { _, _, _, _ ->
                    JSONObject().put("version", 1).put("results", JSONArray())
                }.run(provider, LocalDate.now().minusDays(1))
                fail("Missing acknowledgements must retain pending work")
            } catch (_: IllegalStateException) { }
            assertEquals(original, preferences.getString("pending", null))
            var deniedUploads = 0
            try {
                HealthSync(context) { _, path, _, _ ->
                    if (path == "/api/health/ingest") deniedUploads++
                    JSONObject()
                }.run(object : HealthProvider by provider {
                    override suspend fun hasReadPermission() = false
                }, LocalDate.now().minusDays(1))
                fail("Permission loss must block pending upload")
            } catch (failure: HealthFailure) { assertEquals(HealthFailure.Kind.PERMISSION, failure.kind) }
            assertEquals(0, deniedUploads)
            assertEquals(original, preferences.getString("pending", null))
            var uploads = 0
            HealthSync(context) { _, path, body, _ ->
                if (path == "/api/health/ingest") {
                    if (uploads++ == 0) assertEquals(original, body.toString())
                    val results = JSONArray()
                    val rows = checkNotNull(body).getJSONArray("measurements")
                    for (i in 0 until rows.length()) {
                        val row = rows.getJSONObject(i)
                        results.put(JSONObject().put("metric", row.getString("metric"))
                            .put("date", row.getString("date")).put("status", "unchanged"))
                    }
                    return@HealthSync JSONObject().put("version", 1).put("results", results)
                }
                JSONObject()
            }.run(provider, LocalDate.now().minusDays(1))
            assertEquals(2, uploads) // replay then a freshly captured reconciliation
            assertFalse(preferences.contains("pending"))
            assertNotNull(preferences.getString("last_success", null))
        } finally {
            credentials.clear()
            check(preferences.edit().clear().commit())
        }
    }
}
