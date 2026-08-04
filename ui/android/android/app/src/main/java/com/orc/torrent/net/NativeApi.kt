package com.orc.torrent.net

import android.content.Context
import com.orc.torrent.engine.EngineHost
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object NativeApi {
    data class TransferSummary(val active: Boolean, val progressPercent: Int, val text: String)
    data class ApiResponse(val status: Int, val statusText: String, val body: String)

    private fun connection(context: Context, path: String, method: String): HttpURLConnection {
        require(path.startsWith('/') && !path.startsWith("//") && path.length <= 4096) { "Invalid daemon path" }
        val bootstrap = EngineHost.snapshot() ?: EngineHost.ensureStarted(context)
        val connection = URL(bootstrap.getString("baseUrl") + path).openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5_000
        connection.readTimeout = 5_000
        connection.setRequestProperty("x-admin-token", bootstrap.getString("adminToken"))
        connection.setRequestProperty("origin", "https://localhost")
        return connection
    }

    fun request(context: Context, path: String, method: String, body: String? = null): ApiResponse {
        require(method in setOf("GET", "POST", "PUT", "PATCH", "DELETE")) { "Unsupported daemon method" }
        require(body == null || body.toByteArray(Charsets.UTF_8).size <= 10 * 1024 * 1024) { "Daemon body is too large" }
        val connection = connection(context, path, method)
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            connection.outputStream.bufferedWriter().use { it.write(body) }
        }
        val status = connection.responseCode
        val stream = if (status >= 400) connection.errorStream else connection.inputStream
        val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
        require(responseBody.toByteArray(Charsets.UTF_8).size <= 16 * 1024 * 1024) { "Daemon response is too large" }
        return ApiResponse(status, connection.responseMessage.orEmpty(), responseBody)
    }

    fun get(context: Context, path: String): JSONObject {
        val response = request(context, path, "GET")
        check(response.status < 400) { "Daemon returned HTTP ${response.status}" }
        return JSONObject(response.body)
    }

    fun post(context: Context, path: String, body: JSONObject? = null) {
        val response = request(context, path, "POST", body?.toString())
        check(response.status < 400) { "Daemon returned HTTP ${response.status}: ${response.body}" }
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
