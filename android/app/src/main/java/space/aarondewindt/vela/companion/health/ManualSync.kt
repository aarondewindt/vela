package space.aarondewindt.vela.companion.health

import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId

/** A daily snapshot, never a delta. Capture time is not Samsung's measurement/modified time. */
data class CalorieUpload(val metric: String, val value: Double, val date: String, val timezone: String,
    val observedAt: String, val periodStart: String, val periodEnd: String)

fun calorieUpload(reading: MetricReading): CalorieUpload? {
    val value = reading.valueKcal ?: return null
    require(value.isFinite() && value >= 0 && value <= 100000) { "Invalid SDK calorie value." }
    val w = reading.window
    return CalorieUpload(if (reading.metric == CalorieMetric.TOTAL_CALORIES_BURNED) "TOTAL_CALORIES" else "ACTIVE_CALORIES",
        value.toDouble(), w.date.toString(), w.zone.id, reading.receivedAt.toString(),
        w.start.atZone(w.zone).toInstant().toString(), w.endExclusive.atZone(w.zone).toInstant().toString())
}

class ManualSync(private val provider: HealthProvider, private val clock: Clock = Clock.systemUTC()) {
    suspend fun read(historicalDay: LocalDate, zone: ZoneId): List<CalorieUpload> {
        return readDays(listOf(historicalDay), zone)
    }

    suspend fun readDays(historicalDays: List<LocalDate>, zone: ZoneId): List<CalorieUpload> {
        require(historicalDays.size in 1..31)
        val now = clock.instant()
        val windows = historicalDays.flatMap { calorieWindows(now, zone, it) }
            .distinctBy { it.date to it.endExclusive }
            .filter { it.endExclusive <= now.atZone(zone).toLocalDateTime() }
        fun denied(): Nothing = throw HealthFailure(HealthFailure.Kind.PERMISSION,
            "Grant Samsung Health activity summary READ access before syncing.")
        if (!provider.hasReadPermission()) denied()
        val readings = windows.flatMap { window -> CalorieMetric.entries.map { provider.readCalories(window, it) } }
        if (!provider.hasReadPermission()) denied()
        val failures = readings.filter { it.error != null }
        if (failures.isNotEmpty()) throw HealthFailure(HealthFailure.Kind.QUERY,
            "Samsung Health query failed. Refresh diagnostics to inspect the SDK error, then retry sync.")
        return readings.mapNotNull(::calorieUpload)
    }
}
