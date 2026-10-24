package space.aarondewindt.vela.companion

data class UploadReceipt(val metric: String, val date: String, val status: String)

/** A successful HTTP response must acknowledge every row before the outbox is removed. */
fun validateUploadReceipt(expected: List<Pair<String, String>>, version: Int, results: List<UploadReceipt>) {
    check(version == 1 && results.size == expected.size &&
        results.map { it.metric to it.date }.toSet() == expected.toSet() &&
        results.all { it.status in setOf("created", "updated", "unchanged", "stale") }) {
        "Unexpected upload acknowledgement. Pending snapshot retained; check server compatibility."
    }
}
