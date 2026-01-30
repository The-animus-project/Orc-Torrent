// Formatting utilities

/**
 * Format bytes to human-readable string (B, KB, MB, GB, TB)
 * @param bytes - Number of bytes
 * @returns Formatted string (e.g., "1.5 MB")
 */
export function fmtBytes(bytes: number): string {
  if (!bytes || bytes < 1) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v > 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Format bytes per second to human-readable speed
 * @param bps - Bytes per second
 * @returns Formatted string (e.g., "1.5 MB/s")
 */
export function fmtBytesPerSec(bps: number): string {
  if (!bps || bps < 1) return "0 B/s";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let i = 0;
  let v = bps;
  while (v > 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtPct(p: number): string {
  const v = Math.max(0, Math.min(1, p)) * 100;
  return `${v.toFixed(1)}%`;
}

/**
 * Compute effective ETA (seconds) from status. Uses backend eta_sec when valid;
 * otherwise derives from (total - downloaded) / rate when downloading with rate > 0.
 */
export function getEffectiveEta(
  eta_sec: number | null | undefined,
  state: string | undefined,
  total_bytes: number,
  downloaded_bytes: number,
  down_rate_bps: number
): number | null {
  if (state === "downloading" && total_bytes > 0 && downloaded_bytes < total_bytes && down_rate_bps > 0) {
    const remaining = total_bytes - downloaded_bytes;
    const sec = Math.ceil(remaining / down_rate_bps);
    if (sec > 0 && isFinite(sec)) return sec;
  }
  if (eta_sec != null && eta_sec > 0 && isFinite(eta_sec)) return eta_sec;
  return null;
}

export function fmtEta(sec: number | null | undefined, state?: string): string {
  // Special states
  if (state === "checking") return "Checking...";
  if (state === "seeding" || state === "complete") return "Seeding";
  if (state === "stopped" || state === "paused") return "—";
  if (state === "error") return "—";
  
  // Invalid or zero ETA
  if (sec === null || sec === undefined || sec <= 0 || !isFinite(sec)) return "∞";
  
  // Format time (cap very large ETA for display)
  const s = Math.min(Math.floor(sec), 999 * 3600);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

export function fmtSpeedDownUp(downBps: number, upBps: number): string {
  const down = downBps > 0 ? fmtBytesPerSec(downBps) : null;
  const up = upBps > 0 ? fmtBytesPerSec(upBps) : null;
  
  if (down && up) return `↓ ${down} ↑ ${up}`;
  if (down) return `↓ ${down}`;
  if (up) return `↑ ${up}`;
  return "—";
}

export function fmtPeersSeeds(peers: number, seeds?: number): string {
  if (peers === 0 && (!seeds || seeds === 0)) return "0";
  if (seeds !== undefined && seeds > 0) {
    return `${peers} (${seeds})`;
  }
  return `${peers}`;
}

export function fmtTimeElapsed(addedAtMs: number): string {
  if (!addedAtMs || addedAtMs <= 0) return "—";
  const now = Date.now();
  const elapsedMs = now - addedAtMs;
  const elapsedSec = Math.floor(elapsedMs / 1000);
  
  if (elapsedSec < 60) return "Just started";
  
  const h = Math.floor(elapsedSec / 3600);
  const m = Math.floor((elapsedSec % 3600) / 60);
  const s = elapsedSec % 60;
  const d = Math.floor(h / 24);
  const hours = h % 24;
  
  if (d > 0) return `${d}d ${hours}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtSizeProgress(downloadedBytes: number, totalBytes: number): string {
  if (!totalBytes || totalBytes === 0) {
    return "Downloading metadata...";
  }
  
  const downloaded = fmtBytes(downloadedBytes);
  const total = fmtBytes(totalBytes);
  return `${downloaded} / ${total}`;
}

export async function fileToBase64(file: File): Promise<string> {
  // Add timeout to prevent UI freeze on slow/network drives
  const FILE_READ_TIMEOUT_MS = 30000; // 30 seconds
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("File read timed out")), FILE_READ_TIMEOUT_MS);
  });
  
  const readPromise = file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    return btoa(binary);
  });
  
  return Promise.race([readPromise, timeoutPromise]);
}
