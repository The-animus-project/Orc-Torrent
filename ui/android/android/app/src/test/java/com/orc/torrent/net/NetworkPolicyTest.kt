package com.orc.torrent.net

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkPolicyTest {
    @Test
    fun defaultsToUnmeteredNetworks() {
        assertTrue(networkPolicyAllows(false, false, false, false))
        assertFalse(networkPolicyAllows(false, false, false, true))
    }

    @Test
    fun cellularOptInAllowsMeteredNetwork() {
        assertTrue(networkPolicyAllows(false, false, true, true))
    }

    @Test
    fun killSwitchRequiresVpnOnEveryTransport() {
        assertFalse(networkPolicyAllows(true, false, true, false))
        assertTrue(networkPolicyAllows(true, true, true, true))
    }
}
