package space.aarondewindt.vela.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

/** Real Android preferences/Keystore with synthetic SDK/HTTP boundaries. No real pairing is touched. */
class SyncDiagnosticsTest {
    private fun context(): Context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
        val prefix = "diagnostics_test_${UUID.randomUUID()}_"
        override fun getApplicationContext(): Context = this
        override fun getSharedPreferences(name: String, mode: Int) = super.getSharedPreferences(prefix + name, mode)
    }
    private val provider = object : HealthProvider {
        override val source = "Synthetic Samsung provider"
        override val environment = "Test only"
        override suspend fun hasReadPermission() = true
        override suspend fun requestReadPermission() = true
        override fun resolveAvailability() = Unit
        override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
            val now = Instant.now()
            return MetricReading(window, metric, now, now)
        }
    }
    private fun pair(context: Context) = DeviceCredentialStore(context).save("https://example.com", "test-only-private-credential")
    private fun receipt(body: JSONObject): JSONObject {
        val rows = body.getJSONArray("measurements")
        return JSONObject().put("version",1).put("results",JSONArray((0 until rows.length()).map { i ->
            val m=rows.getJSONObject(i)
            JSONObject().put("metric",m.getString("metric")).put("date",m.getString("date")).put("status","unchanged")
        }))
    }
    @Test fun unpairedAndPermissionFailuresSurviveRecreationWithoutHealthDelivery() = runBlocking {
        val context=context()
        try {
            try { HealthSync(context).run(provider); fail("unpaired") } catch (_: DeviceRequestFailure) {}
            var row=SyncHistory(context).read().first()
            assertEquals("failed",row.getString("status")); assertEquals("manual",row.getString("trigger"))
            assertEquals(0,row.getJSONArray("requests").length())
            assertEquals("authorization",row.getJSONObject("error").getString("category"))
            pair(context)
            var uploads=0
            try {
                HealthSync(context) { _,path,_,_ -> if(path=="/api/health/ingest") uploads++; JSONObject() }
                    .run(object: HealthProvider by provider { override suspend fun hasReadPermission()=false },
                        trigger="automatic",workId=UUID.randomUUID().toString(),retry=2)
                fail("permission")
            } catch (_: HealthFailure) {}
            row=SyncHistory(context).read().first()
            assertEquals("automatic",row.getString("trigger")); assertEquals(2,row.getInt("retry"))
            assertEquals("permission",row.getJSONObject("error").getString("category")); assertEquals(0,uploads)
            assertFalse(row.toString().contains("test-only-private-credential"))
        } finally { DeviceCredentialStore(context).clear() }
    }
    @Test fun emptyDataNetworkHttpSdkAndCancellationOutcomesAreAccurate() = runBlocking {
        val context=context(); pair(context)
        try {
            HealthSync(context) { _,_,_,_ -> JSONObject() }.run(provider)
            assertEquals("no_data",SyncHistory(context).read().first().getString("status"))
            val errors=listOf(IOException("secret network URL"),DeviceRequestFailure("private",400),DeviceRequestFailure("private",503),
                HealthFailure(HealthFailure.Kind.QUERY,"private SDK error",sdkCode="TEST_QUERY"), CancellationException("cancel"))
            for (failure in errors) {
                try { HealthSync(context) { _,_,_,_ -> throw failure }.run(provider); fail("failure") } catch (_: Exception) {}
                val row=SyncHistory(context).read().first()
                assertEquals(if(failure is CancellationException) "cancelled" else "failed",row.getString("status"))
                assertFalse(row.toString().contains("secret network URL")); assertFalse(row.toString().contains("private SDK error"))
                assertTrue(row.has("endedAt")); assertTrue(row.getLong("durationMs")>=0)
            }
            try {
                HealthSync(context) { _,_,_,_ -> JSONObject() }.run(object:HealthProvider by provider {
                    override suspend fun readCalories(window:CalorieWindow,metric:CalorieMetric):MetricReading =
                        throw HealthFailure(HealthFailure.Kind.QUERY,"private",sdkCode="SDK_123")
                }); fail("SDK failure")
            } catch (_:HealthFailure) {}
            val row=SyncHistory(context).read().first()
            assertEquals("SDK_123",row.getJSONObject("error").getString("sdkCode"))
            assertEquals("query",row.getJSONArray("queries").getJSONObject(0).getString("error"))
        } finally { DeviceCredentialStore(context).clear() }
    }
    @Test fun replayKeepsBatchIdentityButNewOperationIdentityAndValidReceipt() = runBlocking {
        val context=context(); pair(context)
        val populated=object:HealthProvider by provider {
            override suspend fun readCalories(window:CalorieWindow,metric:CalorieMetric):MetricReading {
                val now=Instant.now(); return MetricReading(window,metric,now,now,listOf(AggregateRow(12f,now,now)))
            }
        }
        try {
            try { HealthSync(context) { _,path,_,_ -> if(path=="/api/health/ingest") throw IOException("lost"); JSONObject() }.run(populated);fail("network") } catch (_:IOException) {}
            val first=SyncHistory(context).read().first()
            val pending=context.getSharedPreferences("health_sync",0).getString("pending",null)!!
            HealthSync(context) { _,path,body,_ -> if(path=="/api/health/ingest") receipt(body!!) else JSONObject() }.run(provider,trigger="automatic")
            val second=SyncHistory(context).read().first()
            assertNotEquals(first.getString("id"),second.getString("id"))
            val replay=second.getJSONArray("requests").getJSONObject(1)
            assertTrue(replay.getBoolean("replay"))
            assertEquals(JSONObject(pending).getString("batchId"),replay.getString("batchId"))
            assertTrue(replay.getJSONArray("receipt").length()>0)
            assertFalse(context.getSharedPreferences("health_sync",0).contains("pending"))
        } finally { DeviceCredentialStore(context).clear() }
    }
    @Test fun historyIsBoundedAndInterruptedEntriesNeverGetInventedEndTimes() = runBlocking {
        val context=context(); val prefs=context.getSharedPreferences("sync_diagnostics",0)
        val entries=JSONArray((0..120).map { i -> JSONObject().put("id",UUID.randomUUID().toString())
            .put("createdAt",Instant.now().minusSeconds(i.toLong()).toString()).put("status","running") })
        entries.put(JSONObject().put("id",UUID.randomUUID().toString()).put("createdAt",Instant.now().minusSeconds(8*86400).toString()).put("status","success"))
        assertTrue(prefs.edit().putString("attempts",entries.toString()).commit())
        val history=SyncHistory(context);history.recoverInterrupted()
        val rows=history.read();assertEquals(100,rows.size)
        assertTrue(rows.all { it.getString("status")=="interrupted" && !it.has("endedAt") && !it.has("durationMs") })
        assertTrue(prefs.getString("attempts",null)!!.toByteArray().size<=192*1024)
        val second=Instant.now().minusSeconds(1).truncatedTo(java.time.temporal.ChronoUnit.SECONDS)
        val whole=JSONObject().put("id","whole").put("createdAt",second.toString()).put("status","success")
        val fraction=JSONObject().put("id","fraction").put("createdAt",second.plusMillis(50).toString()).put("status","success")
        assertTrue(prefs.edit().putString("attempts",JSONArray(listOf(whole,fraction)).toString()).commit())
        assertEquals("fraction",history.read().first().getString("id"))
        assertTrue(prefs.edit().putString("attempts","{malformed").commit())
        assertTrue(history.read().isEmpty());assertTrue(SyncHistory.storageFailed)
        pair(context)
        try {
            assertTrue(HealthSync(context) { _,_,_,_ -> JSONObject() }.run(provider).contains("No Samsung Health values"))
        } finally { DeviceCredentialStore(context).clear() }
    }
    @Test fun explicitUploadWithNoReportOrReadingsAndAuthFailureNeverClearHistory() = runBlocking {
        val context=context();pair(context)
        try {
            HealthSync(context) { _,_,_,_ -> JSONObject() }.run(provider)
            val before=SyncHistory(context).read().first().toString()
            val uploader=DiagnosticUploader(context) { _,path,body,token ->
                assertEquals("/api/devices/diagnostics",path);assertEquals("test-only-private-credential",token)
                assertFalse(body.getJSONObject("diagnostic").getBoolean("reportAvailable"))
                assertFalse(body.toString().contains(token))
                JSONObject().put("version",1).put("id",UUID.randomUUID().toString()).put("receivedAt",Instant.now().toString())
            }
            val snapshot=uploader.snapshot(provider.source,provider.environment,"Granted",null)
            val background = snapshot.getJSONObject("diagnostic").getJSONObject("background")
            assertEquals(60, background.getInt("intervalMinutes"))
            assertTrue(background.getBoolean("workAvailable"))
            assertTrue(background.has("powerSaveMode"))
            assertTrue(background.has("backgroundRestricted"))
            // Contract artifact contains synthetic observations only, for server-schema verification.
            context.filesDir.resolve("diagnostics-contract.json").writeText(snapshot.toString())
            assertTrue(uploader.upload(snapshot).contains("Debug logs sent"))
            try { DiagnosticUploader(context) { _,_,_,_ -> throw DeviceRequestFailure("Expired",401) }.upload(snapshot);fail("auth") } catch (_:DeviceRequestFailure) {}
            assertEquals(before,SyncHistory(context).read().first().toString())
        } finally { DeviceCredentialStore(context).clear() }
    }

    @Test fun cancellationRetainsWorkManagerStopReasonWithoutPausingOrDroppingOutbox() = runBlocking {
        val context = context(); pair(context)
        val state = context.getSharedPreferences("health_sync", 0)
        assertTrue(state.edit().putString("pending", "retained snapshot").commit())
        try {
            try {
                HealthSync(context) { _, _, _, _ -> throw CancellationException("stopped") }
                    .run(provider, trigger = "automatic", workId = UUID.randomUUID().toString(),
                        retry = 1, workerStopReason = { 7 })
                fail("Expected cancellation")
            } catch (_: CancellationException) { }
            val attempt = SyncHistory(context).read().first()
            assertEquals("cancelled", attempt.getString("status"))
            assertEquals(7, attempt.getInt("workStopReason"))
            assertEquals("retained snapshot", state.getString("pending", null))
            assertFalse(state.getBoolean("paused", false))
        } finally { DeviceCredentialStore(context).clear() }
    }
}
