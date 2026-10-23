package space.aarondewindt.vela.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

/** UI verification with an injected provider; this does NOT validate Samsung SDK access. */
class CompanionScreenTest {
    @get:Rule val composeRule = createComposeRule()

    @Test fun deniedReadAndManualPermissionGrantAreVisible() {
        val provider = object : HealthProvider {
            override val source = "Test source"
            override val environment = "test"
            private var granted = false
            override suspend fun hasReadPermission() = granted
            override suspend fun requestReadPermission(): Boolean { granted = true; return true }
            override fun resolveAvailability() = Unit
            override suspend fun readCalories(window: CalorieWindow, metric: CalorieMetric) =
                MetricReading(window, metric, Instant.now(), Instant.now())
        }
        composeRule.setContent { VelaCompanionApp(provider) }
        composeRule.onNodeWithText("Not granted").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Grant / manage read access").performScrollTo().performClick()
        composeRule.onNodeWithText("Granted: ACTIVITY_SUMMARY READ").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Refresh readings").performScrollTo().performClick()
        composeRule.onNodeWithText("Today to refresh time").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Copy diagnostic report").performScrollTo().assertIsDisplayed()
    }
}
