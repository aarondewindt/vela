package space.aarondewindt.vela.companion

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.work.WorkManager
import kotlinx.coroutines.sync.withLock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.aarondewindt.vela.companion.health.HealthFailure
import space.aarondewindt.vela.companion.health.HealthProvider

@Composable
fun ManualSyncCard(provider: HealthProvider, historicalDate: String, enabled: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf("Sync calories, steps, sleep and BMR for today and the selected historical day. Missing values are skipped. Total includes active; SDK elapsed/projected semantics remain unverified.") }
    val preferences = remember { context.getSharedPreferences("health_sync", 0) }

    var interval by remember { mutableStateOf(BackgroundSync.intervalMinutes(context)) }
    var intervalMenuOpen by remember { mutableStateOf(false) }
    val work by remember { WorkManager.getInstance(context).getWorkInfosForUniqueWorkFlow("vela-health-periodic") }
        .collectAsState(initial = emptyList())
    Card {
        Column {
            Text("Manual health sync")
            Text(message)
            Box {
                OutlinedButton(onClick = { intervalMenuOpen = true }) {
                    Text("Sync interval: $interval minutes")
                }
                DropdownMenu(expanded = intervalMenuOpen, onDismissRequest = { intervalMenuOpen = false }) {
                    syncIntervalOptions.forEach { minutes ->
                        DropdownMenuItem(text = { Text("$minutes minutes") }, onClick = {
                            BackgroundSync.setInterval(context, minutes)
                            interval = minutes
                            intervalMenuOpen = false
                            message = "Sync interval saved. Android controls when background work runs."
                        })
                    }
                }
            }
            Text("Minimum interval is 15 minutes. Battery and network restrictions may delay sync.")
            Text("Background work: ${work.firstOrNull()?.state ?: "not scheduled"}")
            Text(preferences.getString("status", "Background synchronization configured; Android controls timing.") ?: "")
            Text(if (preferences.contains("pending")) "Upload pending" else "No pending upload")
            Button(onClick = {
                check(preferences.edit().putBoolean("paused", false).commit())
                BackgroundSync.schedule(context)
                message = "Background synchronization resumed."
            }) { Text("Resume background sync") }
            Button(onClick = {
                check(preferences.edit().putBoolean("paused", true).commit())
                BackgroundSync.cancel(context)
                message = "Background synchronization paused."
            }) { Text("Pause background sync") }
            Button(enabled = !busy, onClick = { scope.launch {
                HealthSync.mutex.withLock {
                    check(preferences.edit().remove("pending").commit())
                }
                message = "Pending snapshot discarded. Sync now to read fresh values."
            } }) { Text("Discard pending snapshot") }
            val lastSuccess = preferences.getString("last_success", null)
            lastSuccess?.let { Text("Last successful upload: $it") }
            Button(enabled = enabled && !busy, onClick = {
                busy = true
                scope.launch {
                    try {
                        message = HealthSync(context).run(provider, LocalDate.parse(historicalDate))
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: HealthFailure) { message = failure.detail }
                    catch (failure: DeviceRequestFailure) { message = failure.message ?: "Vela upload failed." }
                    catch (_: Exception) { message = "Sync failed. Check connectivity, secure storage, phone date/time and Samsung Health permissions; retry. An interrupted upload can safely be repeated." }
                    finally { busy = false }
                }
            }) { Text(if (busy) "Syncing…" else "Sync now") }
        }
    }
}
