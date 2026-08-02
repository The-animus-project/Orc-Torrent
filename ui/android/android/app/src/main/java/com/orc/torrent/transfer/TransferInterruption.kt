package com.orc.torrent.transfer

import android.content.Context
import com.orc.torrent.net.NativeApi

object TransferInterruption {
    /** Best-effort persistence when Android revokes background execution time. */
    fun pauseAndPersist(context: Context) {
        val appContext = context.applicationContext
        Thread({ runCatching { NativeApi.pauseAll(appContext) } }, "orc-persist-pause").start()
    }
}
