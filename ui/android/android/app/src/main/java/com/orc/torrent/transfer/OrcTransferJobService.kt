package com.orc.torrent.transfer

import android.app.job.JobParameters
import android.app.job.JobService
import android.app.NotificationManager
import android.os.Build
import com.orc.torrent.net.NativeApi

class OrcTransferJobService : JobService() {
    @Volatile private var stopped = false

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        if (Build.VERSION.SDK_INT >= 34) {
            setNotification(
                params,
                TransferNotifications.NOTIFICATION_ID,
                TransferNotifications.build(this),
                JOB_END_NOTIFICATION_POLICY_REMOVE,
            )
        }
        Thread {
            while (!stopped) {
                val summary = runCatching { NativeApi.transferSummary(this) }.getOrNull()
                if (summary != null) {
                    if (!summary.active) break
                    if (Build.VERSION.SDK_INT >= 34) {
                        setNotification(params, TransferNotifications.NOTIFICATION_ID, TransferNotifications.build(this, summary), JOB_END_NOTIFICATION_POLICY_REMOVE)
                    } else {
                        getSystemService(NotificationManager::class.java).notify(TransferNotifications.NOTIFICATION_ID, TransferNotifications.build(this, summary))
                    }
                }
                Thread.sleep(5_000)
            }
            if (!stopped) jobFinished(params, false)
        }.start()
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        TransferInterruption.pauseAndPersist(this)
        return true
    }
}
