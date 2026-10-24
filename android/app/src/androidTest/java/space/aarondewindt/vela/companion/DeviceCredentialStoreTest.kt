package space.aarondewindt.vela.companion

import android.content.Context
import android.content.ContextWrapper
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class DeviceCredentialStoreTest {
    @Test fun roundTripsEncryptedCredentialAndForgetsIt() {
        val context = object : ContextWrapper(InstrumentationRegistry.getInstrumentation().targetContext) {
            override fun getSharedPreferences(name: String, mode: Int) =
                super.getSharedPreferences("${name}_instrumentation_test", mode)
        }
        val store = DeviceCredentialStore(context)
        val token = "vela_device_test-secret-never-store-as-plaintext"
        try {
            store.save("https://vela.example", token)
            assertEquals("https://vela.example" to token, store.read())
            val stored = context.getSharedPreferences("device_credentials", Context.MODE_PRIVATE).all.toString()
            assertFalse(stored.contains(token))
            assertFalse(stored.contains("https://vela.example"))
            store.clear()
            assertNull(store.read())
        } finally { store.clear() }
    }
}
