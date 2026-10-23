package space.aarondewindt.vela.companion

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceOriginTest {
    @Test fun normalizesHttpsOrigin() {
        assertEquals("https://vela.example", deviceOrigin(" https://vela.example/ "))
        assertEquals("https://vela.example:8443", deviceOrigin("https://vela.example:8443"))
    }
    @Test fun rejectsUnsafeServerInputs() {
        listOf("http://vela.example", "https://user:password@vela.example", "https://vela.example/path", "https://vela.example?token=secret", "https://vela.example#fragment").forEach {
            assertThrows(IllegalArgumentException::class.java) { deviceOrigin(it) }
        }
    }
}
