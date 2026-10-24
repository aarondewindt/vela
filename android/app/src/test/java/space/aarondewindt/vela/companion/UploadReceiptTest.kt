package space.aarondewindt.vela.companion

import org.junit.Assert.fail
import org.junit.Test

class UploadReceiptTest {
    private val expected = listOf("TOTAL_CALORIES" to "2026-10-23", "ACTIVE_CALORIES" to "2026-10-23")
    private val valid = expected.map { UploadReceipt(it.first, it.second, "unchanged") }
    @Test fun acceptsEveryIdempotentOutcomeInAnyOrder() {
        listOf("created", "updated", "unchanged", "stale").forEach { status ->
            validateUploadReceipt(expected, 1, valid.reversed().map { it.copy(status = status) })
        }
    }
    @Test fun incompleteDuplicateWrongDayUnknownStatusAndWrongVersionAreRejected() {
        listOf(valid.take(1), listOf(valid[0], valid[0]), valid.map { it.copy(date = "2026-10-22") },
            valid.map { it.copy(status = "accepted") }).forEach { rows ->
            rejects { validateUploadReceipt(expected, 1, rows) }
        }
        rejects { validateUploadReceipt(expected, 2, valid) }
    }
    private fun rejects(block: () -> Unit) {
        try { block(); fail("Invalid acknowledgement must retain the outbox") }
        catch (_: IllegalStateException) { }
    }
}
