package com.orc.torrent.net

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.HandlerThread
import com.orc.torrent.engine.OrcNative

internal fun networkPolicyAllows(
    killSwitch: Boolean,
    vpnActive: Boolean,
    allowCellular: Boolean,
    metered: Boolean,
): Boolean = (!killSwitch || vpnActive) && (allowCellular || !metered)

object NetworkMonitor {
    data class Snapshot(val vpnActive: Boolean, val transfersAllowed: Boolean)
    data class Update(val transfersAllowed: Boolean, val rebindRequired: Boolean)

    private var callback: ConnectivityManager.NetworkCallback? = null
    private var boundVpn: Network? = null
    private val callbackThread by lazy {
        HandlerThread("orc-network-policy").apply { start() }
    }
    @Volatile var vpnActive: Boolean = false
        private set

    private fun transfersAllowed(context: Context, manager: ConnectivityManager): Boolean {
        val preferences = context.getSharedPreferences("orc_android", Context.MODE_PRIVATE)
        return networkPolicyAllows(
            killSwitch = preferences.getBoolean("kill_switch", false),
            vpnActive = vpnActive,
            allowCellular = preferences.getBoolean("allow_cellular", false),
            metered = manager.isActiveNetworkMetered,
        )
    }

    @Synchronized
    fun prime(context: Context): Snapshot {
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val preferences = context.getSharedPreferences("orc_android", Context.MODE_PRIVATE)
        val vpn = manager.allNetworks.firstOrNull { network ->
            manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        }
        vpnActive = vpn != null
        val killSwitch = preferences.getBoolean("kill_switch", false)
        val bindingReady = if (killSwitch) {
            vpn != null && manager.bindProcessToNetwork(vpn)
        } else {
            manager.bindProcessToNetwork(null)
        }
        boundVpn = if (killSwitch && bindingReady) vpn else null
        val allowed = bindingReady && transfersAllowed(context, manager)
        OrcNative.nativeUpdateNetwork(vpnActive, allowed, false)
        return Snapshot(vpnActive = vpnActive, transfersAllowed = allowed)
    }

    @Synchronized
    fun start(context: Context) {
        if (callback != null) return
        val appContext = context.applicationContext
        val manager = appContext.getSystemService(ConnectivityManager::class.java)
        val preferences = appContext.getSharedPreferences("orc_android", Context.MODE_PRIVATE)

        fun enforce() {
            synchronized(NetworkMonitor) {
                val killSwitch = preferences.getBoolean("kill_switch", false)
                val allowCellular = preferences.getBoolean("allow_cellular", false)
                val vpn = manager.allNetworks.firstOrNull { network ->
                    manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
                }
                vpnActive = vpn != null
                val bindingReady = if (killSwitch) {
                    vpn != null && manager.bindProcessToNetwork(vpn)
                } else {
                    manager.bindProcessToNetwork(null)
                }
                val nextBoundVpn = if (killSwitch && bindingReady) vpn else null
                val rebindRequired = boundVpn != nextBoundVpn
                boundVpn = nextBoundVpn
                val allowed = bindingReady && networkPolicyAllows(
                    killSwitch = killSwitch,
                    vpnActive = vpnActive,
                    allowCellular = allowCellular,
                    metered = manager.isActiveNetworkMetered,
                )
                OrcNative.nativeUpdateNetwork(vpnActive, allowed, rebindRequired)
                if (!allowed) {
                    runCatching { NativeApi.pauseAll(appContext) }
                }
            }
        }

        val handler = Handler(callbackThread.looper)
        callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = enforce()
            override fun onLost(network: Network) = enforce()
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) = enforce()
        }.also {
            manager.registerNetworkCallback(NetworkRequest.Builder().build(), it, handler)
        }
        handler.post { enforce() }
    }

    @Synchronized
    fun refresh(context: Context): Update {
        start(context)
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val preferences = context.getSharedPreferences("orc_android", Context.MODE_PRIVATE)
        val vpn = manager.allNetworks.firstOrNull { network ->
            manager.getNetworkCapabilities(network)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true
        }
        vpnActive = vpn != null
        val killSwitch = preferences.getBoolean("kill_switch", false)
        val bindingReady = if (killSwitch) {
            vpn != null && manager.bindProcessToNetwork(vpn)
        } else {
            manager.bindProcessToNetwork(null)
        }
        val nextBoundVpn = if (killSwitch && bindingReady) vpn else null
        val rebindRequired = boundVpn != nextBoundVpn
        boundVpn = nextBoundVpn
        val allowed = bindingReady && transfersAllowed(context.applicationContext, manager)
        OrcNative.nativeUpdateNetwork(vpnActive, allowed, rebindRequired)
        return Update(transfersAllowed = allowed, rebindRequired = rebindRequired)
    }
}
