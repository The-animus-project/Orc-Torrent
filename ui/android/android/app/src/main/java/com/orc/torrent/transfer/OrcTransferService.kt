package com.orc.torrent.transfer

import android.app.Service
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import com.orc.torrent.net.NativeApi

class OrcTransferService : Service() {
    @Volatile private var stopped = false

    override fun onCreate() {
        super.onCreate()
        val notification = TransferNotifications.build(this)
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                TransferNotifications.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(TransferNotifications.NOTIFICATION_ID, notification)
        }
        Thread {
            while (!stopped) {
                val summary = runCatching { NativeApi.transferSummary(this) }.getOrNull()
                if (summary != null) {
                    if (!summary.active) break
                    getSystemService(NotificationManager::class.java)
                        .notify(TransferNotifications.NOTIFICATION_ID, TransferNotifications.build(this, summary))
                }
                Thread.sleep(5_000)
            }
            stopSelf()
        }.start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        stopped = true
        TransferInterruption.pauseAndPersist(this)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
