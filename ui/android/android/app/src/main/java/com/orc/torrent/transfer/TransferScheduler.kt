package com.orc.torrent.transfer

import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import com.orc.torrent.net.NativeApi

object TransferScheduler {
    private const val JOB_ID = 8733

    fun scheduleIfActive(context: Context) {
        val appContext = context.applicationContext
        Thread {
            if (runCatching { NativeApi.hasActiveTransfers(appContext) }.getOrDefault(false)) {
                schedule(appContext)
            } else {
                cancel(appContext)
            }
        }.start()
    }

    private fun schedule(context: Context) {
        val appContext = context.applicationContext
        val allowCellular = appContext.getSharedPreferences("orc_android", Context.MODE_PRIVATE)
            .getBoolean("allow_cellular", false)
        if (Build.VERSION.SDK_INT >= 34) {
            val network = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .apply {
                    if (!allowCellular) addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                }
                .build()
            val job = JobInfo.Builder(JOB_ID, ComponentName(appContext, OrcTransferJobService::class.java))
                .setUserInitiated(true)
                .setRequiredNetwork(network)
                .setEstimatedNetworkBytes(
                    JobInfo.NETWORK_BYTES_UNKNOWN.toLong(),
                    JobInfo.NETWORK_BYTES_UNKNOWN.toLong(),
                )
                .build()
            appContext.getSystemService(JobScheduler::class.java).schedule(job)
        } else {
            appContext.startForegroundService(Intent(appContext, OrcTransferService::class.java))
        }
    }

    private fun cancel(context: Context) {
        if (Build.VERSION.SDK_INT >= 34) {
            context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)
        } else {
            context.stopService(Intent(context, OrcTransferService::class.java))
        }
    }
}
