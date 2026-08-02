package com.orc.torrent.transfer

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.orc.torrent.net.NativeApi

class PauseAllReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val pending = goAsync()
        Thread {
            runCatching { NativeApi.pauseAll(context.applicationContext) }
            pending.finish()
        }.start()
    }
}
