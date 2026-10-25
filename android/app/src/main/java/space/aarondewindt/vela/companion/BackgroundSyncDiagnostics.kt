package space.aarondewindt.vela.companion

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import androidx.work.WorkManager
import java.time.Instant
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

/** Explicit diagnostic snapshot only. No scheduling, exemption requests or private network identifiers. */
suspend fun backgroundSyncDiagnostics(context: Context): JSONObject {
    val power = context.getSystemService(PowerManager::class.java)
    val connectivity = context.getSystemService(ConnectivityManager::class.java)
    val network = connectivity.getNetworkCapabilities(connectivity.activeNetwork)
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val work = try {
        withTimeoutOrNull(2000) {
            WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow(BackgroundSync.NAME).first()
        }
    } catch (cancelled: CancellationException) { throw cancelled }
    catch (_: Exception) { null } // Unavailable is explicit; diagnostic failure must not imply no work.
    return JSONObject().put("intervalMinutes", BackgroundSync.intervalMinutes(context))
        .put("workAvailable", work != null)
        .put("powerSaveMode", power.isPowerSaveMode)
        .put("batteryOptimizationIgnored", power.isIgnoringBatteryOptimizations(context.packageName))
        .put("backgroundRestricted", context.getSystemService(ActivityManager::class.java).isBackgroundRestricted)
        .put("interactive", power.isInteractive)
        .put("networkValidated", network?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true)
        .put("work", JSONArray(work.orEmpty().filter { !it.state.isFinished }.take(5).map {
            JSONObject().put("id", it.id.toString()).put("state", it.state.name)
                .put("runAttemptCount", it.runAttemptCount).put("generation", it.generation)
                .put("stopReason", it.stopReason).apply {
                    if (it.nextScheduleTimeMillis != Long.MAX_VALUE)
                        put("nextScheduleAt", Instant.ofEpochMilli(it.nextScheduleTimeMillis).toString())
                }
        })).apply {
            val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            if (level >= 0 && scale > 0) put("batteryPercent", (level * 100 / scale).coerceIn(0, 100))
        }
}
