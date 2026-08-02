package com.orc.torrent.plugin

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.webkit.MimeTypeMap
import androidx.activity.result.ActivityResult
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.orc.torrent.engine.EngineHost
import com.orc.torrent.engine.SafDocumentBroker
import com.orc.torrent.net.NativeApi
import com.orc.torrent.net.NetworkMonitor
import com.orc.torrent.transfer.TransferScheduler
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.Base64

@CapacitorPlugin(name = "OrcAndroid")
class OrcAndroidPlugin : Plugin() {
    private val preferences by lazy {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
    }

    override fun load() {
        active = this
        pendingIntent?.let {
            pendingIntent = null
            dispatchIntent(it)
        }
    }

    override fun handleOnResume() {
        super.handleOnResume()
        notifyListeners("appStateChange", JSObject().put("active", true), true)
    }

    override fun handleOnPause() {
        notifyListeners("appStateChange", JSObject().put("active", false), true)
        super.handleOnPause()
    }

    private fun rootUri(): Uri? = preferences.getString(KEY_TREE_URI, null)?.let(Uri::parse)

    private fun PluginCall.rejectWithCause(message: String, cause: Throwable) {
        reject(message, cause as? Exception ?: RuntimeException(cause))
    }

    private fun hasPersistedGrant(uri: Uri): Boolean =
        context.contentResolver.persistedUriPermissions.any { it.uri == uri && it.isReadPermission && it.isWritePermission }

    private fun adminToken(): String {
        preferences.getString(KEY_ADMIN_TOKEN, null)?.let { return it }
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val token = bytes.joinToString("") { "%02x".format(it) }
        preferences.edit().putString(KEY_ADMIN_TOKEN, token).apply()
        return token
    }

    private fun storageLabel(uri: Uri?): String? = uri?.let {
        DocumentFile.fromTreeUri(context, it)?.name
    }

