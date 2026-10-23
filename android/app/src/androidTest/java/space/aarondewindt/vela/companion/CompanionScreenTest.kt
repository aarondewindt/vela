package space.aarondewindt.vela.companion

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import org.junit.Rule
import org.junit.Test

class CompanionScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    @Test
    fun homeShowsUnconnectedStatus() {
        val activity = composeRule.activity
        composeRule.onNodeWithText(activity.getString(R.string.app_name)).assertIsDisplayed()
        composeRule.onNodeWithText(activity.getString(R.string.health_status)).performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText(activity.getString(R.string.server_status)).performScrollTo().assertIsDisplayed()
        composeRule.onNodeWithText(activity.getString(R.string.sync_status)).performScrollTo().assertIsDisplayed()
    }
}
