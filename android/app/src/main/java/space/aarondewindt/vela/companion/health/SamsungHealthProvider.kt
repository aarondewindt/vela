package space.aarondewindt.vela.companion.health

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.error.ErrorCode
import com.samsung.android.sdk.health.data.error.HealthDataException
import com.samsung.android.sdk.health.data.error.ResolvablePlatformException
import com.samsung.android.sdk.health.data.helper.SdkVersion
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.AggregateSourceFilter
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import java.time.Instant
import com.samsung.android.sdk.health.data.request.LocalDateFilter
import com.samsung.android.sdk.health.data.request.InstantTimeFilter
import com.samsung.android.sdk.health.data.request.Ordering
import com.samsung.android.sdk.health.data.request.ReadSourceFilter
import kotlinx.coroutines.CancellationException

/** Only this adapter imports Samsung SDK types. Workers use application context without dialogs. */
class SamsungHealthProvider(private val context: Context) : HealthProvider {
    override val source = "Samsung Health / Data SDK ${SdkVersion.getVersionName()} / ACTIVITY_SUMMARY"
    override val environment: String get() {
        val version = try {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo("com.sec.android.app.shealth", 0).versionName ?: "unknown"
        } catch (_: PackageManager.NameNotFoundException) { "not installed" }
        return "Samsung Health $version; Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}); ${Build.MANUFACTURER} ${Build.MODEL}"
    }
    private val permissions = setOf(DataTypes.ACTIVITY_SUMMARY, DataTypes.STEPS, DataTypes.SLEEP, DataTypes.BODY_COMPOSITION)
        .map { Permission.of(it, AccessType.READ) }.toSet()
    private var resolution: ResolvablePlatformException? = null
    // getStore can throw; defer until an explicit permission/read action, not composition.
    private fun store() = HealthDataService.getStore(context.applicationContext)

    override suspend fun hasReadPermission(): Boolean = sdkCall {
        store().getGrantedPermissions(permissions).containsAll(permissions)
    }

    override suspend fun requestReadPermission(): Boolean = sdkCall {
        val activity = context as? Activity ?: throw HealthFailure(HealthFailure.Kind.PERMISSION, "Open the app to grant Samsung Health read access.")
        store().requestPermissions(permissions, activity)
        // Recheck instead of assuming the dialog granted consent.
        hasReadPermission()
    }

    override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading = sdkCall {
        if (!hasReadPermission()) throw HealthFailure(HealthFailure.Kind.PERMISSION, "Required Samsung read access is not granted. Use Grant / manage read access.")
        val operation = when (metric) {
            CalorieMetric.TOTAL_CALORIES_BURNED -> DataType.ActivitySummaryType.TOTAL_CALORIES_BURNED
            CalorieMetric.TOTAL_ACTIVE_CALORIES_BURNED -> DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED
        }
        val requestedAt = Instant.now()
        val response = store().aggregateData(operation.requestBuilder
            .setLocalTimeFilter(LocalTimeFilter.of(window.start, window.endExclusive))
            .setSourceFilter(AggregateSourceFilter.fromPlatform())
            .build())
        // No page size/grouping: SDK returns all rows, normally one ungrouped aggregate.
        check(response.pageToken == null) { "Unexpected paginated calorie aggregate." }
        MetricReading(window, metric, requestedAt, Instant.now(), response.dataList.map {
            val value = it.value
            check(value == null || (value.isFinite() && value >= 0)) { "Invalid calorie aggregate." }
            AggregateRow(value, it.startTime, it.endTime)
        })
    }

    override suspend fun readAdditionalMeasurements(windows: List<CalorieWindow>): List<CalorieUpload> =
        readAdditionalMeasurements(windows) {}

    override suspend fun readAdditionalMeasurements(windows: List<CalorieWindow>, trace: (ProviderQuery) -> Unit): List<CalorieUpload> = sdkCall {
        if (!hasReadPermission()) throw HealthFailure(HealthFailure.Kind.PERMISSION,
            "Grant activity summary, steps, sleep and body composition READ access in Samsung Health.")
        val uploads = mutableListOf<CalorieUpload>()
        for (window in windows) {
            val steps = traced("STEPS", window.start.toString(), window.endExclusive.toString(), trace, { it.dataList.size }) {
                store().aggregateData(DataType.StepsType.TOTAL.requestBuilder
                .setLocalTimeFilter(LocalTimeFilter.of(window.start, window.endExclusive))
                .setSourceFilter(AggregateSourceFilter.fromPlatform()).build())
            }
            check(steps.pageToken == null && steps.dataList.size <= 1) { "Unexpected steps aggregate." }
            steps.dataList.singleOrNull()?.value?.let { count ->
                uploads += dailyMetricUpload(window, "STEPS", count.toDouble(), "steps", "sdk_steps_total")
            }
            // Samsung's date-based sleep aggregate includes overnight sessions in its sleep date.
            val sleep = traced("SLEEP", window.date.toString(), window.date.plusDays(1).toString(), trace, { it.dataList.size }) {
                store().aggregateData(DataType.SleepType.TOTAL_DURATION.requestBuilder
                .setLocalDateFilter(samsungSleepDateFilter(window.date))
                .setSourceFilter(AggregateSourceFilter.fromPlatform()).build())
            }
            check(sleep.pageToken == null && sleep.dataList.size <= 1) { "Unexpected sleep aggregate." }
            sleep.dataList.singleOrNull()?.value?.let { duration ->
                uploads += dailyMetricUpload(window, "SLEEP", duration.toMillis() / 3600000.0, "hours", "sdk_sleep_date_total")
            }
            readBmr(window.endExclusive.atZone(window.zone).toInstant(), window.zone,
                window.start.atZone(window.zone).toInstant(), trace)?.let { uploads += it }
        }
        // BMR can be measured infrequently. Preserve its actual date and carry forward in Vela.
        val zone = windows.firstOrNull()?.zone
        if (zone != null) readBmr(Instant.now(), zone, trace = trace)?.let { latest ->
            if (uploads.none { it.metric == "BMR" && it.date == latest.date }) uploads += latest
        }
        if (!hasReadPermission()) throw HealthFailure(HealthFailure.Kind.PERMISSION, "Samsung read permission changed during sync.")
        uploads
    }

