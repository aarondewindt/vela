package space.aarondewindt.vela.companion

import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.HealthFailure

class BackgroundSyncTest {
    @Test fun providerUnavailabilityRecoversWithoutManualResume() {
        assertFalse(requiresHealthIntervention(HealthFailure.Kind.AVAILABILITY))
        assertFalse(requiresHealthIntervention(HealthFailure.Kind.QUERY))
        assertTrue(requiresHealthIntervention(HealthFailure.Kind.PERMISSION))
        assertTrue(requiresHealthIntervention(HealthFailure.Kind.AUTHORIZATION))
    }
    @Test fun unsupportedOrCorruptIntervalsFallBackToHourly() {
        listOf(-1, 0, 10, 14, 16, 1000).forEach { assertEquals(60, validSyncInterval(it)) }
        listOf(15, 30, 60, 120).forEach { assertEquals(it, validSyncInterval(it)) }
    }

    @Test fun temporaryFailuresHaveFiniteRetryBudget() {
        listOf(null, 408, 429, 500, 503, 599).forEach { status ->
            assertTrue(retrySync(status, 0))
            assertTrue(retrySync(status, 3))
            assertFalse(retrySync(status, 4))
            assertFalse(retrySync(status, 20))
        }
    }
    @Test fun permanentFailuresNeverRetry() {
        listOf(301, 400, 401, 403, 404, 409, 413, 422).forEach {
            assertFalse(retrySync(it, 0))
        }
    }
}
