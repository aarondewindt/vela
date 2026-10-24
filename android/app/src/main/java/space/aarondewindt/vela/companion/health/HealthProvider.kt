package space.aarondewindt.vela.companion.health

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Provider-neutral read boundary; no upload, scheduling or write operations. */
interface HealthProvider {
    val source: String
    val environment: String
    suspend fun hasReadPermission(): Boolean
    suspend fun requestReadPermission(): Boolean
    suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading
    suspend fun readAdditionalMeasurements(windows: List<CalorieWindow>): List<CalorieUpload> = emptyList()
    fun resolveAvailability()
}

enum class CalorieMetric { TOTAL_CALORIES_BURNED, TOTAL_ACTIVE_CALORIES_BURNED }

data class CalorieWindow(
    val label: String,
    val date: LocalDate,
    val start: LocalDateTime,
    val endExclusive: LocalDateTime,
    val zone: ZoneId,
) {
    init { require(endExclusive > start) { "A query must have a positive local time range." } }
}

/** Use calendar boundaries, never midnight + 24 hours (DST days can be 23/25h). */
fun calorieWindows(now: Instant, zone: ZoneId, historicalDay: LocalDate): List<CalorieWindow> {
    val localNow = now.atZone(zone).toLocalDateTime()
    val today = localNow.toLocalDate()
    require(historicalDay < today) { "Historical date must be before today in the phone time zone." }
    val start = today.atStartOfDay()
    return buildList {
        if (localNow > start) add(CalorieWindow("Today to refresh time", today, start, localNow, zone))
        add(CalorieWindow("Today full calendar day (projection diagnostic)", today, start, today.plusDays(1).atStartOfDay(), zone))
        add(CalorieWindow("Completed historical day", historicalDay, historicalDay.atStartOfDay(), historicalDay.plusDays(1).atStartOfDay(), zone))
    }
}

data class AggregateRow(val valueKcal: Float?, val start: Instant, val endExclusive: Instant)

data class MetricReading(
    val window: CalorieWindow,
    val metric: CalorieMetric,
    val requestedAt: Instant,
    val receivedAt: Instant,
    val rows: List<AggregateRow> = emptyList(),
    val error: String? = null,
) {
    // Ungrouped SDK aggregate should contain one row. Do not silently sum surprises,
    // coerce missing to zero, or combine total with active calories.
    val valueKcal: Float? get() = if (error == null) rows.singleOrNull()?.valueKcal else null
    val diagnostic: String? get() = when {
        error != null -> error
        rows.isEmpty() -> "No data returned; this is not zero."
        rows.size != 1 -> "Unexpected ${rows.size} aggregate rows; inspect raw results, no sum applied."
        rows.single().valueKcal == null -> "SDK returned a null aggregate; value unavailable."
        else -> null
    }
}

class HealthFailure(
    val kind: Kind,
    val detail: String,
    val canResolve: Boolean = false,
    cause: Throwable? = null,
) : Exception(detail, cause) {
    enum class Kind { PERMISSION, AVAILABILITY, AUTHORIZATION, QUERY }
}

fun diagnosticReport(source: String, environment: String, readings: List<MetricReading>): String = buildString {
    appendLine("Vela calorie diagnostic — $source")
    appendLine(environment)
    appendLine("Permission: ACTIVITY_SUMMARY READ granted at refresh; source filter: Samsung Health platform")
    appendLine("Units: kcal. Total already includes activity; never add active. Semantics UNVERIFIED.")
    appendLine("LocalTimeFilter uses local wall times. UTC query bounds below are phone-zone interpretations.")
    appendLine("Aggregate boundaries are NOT measurement/last-sync/last-modified timestamps; SDK does not expose those here.")
    readings.forEach { reading ->
        val w = reading.window
        appendLine("\n${w.label}: ${w.date} [${w.zone}]")
        appendLine("${reading.metric}: ${reading.valueKcal?.toString() ?: "unavailable"} kcal")
        appendLine("Query local [${w.start}, ${w.endExclusive})")
        appendLine("Derived UTC [${w.start.atZone(w.zone).toInstant()}, ${w.endExclusive.atZone(w.zone).toInstant()})")
        appendLine("Request: ${reading.requestedAt}; response: ${reading.receivedAt}")
        reading.diagnostic?.let { appendLine(it) }
        reading.rows.forEachIndexed { index, row ->
            appendLine("SDK row $index: ${row.valueKcal} kcal; [${row.start}, ${row.endExclusive})")
        }
    }
}