    private suspend fun <T> traced(metric: String, start: String?, end: String, trace: (ProviderQuery) -> Unit,
        count: (T) -> Int, block: suspend () -> T): T {
        val at = Instant.now()
        fun emit(query: ProviderQuery) { runCatching { trace(query) } } // Diagnostics never break SDK reads.
        emit(ProviderQuery(metric, start, end, at))
        try {
            val result = block()
            emit(ProviderQuery(metric, start, end, at, Instant.now(), count(result)))
            return result
        } catch (error: Exception) {
            emit(ProviderQuery(metric, start, end, at, Instant.now(), failed = true))
            throw error
        }
    }

    private suspend fun readBmr(end: Instant, zone: java.time.ZoneId, start: Instant? = null,
        trace: (ProviderQuery) -> Unit = {}): CalorieUpload? {
        var page: String? = null
        repeat(10) {
            val builder = DataTypes.BODY_COMPOSITION.readDataRequestBuilder
                .setInstantTimeFilter(if (start == null) InstantTimeFilter.to(end) else InstantTimeFilter.of(start, end))
                .setSourceFilter(ReadSourceFilter.fromPlatform()).setOrdering(Ordering.DESC).setPageSize(100)
            page?.let { builder.setPageToken(it) }
            val response = traced("BMR_PAGE", start?.toString(), end.toString(), trace, { it.dataList.size }) {
                store().readData(builder.build())
            }
            for (point in response.dataList) {
                val bmr = point.getValue(DataType.BodyCompositionType.BASAL_METABOLIC_RATE) ?: continue
                if (point.startTime >= end || (start != null && point.startTime < start)) continue
                return bmrUpload(bmr, point.startTime, point.updateTime, point.uid, zone, Instant.now())
            }
            page = response.pageToken ?: return null
        }
        throw HealthFailure(HealthFailure.Kind.QUERY, "BMR scan exceeded 1000 records; no incomplete BMR result was uploaded.")
    }

    override fun resolveAvailability() {
        val pending = resolution ?: return
        resolution = null
        (context as? Activity)?.let { pending.resolve(it) }
    }

    private suspend fun <T> sdkCall(block: suspend () -> T): T = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (error: HealthDataException) {
        resolution = (error as? ResolvablePlatformException)?.takeIf { it.hasResolution }
        val kind = when (error.errorCode) {
            ErrorCode.ERR_NO_USER_PERMISSION -> HealthFailure.Kind.PERMISSION
            ErrorCode.ERR_ACCESS_CONTROL, ErrorCode.ERR_INVALID_CALLER,
            ErrorCode.ERR_CHILD_ACCOUNT_ACCESS, ErrorCode.ERR_INVALID_PLATFORM_SIGNATURE -> HealthFailure.Kind.AUTHORIZATION
            ErrorCode.ERR_PLATFORM_NOT_INSTALLED, ErrorCode.ERR_OLD_VERSION_PLATFORM,
            ErrorCode.ERR_PLATFORM_DISABLED, ErrorCode.ERR_PLATFORM_NOT_INITIALIZED -> HealthFailure.Kind.AVAILABILITY
            else -> HealthFailure.Kind.QUERY
        }
        val action = when (kind) {
            HealthFailure.Kind.PERMISSION -> "Grant activity summary, steps, sleep and body composition READ in Samsung Health > Settings > Apps, then resume sync."
            HealthFailure.Kind.AUTHORIZATION -> "For this debug build, check Samsung Health Data SDK developer mode > Data Read. Distribution needs registered package/signing identity. Check account restrictions and use the official Samsung Health app."
            HealthFailure.Kind.AVAILABILITY -> "Install/update Samsung Health (6.30.2+), enable it and finish its initial setup."
            HealthFailure.Kind.QUERY -> "Open Samsung Health, let wearable data arrive, then retry. If it persists, retain the code and query range for investigation."
        }
        // Do not log SDK messages: they may contain private health data.
        throw HealthFailure(kind, "${error.javaClass.simpleName}; SDK code ${error.errorCode}. $action", resolution != null, error, error.errorCode.toString())
    }
}

/** SDK date filters default to an exclusive end; equal endpoints would query an empty day. */
internal fun samsungSleepDateFilter(date: java.time.LocalDate): LocalDateFilter =
    LocalDateFilter.of(date, date.plusDays(1), true, false)
