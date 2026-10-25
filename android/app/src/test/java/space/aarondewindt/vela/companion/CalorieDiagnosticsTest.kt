package space.aarondewindt.vela.companion

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

class CalorieDiagnosticsTest {
    private val zone = ZoneId.of("Europe/Amsterdam")
    private val now = Instant.parse("2026-10-24T10:00:00Z")
    private val yesterday = LocalDate.parse("2026-10-23")
    private val clock = Clock.fixed(now, zone)

    @Test fun todayUsesCapturedTimeAndHistoricalRangeEndsAtNextMidnight() {
        val ranges = calorieWindows(now, zone, yesterday)
        assertEquals(3, ranges.size)
        assertEquals("2026-10-24T12:00", ranges[0].endExclusive.toString())
        assertEquals("2026-10-25T00:00", ranges[1].endExclusive.toString())
        assertEquals("2026-10-24T00:00", ranges[2].endExclusive.toString())
        assertEquals("2026-10-23T00:00", ranges[2].start.toString())
    }

    @Test fun completedDayUsesCalendarBoundariesAcrossDst() {
        listOf("2026-03-29" to 23L, "2026-10-25" to 25L).forEach { (date, hours) ->
            val day = LocalDate.parse(date)
            val later = day.plusDays(2).atStartOfDay(zone).toInstant()
            val range = calorieWindows(later, zone, day).last()
            assertEquals(hours, Duration.between(range.start.atZone(zone), range.endExclusive.atZone(zone)).toHours())
        }
    }

    @Test fun exactMidnightSkipsEmptyElapsedRangeAndUsesPhoneDate() {
        val atMidnight = Instant.parse("2026-10-23T22:00:00Z")
        val windows = calorieWindows(atMidnight, zone, yesterday)
        assertEquals(2, windows.size)
        assertEquals(LocalDate.parse("2026-10-24"), windows.first().date)
    }

    @Test fun repeatedHourRetainsBothActualCaptureInstantsInUploadsAndReport() {
        val first = Instant.parse("2026-10-25T00:30:00Z")
        val second = Instant.parse("2026-10-25T01:30:00Z")
        val day = LocalDate.parse("2026-10-24")
        val windows = listOf(first, second).map { calorieWindows(it, zone, day).first() }
        assertEquals(windows[0].endExclusive, windows[1].endExclusive)
        assertEquals(first, windows[0].endInstant)
        assertEquals(second, windows[1].endInstant)
        assertEquals(3600L, Duration.between(windows[0].endInstant, windows[1].endInstant).seconds)
        listOf(first, second).zip(windows).forEach { (capture, window) ->
            val reading = MetricReading(window, CalorieMetric.TOTAL_CALORIES_BURNED, capture, capture,
                listOf(AggregateRow(100f, window.startInstant, capture)))
            assertEquals(capture.toString(), calorieUpload(reading)!!.periodEnd)
            assertEquals(capture.toString(), dailyMetricUpload(window, "STEPS", 10.0, "steps", "sdk_steps_total", capture).periodEnd)
            val report = diagnosticReport("test", "test", listOf(reading))
            assertTrue(report.contains("Phone-zone UTC [${window.startInstant}, $capture)"))
            assertTrue(report.contains("end ${capture.atZone(zone).offset}"))
            assertTrue(report.contains("Repeated local query end"))
        }
    }

    @Test fun elapsedSyncRangesStayCorrectAcrossBothDstChangesAndMidnightRollover() {
        val captures = listOf(
            "2026-03-29T00:30:00Z", "2026-03-29T01:30:00Z",
            "2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z",
            "2026-10-24T21:59:59Z", "2026-10-24T22:00:00Z", "2026-10-24T22:00:01Z"
        ).map(Instant::parse)
        for (capture in captures) {
            val today = capture.atZone(zone).toLocalDate()
            val previousDays = (1L..7L).map(today::minusDays)
            val ranges = syncCalorieWindows(capture, zone, previousDays)
            assertTrue(ranges.all { it.endInstant <= capture })
            assertEquals(ranges.size, ranges.map { it.date }.distinct().size)
            assertEquals(previousDays.toSet(), ranges.filter { it.date < today }.map { it.date }.toSet())
            val elapsed = ranges.singleOrNull { it.date == today }
            if (capture == today.atStartOfDay(zone).toInstant()) assertNull(elapsed)
            else {
                assertEquals(capture, elapsed!!.endInstant)
                assertEquals(today.atStartOfDay(zone).toInstant(), elapsed.startInstant)
            }
        }
    }

