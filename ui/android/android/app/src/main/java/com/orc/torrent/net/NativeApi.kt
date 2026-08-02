package com.orc.torrent.net

import android.content.Context
import com.orc.torrent.engine.EngineHost
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object NativeApi {
    data class TransferSummary(val active: Boolean, val progressPercent: Int, val text: String)
    private fun connection(context: Context, path: String, method: String): HttpURLConnection {
        val bootstrap = EngineHost.snapshot() ?: EngineHost.ensureStarted(context)
        val connection = URL(bootstrap.getString("baseUrl") + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.setRequestProperty("x-admin-token", bootstrap.getString("adminToken"))
        return connection
    }

    fun get(context: Context, path: String): JSONObject {
        val connection = connection(context, path, "GET")
        return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
    }

    fun post(context: Context, path: String, body: JSONObject? = null) {
        val connection = connection(context, path, "POST")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.outputStream.bufferedWriter().use { it.write(body.toString()) }
        }
        connection.inputStream.close()
    }

    fun pauseAll(context: Context) {
        val items = get(context, "/torrents").optJSONArray("items") ?: JSONArray()
        for (index in 0 until items.length()) {
            val torrent = items.getJSONObject(index)
            if (torrent.optBoolean("running")) {
                runCatching { post(context, "/torrents/${torrent.getString("id")}/stop") }
            }
        }
    }

    fun hasActiveTransfers(context: Context): Boolean {
        val items = get(context, "/torrents").optJSONArray("items") ?: return false
        return (0 until items.length()).any { items.getJSONObject(it).optBoolean("running") }
    }

    fun transferSummary(context: Context): TransferSummary {
        val items = get(context, "/torrents").optJSONArray("items") ?: JSONArray()
        var active = false
        var totalBytes = 0L
        var downloadedBytes = 0L
        var downRate = 0L
        var upRate = 0L
        for (index in 0 until items.length()) {
            val torrent = items.getJSONObject(index)
            if (!torrent.optBoolean("running")) continue
            active = true
            val status = get(context, "/torrents/${torrent.getString("id")}/status")
            totalBytes += status.optLong("total_bytes")
            downloadedBytes += status.optLong("downloaded_bytes")
            downRate += status.optLong("down_rate_bps")
            upRate += status.optLong("up_rate_bps")
        }
        val progress = if (totalBytes > 0L) ((downloadedBytes * 100L) / totalBytes).toInt().coerceIn(0, 100) else 0
        return TransferSummary(active, progress, "↓ ${formatRate(downRate)} · ↑ ${formatRate(upRate)}")
    }

    private fun formatRate(bytes: Long): String = when {
        bytes >= 1024L * 1024L -> "%.1f MB/s".format(bytes / (1024.0 * 1024.0))
        bytes >= 1024L -> "%.0f KB/s".format(bytes / 1024.0)
        else -> "$bytes B/s"
    }
}
