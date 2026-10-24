package space.aarondewindt.vela.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
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
            assertEquals(original, preferences.getString("pending", null))
            var uploads = 0
            HealthSync(context) { _, path, body, _ ->
                if (path == "/api/health/ingest") {
                    if (uploads++ == 0) assertEquals(original, body.toString())
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