    @Test fun syncAfterMidnightIncludesTheCompletedDstDayAsTwentyFiveHours() {
        val capture = Instant.parse("2026-10-25T23:00:00Z")
        val day = LocalDate.parse("2026-10-25")
        val ranges = syncCalorieWindows(capture, zone, listOf(day))
        assertEquals(1, ranges.size)
        assertEquals(25L, Duration.between(ranges.single().startInstant, ranges.single().endInstant).toHours())
        assertEquals("2026-10-24T22:00:00Z", ranges.single().startInstant.toString())
        assertEquals(capture, ranges.single().endInstant)
    }

    @Test(expected = IllegalArgumentException::class)
    fun historicalDateMustBeCompletedInSelectedZone() {
        calorieWindows(now, zone, LocalDate.parse("2026-10-24"))
    }

    @Test fun missingNullAndMultipleAggregatesRemainUnknownButZeroIsValid() {
        val window = calorieWindows(now, zone, yesterday).first()
        fun reading(rows: List<AggregateRow>) = MetricReading(window, CalorieMetric.TOTAL_CALORIES_BURNED, now, now, rows)
        assertNull(reading(emptyList()).valueKcal)
        assertNull(reading(listOf(AggregateRow(null, now, now))).valueKcal)
        val zero = AggregateRow(0f, now, now)
        assertEquals(0f, reading(listOf(zero)).valueKcal)
        assertNull(reading(listOf(zero, zero)).valueKcal)
    }

    @Test fun totalIsKeptSeparateFromActiveAndReportIncludesRawBoundaries() = runBlocking {
        val provider = FakeProvider()
        val readings = ReadCalorieDiagnostics(provider, clock).read(yesterday, zone)
        assertEquals(6, readings.size)
        assertEquals(2000f, readings[0].valueKcal)
        assertEquals(300f, readings[1].valueKcal)
        assertEquals(6, provider.calls)
        val report = diagnosticReport(provider.source, provider.environment, readings)
        assertTrue(report.contains("2000.0 kcal"))
        assertFalse(report.contains("2300"))
        assertTrue(report.contains("SDK row 0"))
        assertTrue(report.contains("Semantics UNVERIFIED"))
        assertTrue(report.contains("Europe/Amsterdam"))
        assertTrue(report.contains("measurement/last-sync/last-modified"))
    }

    @Test fun deniedPermissionPreventsAllReads() = runBlocking {
        val provider = FakeProvider(granted = false)
        expectFailure(HealthFailure.Kind.PERMISSION) { ReadCalorieDiagnostics(provider, clock).read(yesterday, zone) }
        assertEquals(0, provider.calls)
    }

    @Test fun revokedPermissionDuringRefreshDiscardsWholeResult() = runBlocking {
        val provider = FakeProvider(revokeAfterReads = true)
        expectFailure(HealthFailure.Kind.PERMISSION) { ReadCalorieDiagnostics(provider, clock).read(yesterday, zone) }
    }

    @Test fun queryFailureStaysVisibleWithoutHidingOtherMetrics() = runBlocking {
        val provider = FakeProvider(failure = HealthFailure(HealthFailure.Kind.QUERY, "SDK code 9006"))
        val readings = ReadCalorieDiagnostics(provider, clock).read(yesterday, zone)
        assertEquals("SDK code 9006", readings[0].diagnostic)
        assertNull(readings[0].valueKcal)
        assertEquals(300f, readings[1].valueKcal)
    }

    @Test fun authorizationFailureAbortsRatherThanReturningPartialHealthData() = runBlocking {
        val provider = FakeProvider(failure = HealthFailure(HealthFailure.Kind.AUTHORIZATION, "Not authorized"))
        expectFailure(HealthFailure.Kind.AUTHORIZATION) { ReadCalorieDiagnostics(provider, clock).read(yesterday, zone) }
    }

