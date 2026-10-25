package space.aarondewindt.vela.companion

import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.*
import com.samsung.android.sdk.health.data.data.AggregateOperation
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Explicit, read-only physical-phone probe. Never grants consent, writes health data, or uses Vela HTTP. */
class LiveSamsungQueryTest {
    @Test fun compareCalendarAndElapsedQueries() = runBlocking {
        assumeTrue(InstrumentationRegistry.getArguments().getString("velaLiveSamsungRead") == "true")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val store = HealthDataService.getStore(instrumentation.targetContext)
        fun emit(row: JSONObject) = instrumentation.sendStatus(0, Bundle().apply { putString("velaQuery", row.toString()) })
        val zone = ZoneId.systemDefault()
        val now = Instant.now()
        val today = now.atZone(zone).toLocalDate()
        val types = listOf(DataTypes.ACTIVITY_SUMMARY, DataTypes.STEPS, DataTypes.SLEEP, DataTypes.BODY_COMPOSITION)
        val permissions = types.map { Permission.of(it, AccessType.READ) }.toSet()
        val granted = store.getGrantedPermissions(permissions)
        emit(JSONObject().put("kind", "permissions").put("capturedAt", now.toString()).put("timezone", zone.id)
            .put("granted", JSONArray(types.map { type -> JSONObject().put("type", type.name)
                .put("read", granted.contains(Permission.of(type, AccessType.READ))) })))
        check(granted.containsAll(permissions)) { "Required Samsung read permissions are missing" }
        suspend fun <T : Any> probe(metric: String, operation: AggregateOperation<T, AggregateRequest.LocalTimeBuilder<T>>,
            day: LocalDate, partial: Boolean, grouped: Boolean, platform: Boolean) {
            val start = day.atStartOfDay(zone)
            val end = if (partial) now.atZone(zone) else day.plusDays(1).atStartOfDay(zone)
            val row = JSONObject().put("metric", metric).put("date", day.toString()).put("partial", partial)
                .put("groupedHourly", grouped).put("platformOnly", platform).put("timezone", zone.id)
                .put("filter", "LocalTimeFilter").put("inclusiveStart", true).put("inclusiveEnd", false)
                .put("localStart", start.toLocalDateTime().toString()).put("localEnd", end.toLocalDateTime().toString())
                .put("utcStart", start.toInstant().toString()).put("utcEnd", end.toInstant().toString())
                .put("startOffset", start.offset.toString()).put("endOffset", end.offset.toString())
                .put("requestedAt", Instant.now().toString())
            try {
                val filter = LocalTimeFilter.of(start.toLocalDateTime(), end.toLocalDateTime(), true, false)
                val builder = operation.requestBuilder
                if (grouped) builder.setLocalTimeFilterWithGroup(filter, LocalTimeGroup.of(LocalTimeGroupUnit.HOURLY, 1))
                else builder.setLocalTimeFilter(filter)
                if (platform) builder.setSourceFilter(AggregateSourceFilter.fromPlatform())
                val response = store.aggregateData(builder.build())
                row.put("status", "success").put("rows", JSONArray(response.dataList.map {
                    JSONObject().put("value", it.value ?: JSONObject.NULL).put("start", it.startTime.toString()).put("end", it.endTime.toString())
                })).put("hasMorePages", response.pageToken != null)
            } catch (error: HealthDataException) {
                row.put("status", "sdk_error").put("errorType", error.javaClass.simpleName).put("sdkCode", error.errorCode)
            } finally { emit(row.put("endedAt", Instant.now().toString())) }
        }
        for (day in listOf(today.minusDays(1), today)) {
            for (partial in if (day == today) listOf(true, false) else listOf(false)) {
                for (grouped in listOf(false, true)) {
                    for (platform in listOf(true, false)) {
                        probe("TOTAL_CALORIES", DataType.ActivitySummaryType.TOTAL_CALORIES_BURNED, day, partial, grouped, platform)
                        probe("ACTIVE_CALORIES", DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED, day, partial, grouped, platform)
                        probe("STEPS", DataType.StepsType.TOTAL, day, partial, grouped, platform)
                    }
                }
            }
            val sleep = JSONObject().put("metric", "SLEEP").put("date", day.toString()).put("timezone", zone.id)
                .put("filter", "LocalDateFilter").put("startDate", day.toString()).put("endDate", day.plusDays(1).toString())
                .put("inclusiveStart", true).put("inclusiveEnd", false).put("requestedAt", Instant.now().toString())
            try {
                val response = store.aggregateData(DataType.SleepType.TOTAL_DURATION.requestBuilder
                    .setLocalDateFilter(LocalDateFilter.of(day, day.plusDays(1), true, false))
                    .setSourceFilter(AggregateSourceFilter.fromPlatform()).build())
                sleep.put("status", "success").put("rows", JSONArray(response.dataList.map {
                    JSONObject().put("hours", it.value?.toMillis()?.div(3600000.0) ?: JSONObject.NULL)
                })).put("hasMorePages", response.pageToken != null)
            } catch (error: HealthDataException) {
                sleep.put("status", "sdk_error").put("errorType", error.javaClass.simpleName).put("sdkCode", error.errorCode)
            } finally { emit(sleep.put("endedAt", Instant.now().toString())) }
            val start = day.atStartOfDay(zone)
            val end = if (day == today) now.atZone(zone) else day.plusDays(1).atStartOfDay(zone)
            val bmr = JSONObject().put("metric", "BMR").put("date", day.toString()).put("timezone", zone.id)
                .put("filter", "InstantTimeFilter").put("utcStart", start.toInstant().toString()).put("utcEnd", end.toInstant().toString())
                .put("localStart", start.toLocalDateTime().toString()).put("localEnd", end.toLocalDateTime().toString())
                .put("startOffset", start.offset.toString()).put("endOffset", end.offset.toString()).put("requestedAt", Instant.now().toString())
            try {
                val response = store.readData(DataTypes.BODY_COMPOSITION.readDataRequestBuilder
                    .setInstantTimeFilter(InstantTimeFilter.of(start.toInstant(), end.toInstant()))
                    .setSourceFilter(ReadSourceFilter.fromPlatform()).setPageSize(100).build())
                bmr.put("status", "success").put("bodyCompositionRows", response.dataList.size)
                    .put("rows", JSONArray(response.dataList.mapNotNull { point ->
                        point.getValue(DataType.BodyCompositionType.BASAL_METABOLIC_RATE)?.let { value ->
                            JSONObject().put("value", value).put("measuredAt", point.startTime.toString())
                        }
                    })).put("hasMorePages", response.pageToken != null)
            } catch (error: HealthDataException) {
                bmr.put("status", "sdk_error").put("errorType", error.javaClass.simpleName).put("sdkCode", error.errorCode)
            } finally { emit(bmr.put("endedAt", Instant.now().toString())) }
        }
    }
}
