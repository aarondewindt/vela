package space.aarondewindt.vela.companion.health

import java.time.Clock
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException

class ReadCalorieDiagnostics(private val provider: HealthProvider, private val clock: Clock = Clock.systemUTC()) {
    suspend fun read(historicalDay: LocalDate, zone: ZoneId): List<MetricReading> {
        val windows = calorieWindows(clock.instant(), zone, historicalDay)
        requirePermission()
        val readings = windows.flatMap { window ->
            CalorieMetric.entries.map { metric ->
                val requestedAt = clock.instant()
                try {
                    provider.readCalories(window, metric)
                } catch (error: CancellationException) {
                    throw error
                } catch (error: HealthFailure) {
                    if (error.kind != HealthFailure.Kind.QUERY) throw error
                    MetricReading(window, metric, requestedAt, clock.instant(), error = error.detail)
                }
            }
        }
        // A revoke during a refresh must not leave a successful report visible.
        requirePermission()
        return readings
    }

    private suspend fun requirePermission() {
        if (!provider.hasReadPermission()) throw HealthFailure(HealthFailure.Kind.PERMISSION,
            "Activity summary READ is not granted. Use Grant / manage read access, then refresh.")
    }
}
