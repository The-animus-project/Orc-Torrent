package com.orc.torrent.transfer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.orc.torrent.MainActivity
import com.orc.torrent.R
import com.orc.torrent.net.NativeApi

object TransferNotifications {
    const val CHANNEL_ID = "orc_transfers"
    const val NOTIFICATION_ID = 8733

    fun ensureChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Torrent transfers", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Active ORC Torrent downloads and seeding"
            }
        )
    }

    fun build(context: Context, summary: NativeApi.TransferSummary? = null): Notification {
        ensureChannel(context)
        val openIntent = PendingIntent.getActivity(
            context,
            1,
            Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val pauseIntent = PendingIntent.getBroadcast(
            context,
            2,
            Intent(context, PauseAllReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_orc)
            .setContentTitle("ORC TORRENT")
            .setContentText(summary?.text ?: "Preparing transfers")
            .setProgress(100, summary?.progressPercent ?: 0, summary == null)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(openIntent)
            .addAction(0, "Pause all", pauseIntent)
            .build()
    }
}
