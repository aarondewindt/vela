package space.aarondewindt.vela.companion

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test
import space.aarondewindt.vela.companion.health.samsungSleepDateFilter

class SdkSleepDateFilterTest {
    @Test fun actualSdkFilterCoversOneWholeDateWithAnExclusiveFollowingDate() {
        val date = LocalDate.parse("2025-10-26")
        val filter = samsungSleepDateFilter(date)
        assertEquals(date, filter.startDate)
        assertEquals(date.plusDays(1), filter.endDate)
        assertTrue(filter.isInclusiveStart)
        assertFalse(filter.isInclusiveEnd)
    }
}
