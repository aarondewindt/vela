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
    private val permissions = setOf(Permission.of(DataTypes.ACTIVITY_SUMMARY, AccessType.READ))
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
        if (!hasReadPermission()) throw HealthFailure(HealthFailure.Kind.PERMISSION, "Activity summary read permission is not granted. Use Grant / manage read access.")
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
            HealthFailure.Kind.PERMISSION -> "Grant activity summary READ in Samsung Health > Settings > Apps, then refresh."
            HealthFailure.Kind.AUTHORIZATION -> "For this debug build, check Samsung Health Data SDK developer mode > Data Read. Distribution needs registered package/signing identity. Check account restrictions and use the official Samsung Health app."
            HealthFailure.Kind.AVAILABILITY -> "Install/update Samsung Health (6.30.2+), enable it and finish its initial setup."
            HealthFailure.Kind.QUERY -> "Open Samsung Health, let wearable data arrive, then retry. If it persists, retain the code and query range for investigation."
        }
        // Do not log SDK messages: they may contain private health data.
        throw HealthFailure(kind, "${error.javaClass.simpleName}; SDK code ${error.errorCode}. $action", resolution != null, error)
    }
}
