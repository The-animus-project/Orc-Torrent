package com.orc.torrent.engine

import android.content.Context
import android.net.Uri
import android.system.Os
import android.system.OsConstants
import androidx.annotation.Keep
import androidx.documentfile.provider.DocumentFile
import java.io.FileNotFoundException
import java.io.IOException

@Keep
class SafDocumentBroker(private val context: Context, rootUri: Uri) {
    private val root = DocumentFile.fromTreeUri(context, rootUri)
        ?: throw IllegalArgumentException("The selected download folder is unavailable")

    private fun parts(path: String): List<String> {
        return SafPathPolicy.parts(path)
    }

    private fun resolve(path: String, createFile: Boolean): DocumentFile {
        val values = parts(path)
        var current = root
        values.forEachIndexed { index, name ->
            val last = index == values.lastIndex
            current = current.findFile(name) ?: when {
                !createFile -> throw FileNotFoundException(path)
                last -> current.createFile("application/octet-stream", name)
                else -> current.createDirectory(name)
            } ?: throw FileNotFoundException("Unable to create $name")
        }
        return current
    }

    fun validateRoot() {
        require(root.canRead() && root.canWrite()) { "Select a writable local folder" }
        val probe = root.createFile("application/octet-stream", ".orc-storage-probe")
            ?: throw IllegalArgumentException("The provider cannot create download files")
        try {
            val descriptor = context.contentResolver.openFileDescriptor(probe.uri, "rw")
                ?: throw IllegalArgumentException("The provider cannot open writable files")
            descriptor.use {
                Os.lseek(it.fileDescriptor, 0, OsConstants.SEEK_SET)
                Os.ftruncate(it.fileDescriptor, 1L)
                Os.lseek(it.fileDescriptor, 0, OsConstants.SEEK_SET)
            }
        } catch (error: Exception) {
            throw IllegalArgumentException("Select local storage that supports seekable files", error)
        } finally {
            probe.delete()
        }
    }

    @Keep
    fun openFile(path: String, length: Long, overwrite: Boolean): Int {
        val document = resolve(path, true)
        require(document.canWrite()) { "Selected folder is read-only" }
        val descriptor = context.contentResolver.openFileDescriptor(document.uri, "rw")
            ?: throw FileNotFoundException(path)
        try {
            Os.lseek(descriptor.fileDescriptor, 0, OsConstants.SEEK_CUR)
            if (!overwrite && document.length() > 0L) {
                throw IllegalStateException("Document already exists: $path")
            }
            return descriptor.detachFd()
        } finally {
            descriptor.close()
        }
    }

    @Keep
    fun removeFile(path: String) {
        if (!resolve(path, false).delete()) throw IOException("Unable to delete $path")
    }

    @Keep
    fun removeDirectoryIfEmpty(path: String) {
        val directory = resolve(path, false)
        if (directory.isDirectory && directory.listFiles().isEmpty() && !directory.delete()) {
            throw IOException("Unable to delete empty directory $path")
        }
    }

    fun resolveExisting(path: String): DocumentFile? = runCatching { resolve(path, false) }.getOrNull()
}

internal object SafPathPolicy {
    fun parts(path: String): List<String> {
        require(!path.startsWith('/')) { "Document paths must be relative" }
        val values = path.split('/').filter { it.isNotBlank() }
        require(values.isNotEmpty() && values.none { it == "." || it == ".." || it.indexOf('\u0000') >= 0 }) {
            "Invalid document path"
        }
        return values
    }
}
