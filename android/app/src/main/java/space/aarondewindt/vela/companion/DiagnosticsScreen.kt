package space.aarondewindt.vela.companion

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import space.aarondewindt.vela.companion.health.CalorieMetric
import space.aarondewindt.vela.companion.health.HealthFailure
import space.aarondewindt.vela.companion.health.HealthProvider
import space.aarondewindt.vela.companion.health.MetricReading
import space.aarondewindt.vela.companion.health.ReadCalorieDiagnostics
import space.aarondewindt.vela.companion.health.diagnosticReport

@Composable
fun VelaCompanionApp(provider: HealthProvider, resumeCount: Int = 0) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var historicalDate by remember { mutableStateOf(LocalDate.now().minusDays(1).toString()) }
    var permission by remember { mutableStateOf("Not checked") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var canResolve by remember { mutableStateOf(false) }
    var readings by remember { mutableStateOf(emptyList<MetricReading>()) }
    var copied by remember { mutableStateOf(false) }

    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        error = null
        canResolve = false
        readings = emptyList()
        copied = false
        scope.launch {
            try {
                block()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: HealthFailure) {
                permission = if (failure.kind == HealthFailure.Kind.PERMISSION) "Not granted" else "Unknown — check failed"
                error = failure.detail
                canResolve = failure.canResolve
            } catch (failure: IllegalArgumentException) {
                error = "Enter a completed historical date as YYYY-MM-DD, before today in the phone time zone."
            } catch (failure: Exception) {
                permission = "Unknown — operation failed"
                error = "${failure.javaClass.simpleName}: operation failed. Retry; inspect the selected range and SDK setup if it persists."
            } finally {
                busy = false
            }
        }
    }

    // Recheck on return from Samsung Health/settings. Never auto-request consent or read calories.
    LaunchedEffect(resumeCount) {
        action { permission = if (provider.hasReadPermission()) "Granted: activity summary, steps, sleep and body composition READ" else "Not granted" }
    }
    val parsedDate = runCatching { LocalDate.parse(historicalDate) }.getOrNull()
    val validDate = parsedDate != null && parsedDate < LocalDate.now()

    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
        Scaffold(modifier = Modifier.fillMaxSize()) { innerPadding ->
            Column(
                modifier = Modifier.padding(innerPadding).fillMaxSize()
                    .verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text("Vela Companion", style = MaterialTheme.typography.headlineLarge)
                PairingCard()
                SyncHistoryCard(provider.source, provider.environment, permission,
                    if (readings.isEmpty()) null else diagnosticReport(provider.source, provider.environment, readings))
                Text("Calorie diagnostics", style = MaterialTheme.typography.titleLarge)
                Text("Read-only Samsung Health experiment. Total already includes activity: never add active calories to total. Elapsed-day versus projected-day semantics remain UNVERIFIED.")
                DiagnosticCard("Source", "${provider.source}\n${provider.environment}\nSource filter: Samsung Health platform (deduplicated activity summary; individual device attribution unavailable).")
                DiagnosticCard("Permission", permission)
                Button(enabled = !busy, onClick = {
                    action {
                        permission = if (provider.requestReadPermission()) "Granted: activity summary, steps, sleep and body composition READ" else "Not granted — request denied or cancelled"
                    }
                }) { Text("Grant / manage read access") }
                Text("You can also revoke access in Samsung Health > Settings > Apps > Vela Companion. Return here to recheck permission.")
                OutlinedTextField(
                    value = historicalDate,
                    onValueChange = { historicalDate = it; readings = emptyList(); copied = false },
                    label = { Text("Historical day (YYYY-MM-DD)") },
                    enabled = !busy,
                    isError = !validDate,
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("Phone zone: ${ZoneId.systemDefault()}. Today is evaluated at refresh time. Queries use local calendar boundaries, end exclusive.")
                Button(enabled = !busy && validDate, onClick = {
                    action {
                        val date = LocalDate.parse(historicalDate)
                        readings = ReadCalorieDiagnostics(provider).read(date, ZoneId.systemDefault())
                        permission = "Granted: activity summary, steps, sleep and body composition READ"
                    }
                }) { Text(if (busy) "Working…" else "Refresh readings") }
                error?.let { DiagnosticCard("Read failed", it) }
                if (canResolve) Button(enabled = !busy, onClick = {
                    action { provider.resolveAvailability() }
                }) { Text("Resolve Samsung Health setup") }
                readings.groupBy { it.window }.forEach { (window, values) ->
                    DiagnosticCard(window.label, buildString {
                        appendLine("${window.date} [${window.zone}]")
                        values.forEach { value ->
                            val label = if (value.metric == CalorieMetric.TOTAL_CALORIES_BURNED) "Total" else "Active"
                            appendLine("$label: ${value.valueKcal?.toString() ?: "unavailable"} kcal")
                            value.diagnostic?.let { appendLine(it) }
                        }
                    }.trim())
                }
                if (readings.isNotEmpty()) {
                    val report = diagnosticReport(provider.source, provider.environment, readings)
                    Button(onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        val clip = ClipData.newPlainText("Vela calorie diagnostics", report)
                        // Android 13+ suppresses the sensitive clipboard preview.
                        clip.description.extras = android.os.PersistableBundle().apply {
                            putBoolean("android.content.extra.IS_SENSITIVE", true)
                        }
                        clipboard.setPrimaryClip(clip)
                        copied = true
                    }) { Text(if (copied) "Copied private readings" else "Copy diagnostic report") }
                    Text("Copy includes private calorie readings. Copying does not upload; scheduled synchronization may run separately. Results are held in memory and cleared on return, rotation, date edits or a new action.")
                    SelectionContainer { DiagnosticCard("Raw query details", report) }
                }
                ManualSyncCard(provider, historicalDate, !busy && validDate)
            }
        }
    }
}

@Composable
private fun DiagnosticCard(title: String, body: String) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
