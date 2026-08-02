package com.orc.torrent.engine

internal object OrcNative {
    init {
        System.loadLibrary("orc_android")
    }

    external fun nativeStart(configJson: String, broker: SafDocumentBroker): String
    external fun nativeStop()
    external fun nativeUpdateNetwork(vpnActive: Boolean, transfersAllowed: Boolean, rebindRequired: Boolean)
}
