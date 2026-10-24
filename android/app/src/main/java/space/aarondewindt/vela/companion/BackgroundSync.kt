package space.aarondewindt.vela.companion

import android.content.Context
import androidx.work.*
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import space.aarondewindt.vela.companion.health.HealthFailure
import space.aarondewindt.vela.companion.health.SamsungHealthProvider

fun retrySync(status: Int?, attempt: Int): Boolean = attempt < 4 &&
    (status == null || status == 408 || status == 429 || status in 500..599)

val syncIntervalOptions = listOf(15, 30, 60, 120)
fun validSyncInterval(minutes: Int): Int = minutes.takeIf { it in syncIntervalOptions } ?: 60

object BackgroundSync {
    fun intervalMinutes(context: Context): Int = validSyncInterval(
        context.getSharedPreferences("sync_settings", Context.MODE_PRIVATE).getInt("interval_minutes", 60))

    fun setInterval(context: Context, minutes: Int) {
        require(minutes in syncIntervalOptions) { "Choose a supported interval (minimum 15 minutes)." }
        check(context.getSharedPreferences("sync_settings", Context.MODE_PRIVATE).edit()
            .putInt("interval_minutes", minutes).commit())
        schedule(context)
    }

    private const val NAME = "vela-health-periodic"
    fun schedule(context: Context) {
        if (context.getSharedPreferences("health_sync", Context.MODE_PRIVATE).getBoolean("paused", false)) return
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<HealthSyncWorker>(intervalMinutes(context).toLong(), TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED)
                    .setRequiresBatteryNotLow(true).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 1, TimeUnit.MINUTES).build())
    }
    fun cancel(context: Context) { WorkManager.getInstance(context).cancelUniqueWork(NAME) }
}

class HealthSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val state = applicationContext.getSharedPreferences("health_sync", Context.MODE_PRIVATE)
        if (state.getBoolean("paused", false)) return Result.success()
        fun status(message: String) { check(state.edit().putString("status", message).commit()) }
        return try {
            status("Synchronization running")
            val message = HealthSync(applicationContext).run(SamsungHealthProvider(applicationContext))
            status(message)
            Result.success()
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: DeviceRequestFailure) {
            if (retrySync(failure.status, runAttemptCount)) {
                status("Temporary server failure. Retry pending."); Result.retry()
            } else {
                if (failure.status != null && !retrySync(failure.status, 0))
                    check(state.edit().putBoolean("paused", true).commit())
                status(failure.message ?: "Open the app to inspect synchronization.")
                Result.failure()
            }
        } catch (_: IOException) {
            status("Network unavailable. Pending snapshot retained.")
            if (retrySync(null, runAttemptCount)) Result.retry() else Result.failure()
        } catch (failure: HealthFailure) {
            status(failure.detail)
            if (failure.kind == HealthFailure.Kind.QUERY) {
                if (retrySync(null, runAttemptCount)) Result.retry() else Result.failure()
            } else {
                check(state.edit().putBoolean("paused", true).commit())
                Result.failure()
            }
        } catch (_: Exception) {
            status("Sync stopped. Check secure storage, Samsung Health and phone date/time; resume in the app.")
            check(state.edit().putBoolean("paused", true).commit())
            Result.failure()
        }
    }
}
