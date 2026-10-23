package space.aarondewindt.vela.companion

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import space.aarondewindt.vela.companion.health.SamsungHealthProvider

class MainActivity : ComponentActivity() {
    private var resumeCount by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val provider = SamsungHealthProvider(this)
        setContent { VelaCompanionApp(provider, resumeCount) }
    }

    override fun onResume() {
        super.onResume()
        resumeCount++
    }
}
