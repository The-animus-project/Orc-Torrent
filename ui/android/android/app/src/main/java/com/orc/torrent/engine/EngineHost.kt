package com.orc.torrent.engine

import android.content.Context
import android.net.Uri
import com.orc.torrent.net.NetworkMonitor
import org.json.JSONObject

object EngineHost {
    @Volatile private var bootstrap: JSONObject? = null

    @Synchronized
    fun start(context: Context, rootUri: Uri, adminToken: String): JSONObject {
        bootstrap?.let { return it }
        val appContext = context.applicationContext
        val network = NetworkMonitor.prime(appContext)
        val downloadRoot = appContext.filesDir.resolve("download-root").apply { mkdirs() }
        val configDir = appContext.filesDir.resolve("config").apply { mkdirs() }
        val stateDir = appContext.filesDir.resolve("state").apply { mkdirs() }
        val startPaused = !network.transfersAllowed
        val config = JSONObject()
            .put("adminToken", adminToken)
            .put("downloadDir", downloadRoot.absolutePath)
            .put("configDir", configDir.absolutePath)
            .put("stateDir", stateDir.absolutePath)
            .put("startPaused", startPaused)
        val result = JSONObject(OrcNative.nativeStart(config.toString(), SafDocumentBroker(appContext, rootUri)))
        bootstrap = result
        NetworkMonitor.start(appContext)
        return result
    }

    fun snapshot(): JSONObject? = bootstrap

    @Synchronized
    fun ensureStarted(context: Context): JSONObject {
        bootstrap?.let { return it }
        val preferences = context.getSharedPreferences("orc_android", Context.MODE_PRIVATE)
        val uri = preferences.getString("download_tree_uri", null)?.let(Uri::parse)
            ?: error("Download folder permission is missing")
        val token = preferences.getString("admin_token", null)
            ?: error("The ORC install token is missing")
        return start(context.applicationContext, uri, token)
    }

    @Synchronized
    fun stop() {
        if (bootstrap != null) OrcNative.nativeStop()
        bootstrap = null
    }
}
