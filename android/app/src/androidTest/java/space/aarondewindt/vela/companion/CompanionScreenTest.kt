package space.aarondewindt.vela.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.activity.ComponentActivity
import android.view.WindowManager
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import space.aarondewindt.vela.companion.health.*

/** UI verification with an injected provider; this does NOT validate Samsung SDK access. */
class CompanionScreenTest {
    @get:Rule val composeRule = createAndroidComposeRule<ComponentActivity>()

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
        // Keep only this synthetic test activity visible if Android has dozed/locked.
        // No lock credentials or persistent phone settings are changed.
        composeRule.runOnUiThread {
            composeRule.activity.apply {
                setTurnScreenOn(true)
                setShowWhenLocked(true)
                window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        composeRule.setContent { VelaCompanionApp(provider) }
        composeRule.onNodeWithText("Send debug logs to Vela").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Not granted").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Grant / manage read access").performScrollTo().performClick()
        composeRule.onNodeWithText("Granted: activity summary, steps, sleep and body composition READ").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Refresh readings").performScrollTo().performClick()
        composeRule.onNodeWithText("Today to refresh time").performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText("Copy diagnostic report").performScrollTo().assertIsDisplayed()
    }
}