    private fun hasPersistedTorrents(): Boolean {
        val catalog = context.filesDir.resolve("state/torrent-catalog.json")
        if (!catalog.isFile) return false
        return runCatching {
            JSONObject(catalog.readText()).optJSONArray("torrents")?.length()?.let { it > 0 } == true
        }.getOrDefault(true)
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4103)
        }
    }

    private fun bootstrapPayload(): JSObject {
        val uri = rootUri()
        val storageReady = uri != null && hasPersistedGrant(uri)
        val native = if (storageReady) EngineHost.start(context, uri!!, adminToken()) else JSONObject()
        if (storageReady) {
            NetworkMonitor.start(context)
            TransferScheduler.scheduleIfActive(context)
        }
        return JSObject()
            .put("baseUrl", native.optString("baseUrl"))
            .put("adminToken", native.optString("adminToken", adminToken()))
            .put("storageReady", storageReady)
            .put("storageLabel", storageLabel(uri))
            .put("allowCellular", preferences.getBoolean(KEY_CELLULAR, false))
            .put("killSwitchEnabled", preferences.getBoolean(KEY_KILL_SWITCH, false))
            .put("vpnActive", NetworkMonitor.vpnActive)
    }

    @PluginMethod
    fun bootstrap(call: PluginCall) {
        runCatching { bootstrapPayload() }
            .onSuccess(call::resolve)
            .onFailure { call.rejectWithCause("Unable to start the ORC engine", it) }
    }

    @PluginMethod
    fun chooseDownloadTree(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
            addFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or
                    Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION,
            )
        }
        startActivityForResult(call, intent, "downloadTreeResult")
    }

    @ActivityCallback
    private fun downloadTreeResult(call: PluginCall, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve(JSObject().put("granted", false).put("label", JSONObject.NULL))
            return
        }
        try {
            val currentRoot = rootUri()
            require(currentRoot == null || currentRoot == uri || !hasPersistedTorrents()) {
                "Remove all torrents before changing the global download folder. You can reselect the same folder to restore its permission."
            }
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION,
            )
            val probe = DocumentFile.fromTreeUri(context, uri)
                ?: error("The selected folder is unavailable")
            require(probe.canRead() && probe.canWrite()) { "Select a writable local folder" }
            SafDocumentBroker(context, uri).validateRoot()
            preferences.edit().putString(KEY_TREE_URI, uri.toString()).apply()
            EngineHost.stop()
            EngineHost.start(context, uri, adminToken())
            NetworkMonitor.start(context)
            call.resolve(JSObject().put("granted", true).put("label", probe.name))
        } catch (error: Exception) {
            call.reject("The selected folder cannot be used for torrent downloads", error)
        }
    }

    @PluginMethod
    fun pickTorrentFile(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "application/x-bittorrent"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/x-bittorrent", "application/octet-stream"))
        }
        startActivityForResult(call, intent, "torrentFileResult")
    }

    @ActivityCallback
    private fun torrentFileResult(call: PluginCall, result: ActivityResult) {
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            call.resolve()
            return
        }
        runCatching { torrentPayload(uri) }
            .onSuccess(call::resolve)
            .onFailure { call.rejectWithCause("Unable to read the torrent file", it) }
    }

    private fun torrentPayload(uri: Uri): JSObject {
        val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
            input.readNBytes(MAX_TORRENT_BYTES + 1)
        } ?: error("Unable to open torrent file")
        require(bytes.size <= MAX_TORRENT_BYTES) { "Torrent file is larger than 10 MB" }
        val name = DocumentFile.fromSingleUri(context, uri)?.name ?: "download.torrent"
        return JSObject().put("name", name).put("base64", Base64.getEncoder().encodeToString(bytes))
    }

    @PluginMethod
    fun setTransferPolicy(call: PluginCall) {
        val allowCellular = call.getBoolean("allowCellular", false) ?: false
        val killSwitch = call.getBoolean("killSwitchEnabled", false) ?: false
        val bindingPolicyChanged = preferences.getBoolean(KEY_KILL_SWITCH, false) != killSwitch
        requestNotificationPermission()
        Thread {
            if (bindingPolicyChanged) {
                runCatching { NativeApi.pauseAll(context) }
            }
            preferences.edit()
                .putBoolean(KEY_CELLULAR, allowCellular)
                .putBoolean(KEY_KILL_SWITCH, killSwitch)
                .commit()
            val network = NetworkMonitor.refresh(context)
            if (network.rebindRequired || !network.transfersAllowed) {
                runCatching { NativeApi.pauseAll(context) }
            }
            TransferScheduler.scheduleIfActive(context)
            call.resolve()
        }.start()
    }

    @PluginMethod
    fun pauseAll(call: PluginCall) {
        Thread {
            runCatching { NativeApi.pauseAll(context) }
                .onSuccess { call.resolve() }
                .onFailure { call.rejectWithCause("Unable to pause transfers", it) }
        }.start()
    }

    private fun resolveTorrentDocument(torrentId: String, fileIndex: Int): DocumentFile {
        val torrent = NativeApi.get(context, "/torrents/$torrentId")
        val content = NativeApi.get(context, "/torrents/$torrentId/content")
        val files = content.getJSONArray("files")
        require(fileIndex in 0 until files.length()) { "Unknown torrent file" }
        val pathArray = files.getJSONObject(fileIndex).getJSONArray("path")
        val parts = (0 until pathArray.length()).map { pathArray.getString(it) }
        val torrentFolder = File(torrent.getString("save_path")).name
        val relative = (listOf(torrentFolder) + parts).joinToString("/")
        val uri = rootUri() ?: error("Download folder permission is missing")
        return SafDocumentBroker(context, uri).resolveExisting(relative)
            ?: error("Downloaded file is unavailable")
    }

    private fun launchFile(call: PluginCall, share: Boolean) {
        val torrentId = call.getString("torrentId") ?: return call.reject("torrentId is required")
        val fileIndex = call.getInt("fileIndex") ?: return call.reject("fileIndex is required")
        Thread {
            runCatching {
                val document = resolveTorrentDocument(torrentId, fileIndex)
                val extension = document.name?.substringAfterLast('.', "") ?: ""
                val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension) ?: "application/octet-stream"
                val intent = if (share) {
                    Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, document.uri)
                } else {
                    Intent(Intent.ACTION_VIEW).setDataAndType(document.uri, mime)
                }.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                activity.runOnUiThread {
                    activity.startActivity(if (share) Intent.createChooser(intent, "Share file") else intent)
                }
            }.onSuccess {
                call.resolve(JSObject().put(if (share) "shared" else "opened", true))
            }.onFailure {
                call.rejectWithCause("Unable to ${if (share) "share" else "open"} the downloaded file", it)
            }
        }.start()
    }

    @PluginMethod
    fun openDownloadedFile(call: PluginCall) = launchFile(call, false)

    @PluginMethod
    fun shareDownloadedFile(call: PluginCall) = launchFile(call, true)

    private fun dispatchIntent(intent: Intent) {
        val uri = intent.data ?: return
        if (uri.scheme == "magnet") {
            notifyListeners("magnetLink", JSObject().put("uri", uri.toString()), true)
        } else if (intent.action == Intent.ACTION_VIEW) {
            runCatching { torrentPayload(uri) }.onSuccess {
                notifyListeners("torrentFile", it, true)
            }
        }
    }

    companion object {
        private const val PREFERENCES = "orc_android"
        private const val KEY_TREE_URI = "download_tree_uri"
        private const val KEY_ADMIN_TOKEN = "admin_token"
        private const val KEY_CELLULAR = "allow_cellular"
        private const val KEY_KILL_SWITCH = "kill_switch"
        private const val MAX_TORRENT_BYTES = 10 * 1024 * 1024
        @Volatile private var active: OrcAndroidPlugin? = null
        @Volatile private var pendingIntent: Intent? = null

        fun handleIntent(intent: Intent) {
            val plugin = active
            if (plugin == null) pendingIntent = intent else plugin.dispatchIntent(intent)
        }
    }
}
