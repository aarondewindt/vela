package space.aarondewindt.vela.companion

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test

/** JVM test entry point. Add provider/domain behavior tests here in later phases. */
class BootstrapTest {
    @Test
    fun bootstrapManifestDoesNotAddPermissions() {
        val manifest = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/AndroidManifest.xml"))

        assertEquals(0, manifest.getElementsByTagName("uses-permission").length)
    }
}
