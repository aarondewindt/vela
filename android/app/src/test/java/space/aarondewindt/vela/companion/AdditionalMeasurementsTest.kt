package space.aarondewindt.vela.companion

import java.time.*
import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

class AdditionalMeasurementsTest {
    private val zone = ZoneId.of("Europe/Amsterdam")
    @Test fun sleepUsesSdkSleepDateAcrossMidnightAndDstWithoutClippingDuration() {
        val date = LocalDate.parse("2025-10-26")
        val w = CalorieWindow("Sleep date", date, date.atStartOfDay(), date.plusDays(1).atStartOfDay(), zone)
        val sleep = dailyMetricUpload(w, "SLEEP", 8.5, "hours", "sdk_sleep_date_total", Instant.parse("2025-10-27T12:00:00Z"))
        assertEquals("2025-10-26", sleep.date)
        assertEquals(8.5, sleep.value, 0.0)
        assertEquals("2025-10-25T22:00:00Z", sleep.periodStart)
        assertEquals("2025-10-26T23:00:00Z", sleep.periodEnd)
    }
    @Test fun bmrRetainsRealPointDateUnitsAndModificationTime() {
        val point = Instant.parse("2025-10-25T22:30:00Z")
        val modified = point.plusSeconds(3600)
        val bmr = bmrUpload(1700, point, modified, "sdk-record", zone, modified.plusSeconds(60))
        assertEquals("2025-10-26", bmr.date)
        assertEquals("kcal/day", bmr.unit)
        assertEquals(point.toString(), bmr.sourceObservedAt)
        assertEquals(modified.toString(), bmr.sourceModifiedAt)
        assertEquals("sdk-record", bmr.upstreamId)
        assertEquals(bmr.periodStart, bmr.periodEnd)
    }
    @Test fun invalidStepsSleepAndBmrAreRejectedAndZeroStepsArePreserved() {
        val w = calorieWindows(Instant.parse("2025-10-27T12:00:00Z"), zone, LocalDate.parse("2025-10-26")).last()
        assertEquals(0.0, dailyMetricUpload(w, "STEPS", 0.0, "steps", "sdk_steps_total").value, 0.0)
        for (bad in listOf(-1.0, 1.5, Double.NaN, 200001.0)) {
            try { dailyMetricUpload(w, "STEPS", bad, "steps", "sdk_steps_total"); fail() }
            catch (_: IllegalArgumentException) { }
        }
        try { dailyMetricUpload(w, "SLEEP", 25.0, "hours", "sdk_sleep_date_total"); fail() }
        catch (_: IllegalArgumentException) { }
        val now = Instant.now()
        try { bmrUpload(0, now, now, "id", zone, now); fail() }
        catch (_: IllegalArgumentException) { }
    }
}
