package space.aarondewindt.vela.companion

import java.io.File
import javax.xml.parsers.DocumentBuilderFactory
import org.junit.Assert.assertEquals
import org.junit.Test

/** JVM test entry point. Add provider/domain behavior tests here in later phases. */
class BootstrapTest {
    @Test
    fun manifestAllowsOnlyInternetAndDisablesBackupAndCleartext() {
        val manifest = DocumentBuilderFactory.newInstance().newDocumentBuilder()
            .parse(File("src/main/AndroidManifest.xml"))

        val permissions = manifest.getElementsByTagName("uses-permission")
        assertEquals(1, permissions.length)
        assertEquals("android.permission.INTERNET", permissions.item(0).attributes.getNamedItem("android:name").nodeValue)
        val application = manifest.getElementsByTagName("application").item(0).attributes
        assertEquals("false", application.getNamedItem("android:allowBackup").nodeValue)
        assertEquals("false", application.getNamedItem("android:usesCleartextTraffic").nodeValue)
    }
}
