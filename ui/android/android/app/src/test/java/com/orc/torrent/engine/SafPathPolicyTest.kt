package com.orc.torrent.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SafPathPolicyTest {
    @Test
    fun acceptsNestedRelativePath() {
        assertEquals(listOf("Movie", "video.mkv"), SafPathPolicy.parts("Movie/video.mkv"))
    }

    @Test
    fun rejectsTraversalAndAbsolutePaths() {
        assertThrows(IllegalArgumentException::class.java) { SafPathPolicy.parts("../escape") }
        assertThrows(IllegalArgumentException::class.java) { SafPathPolicy.parts("/absolute") }
    }
}