    @Test fun cancellationIsPropagated() = runBlocking {
        val provider = FakeProvider(cancel = true)
        try {
            ReadCalorieDiagnostics(provider, clock).read(yesterday, zone)
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { /* expected */ }
    }

    @Test fun manualSyncReadsElapsedAndHistoricalWithoutProjectionOrAddition() = runBlocking {
        val provider = FakeProvider()
        val uploads = ManualSync(provider, clock).read(yesterday, zone)
        assertEquals(4, uploads.size)
        assertEquals(4, provider.calls)
        assertEquals("TOTAL_CALORIES", uploads[0].metric)
        assertEquals(2000.0, uploads[0].value, 0.0)
        assertEquals("ACTIVE_CALORIES", uploads[1].metric)
        assertEquals(300.0, uploads[1].value, 0.0)
        assertEquals(now.toString(), uploads[0].periodEnd)
        assertEquals("2026-10-23", uploads[2].date)
    }

    @Test fun successfulEmptyTodayQueriesKeepHistoricalSyncWorkingWithoutUsingFullDayDiagnostics() = runBlocking {
        val capture = Instant.parse("2026-10-25T00:30:00Z")
        val day = LocalDate.parse("2026-10-24")
        val calls = mutableListOf<CalorieWindow>()
        val provider = object : HealthProvider by FakeProvider() {
            override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
                calls += window
                val rows = if (window.date == day) listOf(AggregateRow(100f, window.startInstant, window.endInstant)) else emptyList()
                return MetricReading(window, metric, capture, capture, rows)
            }
        }
        val uploads = ManualSync(provider, Clock.fixed(capture, zone)).read(day, zone)
        assertEquals(4, calls.size)
        assertEquals(2, uploads.size)
        assertTrue(uploads.all { it.date == day.toString() })
        assertTrue(calls.all { it.endInstant <= capture })
    }

    @Test fun manualSyncRejectsPermissionLossAndQueryFailures() = runBlocking {
        expectFailure(HealthFailure.Kind.PERMISSION) { ManualSync(FakeProvider(granted = false), clock).read(yesterday, zone) }
        expectFailure(HealthFailure.Kind.PERMISSION) { ManualSync(FakeProvider(revokeAfterReads = true), clock).read(yesterday, zone) }
        expectFailure(HealthFailure.Kind.QUERY) { ManualSync(FakeProvider(failure = HealthFailure(HealthFailure.Kind.QUERY, "query failed")), clock).read(yesterday, zone) }
    }

    @Test fun uploadSkipsMissingAndDoesNotInventZero() {
        val window = calorieWindows(now, zone, yesterday).first()
        assertNull(calorieUpload(MetricReading(window, CalorieMetric.TOTAL_CALORIES_BURNED, now, now)))
        val zero = MetricReading(window, CalorieMetric.TOTAL_CALORIES_BURNED, now, now, listOf(AggregateRow(0f, now, now)))
        assertEquals(0.0, calorieUpload(zero)!!.value, 0.0)
    }

    @Test fun backgroundReconciliationReadsTodayOnceAndSevenCompletedDays() = runBlocking {
        val provider = FakeProvider()
        val uploads = ManualSync(provider, clock).readDays((1L..7L).map { yesterday.plusDays(1).minusDays(it) }, zone)
        assertEquals(16, provider.calls)
        assertEquals(16, uploads.size)
        assertEquals(8, uploads.map { it.date }.distinct().size)
        assertEquals(16, uploads.map { it.metric to it.date }.distinct().size)
    }

    @Test fun reconciliationCancellationPropagates() = runBlocking {
        try {
            ManualSync(FakeProvider(cancel = true), clock).readDays(listOf(yesterday), zone)
            fail("Cancellation must propagate")
        } catch (_: CancellationException) { }
    }

    @Test fun unexpectedAggregateRowsFailRatherThanSilentlySkippingMeasurements() = runBlocking {
        val base = FakeProvider()
        val provider = object : HealthProvider by base {
            override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
                val reading = base.readCalories(window, metric)
                return reading.copy(rows = reading.rows + reading.rows)
            }
        }
        expectFailure(HealthFailure.Kind.QUERY) { ManualSync(provider, clock).read(yesterday, zone) }
    }

    private suspend fun expectFailure(kind: HealthFailure.Kind, block: suspend () -> Unit) {
        try { block(); fail("Expected $kind") } catch (failure: HealthFailure) { assertEquals(kind, failure.kind) }
    }

    private inner class FakeProvider(
        val granted: Boolean = true,
        val revokeAfterReads: Boolean = false,
        val failure: HealthFailure? = null,
        val cancel: Boolean = false,
    ) : HealthProvider {
        override val source = "Fake test source"
        override val environment = "test"
        var calls = 0
        override suspend fun hasReadPermission() = granted && !(revokeAfterReads && calls > 0)
        override suspend fun requestReadPermission() = granted
        override fun resolveAvailability() = Unit
        override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric): MetricReading {
            calls++
            if (cancel) throw CancellationException()
            if (calls == 1 && failure != null) throw failure
            val value = if (metric == CalorieMetric.TOTAL_CALORIES_BURNED) 2000f else 300f
            return MetricReading(window, metric, now, now, listOf(AggregateRow(value, window.start.atZone(zone).toInstant(), window.endExclusive.atZone(zone).toInstant())))
        }
    }
}
