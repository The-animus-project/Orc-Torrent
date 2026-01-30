import React, { memo, useCallback, useRef, useState } from "react";
import type { WalletStatus, Torrent } from "../types";
import { fmtBytes, fileToBase64 } from "../utils/format";
import { postJson, getJson } from "../utils/api";
import { getErrorMessage } from "../utils/errorHandling";
import { logger } from "../utils/logger";
import { SpinnerInline } from "./Spinner";
import { infoHashFromMagnet, infoHashFromTorrentBytes } from "../lib/infoHash";

interface AddTorrentProps {
  online: boolean;
  wallet: WalletStatus | null;
  torrents: Torrent[];
  onTorrentAdded: (id: string, showFileDialog?: boolean) => void | Promise<void>;
  onSelectTorrent: (id: string) => void;
  onExistingTorrentFound?: (id: string) => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const AddTorrent = memo<AddTorrentProps>(({ 
  online, 
  wallet,
  torrents,
  onTorrentAdded,
  onSelectTorrent,
  onExistingTorrentFound,
  onError, 
  onSuccess 
}) => {
  const [magnet, setMagnet] = useState("");
  const [loadingMagnet, setLoadingMagnet] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [savePath, setSavePath] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chooseSaveFolder = useCallback(async () => {
    const path = await window.orc?.showSaveFolderDialog?.();
    if (path) setSavePath(path);
  }, []);

  const addMagnet = useCallback(async () => {
    if (loadingMagnet || loadingUrl) return;
    if (!magnet.trim()) {
      onError("Please enter a magnet link or torrent URL");
      return;
    }
    try {
      const m = magnet.trim();
      const hash = infoHashFromMagnet(m);
      if (hash) {
        const listRes = await getJson<{ items: Torrent[] }>("/torrents");
        const existing = listRes.items.find(t => 
          t.info_hash_hex?.toLowerCase() === hash.toLowerCase()
        );
        if (existing) {
          onSelectTorrent(existing.id);
          onExistingTorrentFound?.(existing.id);
          onSuccess("Already added — showing existing torrent");
          setMagnet("");
          return;
        }
      }
      if (m.startsWith("http://") || m.startsWith("https://")) {
        setLoadingUrl(true);
        let urlHash: string | null = null;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          const response = await fetch(m, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            throw new Error(`Failed to download torrent: ${response.statusText}`);
          }
          const contentType = response.headers.get("content-type");
          if (contentType) {
            const normalizedType = contentType.toLowerCase().split(';')[0].trim();
            const validTypes = ['application/x-bittorrent', 'application/octet-stream'];
            if (!validTypes.includes(normalizedType) && normalizedType !== '') {
              logger.warn(`Unexpected Content-Type for torrent URL: ${contentType}`);
            }
          }
          const contentLength = response.headers.get("content-length");
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (size > 7 * 1024 * 1024) {
              throw new Error("Torrent file too large (max ~7MB)");
            }
          }
          
          const blob = await response.blob();
          if (blob.size > 7 * 1024 * 1024) {
            throw new Error("Torrent file too large (max ~7MB)");
          }
          
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          
          // Convert to base64
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.slice(i, i + chunk));
          }
          const b64 = btoa(binary);
          const MAX_BASE64_SIZE = 10 * 1024 * 1024;
          if (b64.length > MAX_BASE64_SIZE) {
            throw new Error(`Encoded torrent file too large (${(b64.length / 1024 / 1024).toFixed(2)}MB). Maximum is 10MB.`);
          }
          
          // Check for duplicates by info hash (use fresh list)
          urlHash = await infoHashFromTorrentBytes(bytes);
          if (urlHash) {
            const listRes = await getJson<{ items: Torrent[] }>("/torrents");
            const existing = listRes.items.find(t => 
              t.info_hash_hex?.toLowerCase() === urlHash.toLowerCase()
            );
            if (existing) {
              onSelectTorrent(existing.id);
              onExistingTorrentFound?.(existing.id);
              onSuccess("Already added — showing existing torrent");
              setMagnet("");
              setLoadingUrl(false);
              return;
            }
          }
          
          // Add torrent using base64
          logger.logWithPrefix("AddTorrent", `Adding torrent from URL (${(b64.length / 1024).toFixed(2)}KB base64)`);
          // Use longer timeout for URL downloads (60 seconds)
          const res = await postJson<{ id: string }>("/torrents", {
            torrent_b64: b64,
            name_hint: "torrent",
            ...(savePath ? { save_path: savePath } : {}),
          }, 60000); // 60 second timeout for file uploads
          if (!res?.id) {
            logger.errorWithPrefix("AddTorrent", "Daemon rejected torrent URL add request (no ID returned)");
            onError("Daemon rejected torrent add request");
            return;
          }
          logger.logWithPrefix("AddTorrent", `Torrent from URL added successfully with ID: ${res.id}`);
          setMagnet("");
          // Call onTorrentAdded but don't await it - it should be non-blocking
          Promise.resolve(onTorrentAdded(res.id)).catch((err: unknown) => {
            logger.errorWithPrefix("AddTorrent", "Error in onTorrentAdded callback:", err);
          });
          onSuccess("Torrent added from URL");
        } catch (e: unknown) {
          if (e instanceof Error && e.name === "AbortError") {
            onError("Request timed out after 30 seconds");
          } else {
            const errorMsg = getErrorMessage(e, "Failed to download torrent from URL");
            // Check if error indicates duplicate/file exists
            if (errorMsg.toLowerCase().includes("already exists") || 
                errorMsg.toLowerCase().includes("file exists") ||
                errorMsg.toLowerCase().includes("duplicate")) {
              // Try to find existing torrent by hash
              if (urlHash) {
                try {
                  const listRes = await getJson<{ items: Torrent[] }>("/torrents");
                  const existing = listRes.items.find(t => 
                    t.info_hash_hex?.toLowerCase() === urlHash.toLowerCase()
                  );
                  if (existing) {
                    onSelectTorrent(existing.id);
                    onExistingTorrentFound?.(existing.id);
                    onSuccess("Already added — showing existing torrent");
                    setMagnet("");
                    setLoadingUrl(false);
                    return;
                  }
                } catch {}
              }
            }
            onError(errorMsg);
          }
        } finally {
          setLoadingUrl(false);
        }
        return;
      }
      
      // Handle magnet links
      if (!m.startsWith("magnet:?")) {
        onError("Invalid input: must be a magnet link (magnet:?...) or torrent URL (http:// or https://)");
        return;
      }
      setLoadingMagnet(true);
      logger.logWithPrefix("AddTorrent", `Adding magnet link: ${m.substring(0, 50)}...`);
      // Magnet links also need longer timeout as daemon may need to fetch metadata
      const res = await postJson<{ id: string }>("/torrents", {
        magnet: m,
        name_hint: "magnet",
        ...(savePath ? { save_path: savePath } : {}),
      }, 30000); // 30 second timeout for magnet links
      if (!res?.id) {
        logger.errorWithPrefix("AddTorrent", "Daemon rejected magnet link add request (no ID returned)");
        onError("Daemon rejected torrent add request");
        return;
      }
      logger.logWithPrefix("AddTorrent", `Magnet link added successfully with ID: ${res.id}`);
      setMagnet("");
      // Call onTorrentAdded but don't await it - it should be non-blocking
      Promise.resolve(onTorrentAdded(res.id)).catch((err: unknown) => {
        logger.errorWithPrefix("AddTorrent", "Error in onTorrentAdded callback:", err);
      });
      onSuccess("Torrent added from magnet link. Metadata will be fetched automatically.");
    } catch (e: unknown) {
      const errorMsg = getErrorMessage(e, "Failed to add torrent");
      // Check if error indicates duplicate/file exists
      if (errorMsg.toLowerCase().includes("already exists") || 
          errorMsg.toLowerCase().includes("file exists") ||
          errorMsg.toLowerCase().includes("duplicate")) {
        // Try to find existing torrent by hash
        const hash = infoHashFromMagnet(magnet);
        if (hash) {
          // Refresh torrent list and find existing
          try {
            const listRes = await getJson<{ items: Torrent[] }>("/torrents");
            const existing = listRes.items.find(t => 
              t.info_hash_hex?.toLowerCase() === hash.toLowerCase()
            );
            if (existing) {
              onSelectTorrent(existing.id);
              onExistingTorrentFound?.(existing.id);
              onSuccess("Already added — showing existing torrent");
              setMagnet("");
              return;
            }
          } catch {}
        }
      }
      onError(errorMsg);
    } finally {
      setLoadingMagnet(false);
    }
  }, [magnet, savePath, loadingMagnet, loadingUrl, torrents, onTorrentAdded, onSelectTorrent, onExistingTorrentFound, onError, onSuccess]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || loadingFile) return;
    
    try {
      if (!file.name.endsWith(".torrent")) {
        onError("Select a .torrent file");
        return;
      }
      
      // Check file size before reading (max 7MB, same as URL downloads)
      const MAX_FILE_SIZE = 7 * 1024 * 1024; // 7MB
      if (file.size > MAX_FILE_SIZE) {
        onError("Torrent file too large (max 7MB)");
        return;
      }
      
      setLoadingFile(true);
      
      // Declare hash outside try-catch so it's accessible in catch block
      let hash: string | null = null;
      
      try {
        // Show progress for large files
        const fileSizeMB = file.size / (1024 * 1024);
        if (fileSizeMB > 1) {
          logger.logWithPrefix("AddTorrent", `Processing large torrent file (${fileSizeMB.toFixed(2)}MB), this may take a moment...`);
        }
        
        // Read file as bytes for hash checking
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        
        // Check for duplicates by info hash
        try {
          hash = await infoHashFromTorrentBytes(bytes);
        } catch (err) {
          // Ignore hash extraction errors, continue with upload
          logger.warn("Failed to extract hash from torrent file:", err);
        }
        
        if (hash) {
          const listRes = await getJson<{ items: Torrent[] }>("/torrents");
          const existing = listRes.items.find(t => 
            t.info_hash_hex?.toLowerCase() === hash!.toLowerCase()
          );
          if (existing) {
            onSelectTorrent(existing.id);
            onExistingTorrentFound?.(existing.id);
            onSuccess("Already added — showing existing torrent");
            if (fileInputRef.current) fileInputRef.current.value = "";
            setLoadingFile(false);
            return;
          }
        }
        
        const b64 = await fileToBase64(file);
        
        // Use longer timeout for large file uploads (60 seconds)
        // Large base64-encoded torrent files can take time to upload and process
        // The daemon needs to decode base64, parse bencode, validate structure, etc.
        logger.logWithPrefix("AddTorrent", `Uploading torrent file: ${file.name} (${(b64.length / 1024 / 1024).toFixed(2)}MB base64 encoded)...`);
        const res = await postJson<{ id: string }>("/torrents", {
          torrent_b64: b64,
          name_hint: file.name,
          ...(savePath ? { save_path: savePath } : {}),
        }, 60000); // 60 second timeout for file uploads
        if (!res?.id) {
          logger.errorWithPrefix("AddTorrent", `Daemon rejected torrent file add request for ${file.name} (no ID returned)`);
          onError("Daemon rejected torrent add request");
          return;
        }
        logger.logWithPrefix("AddTorrent", `Torrent file ${file.name} added successfully with ID: ${res.id}`);
        // For .torrent files, files are available immediately, so show file selection dialog
        // Call onTorrentAdded but don't await it - it should be non-blocking
        Promise.resolve(onTorrentAdded(res.id, true)).catch((err: unknown) => {
          logger.errorWithPrefix("AddTorrent", "Error in onTorrentAdded callback:", err);
        });
        onSuccess("Torrent file imported");
      } catch (e: unknown) {
        const errorMsg = getErrorMessage(e, "Failed to import .torrent");
        // Check if error indicates duplicate/file exists
        if (errorMsg.toLowerCase().includes("already exists") || 
            errorMsg.toLowerCase().includes("file exists") ||
            errorMsg.toLowerCase().includes("duplicate")) {
          // Try to find existing torrent by hash (if we extracted it earlier)
          if (hash) {
            try {
              const listRes = await getJson<{ items: Torrent[] }>("/torrents");
              const existing = listRes.items.find(t => 
                t.info_hash_hex?.toLowerCase() === hash!.toLowerCase()
              );
              if (existing) {
                onSelectTorrent(existing.id);
                onExistingTorrentFound?.(existing.id);
                onSuccess("Already added — showing existing torrent");
                if (fileInputRef.current) fileInputRef.current.value = "";
                setLoadingFile(false);
                return;
              }
            } catch {}
          }
        }
        // Provide more helpful error messages for timeout issues
        if (errorMsg.includes("timed out") || errorMsg.includes("timeout")) {
          onError(`Upload timed out. The torrent file may be too large or the daemon is slow to respond. Try a smaller file or check daemon logs.`);
        } else {
          onError(errorMsg);
        }
      }
    } finally {
      setLoadingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [savePath, loadingFile, torrents, onTorrentAdded, onSelectTorrent, onExistingTorrentFound, onError, onSuccess]);

  const allowance = wallet ? fmtBytes(wallet.allowance_bytes_remaining) : "—";

  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">Add Torrent</div>
        <div className="panelMeta">Magnet links, torrent URLs, or .torrent files</div>
      </div>

      <div className="stack">
        <div className="fieldRow">
          <input
            className="input"
            value={magnet}
            onChange={(e) => setMagnet(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMagnet()}
            placeholder="magnet:?xt=urn:btih:... or https://..."
            spellCheck={false}
            disabled={!online}
            aria-label="Magnet link"
          />
          <button 
            className="btn primary" 
            onClick={addMagnet} 
            disabled={!online || !magnet.trim() || loadingMagnet || loadingUrl}
            aria-busy={loadingMagnet || loadingUrl}
          >
            {loadingUrl ? <><SpinnerInline /> DOWNLOADING...</> : 
             loadingMagnet ? <><SpinnerInline /> ADDING...</> : "ADD"}
          </button>
        </div>

        <div className="fieldRow" style={{ alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
          <span className="kLabel" style={{ marginRight: 4 }}>Save to:</span>
          <span className="kValue" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={savePath ?? undefined}>
            {savePath ? savePath : "Default folder"}
          </span>
          <button type="button" className="btn" onClick={chooseSaveFolder} disabled={!online} aria-label="Choose folder for torrent">
            Choose folder
          </button>
          {savePath && (
            <button type="button" className="btn" onClick={() => setSavePath(null)} aria-label="Use default folder">
              Use default
            </button>
          )}
        </div>

        <div className="fieldRow">
          <label className={`btn ${online && !loadingFile ? "" : "disabled"}`}>
            {loadingFile ? <><SpinnerInline /> IMPORTING...</> : "IMPORT .TORRENT"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".torrent"
              style={{ display: "none" }}
              disabled={!online || loadingFile}
              onChange={handleFileChange}
            />
          </label>

          <div className="kpi">
            <div className="kLabel">Allowance remaining</div>
            <div className="kValue">{allowance}</div>
          </div>

          <div className="kpi">
            <div className="kLabel">Credits</div>
            <div className="kValue">{wallet ? String(wallet.balance_credits) : "—"}</div>
          </div>
        </div>
      </div>
    </section>
  );
});

AddTorrent.displayName = "AddTorrent";
