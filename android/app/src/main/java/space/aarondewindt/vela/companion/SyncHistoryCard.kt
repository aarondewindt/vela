package space.aarondewindt.vela.companion

import android.content.SharedPreferences
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
fun SyncHistoryCard(source: String, environment: String, permission: String, report: String?) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val history = remember { SyncHistory(context).apply { recoverInterrupted() } }
    var revision by remember { mutableIntStateOf(0) }
    var expanded by remember { mutableStateOf<String?>(null) }
    var sending by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf<String?>(null) }
    var limit by remember { mutableIntStateOf(10) }
    DisposableEffect(context) {
        val preferences = context.getSharedPreferences("sync_diagnostics", 0)
        val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> revision++ }
        preferences.registerOnSharedPreferenceChangeListener(listener)
        onDispose { preferences.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    val entries = remember(revision) { history.read() }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Sync history and debug logs")
            Text("Local manual and automatic attempts, including failures before Vela receives a request. Kept for 7 days, up to 100 entries / 192 KiB. Private health details are included only when you send them.")
            Text(if (report == null) "Current Samsung diagnostic report unavailable. Refresh readings to include one; history can still be sent." else "Current Samsung read report will be included.")
            Button(enabled = !sending, onClick = {
                sending = true
                feedback = null
                scope.launch {
                    try {
                        feedback = withContext(Dispatchers.IO) {
                            val uploader = DiagnosticUploader(context)
                            uploader.upload(uploader.snapshot(source, environment, permission, report))
                        }
                    } catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: DeviceRequestFailure) { feedback = "Debug upload failed: ${failure.message} Local history retained. Retry manually." }
                    catch (_: Exception) { feedback = "Debug upload failed. Check network, pairing and phone date/time. Local history retained; retry manually." }
                    finally { sending = false }
                }
            }) { Text(if (sending) "Sending debug logs…" else "Send debug logs to Vela") }
            feedback?.let { Text(it) }
            if (SyncHistory.storageFailed) Text("Diagnostic history storage is unavailable or a write failed. Health sync can continue; some history may be missing.")
            if (entries.isEmpty()) Text("No local sync attempts recorded yet.")
            entries.take(limit).forEach { entry ->
                val id = entry.getString("id")
                OutlinedButton(onClick = { expanded = if (expanded == id) null else id }) {
                    Text("${entry.optString("createdAt")} · ${entry.optString("trigger")} · ${entry.optString("status")}")
                }
                if (expanded == id) SelectionContainer { Text(entry.toString(2)) }
            }
            if (entries.size > limit) OutlinedButton(onClick = { limit = 100 }) { Text("Show older attempts") }
        }
    }
}
