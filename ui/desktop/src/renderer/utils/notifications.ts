/**
 * Desktop notification utilities for Electron renderer process
 */

import { logger } from "./logger";
import {
  readStoredNotificationSoundPreference,
  storedNotificationSoundPreferenceToUrl,
  urlToNotificationSoundAudioPayload,
  urlToStoredNotificationSoundPreference,
  writeStoredNotificationSoundPreference,
  type NotificationSoundAudioPayload,
} from "../../shared/notificationSoundRegistry";

let permissionChecked = false;
let permissionGranted = false;

/** Custom notification sound URL (e.g. app://notification-sound). When set, played instead of built-in tone. */
let cachedNotificationSoundUrl: string | null = null;

function hydrateNotificationSoundFromLocalStorage(): void {
  const stored = readStoredNotificationSoundPreference();
  if (!stored) return;
  cachedNotificationSoundUrl = storedNotificationSoundPreferenceToUrl(stored);
}

hydrateNotificationSoundFromLocalStorage();

/** Cached file URL for app icon (from main process path). */
let cachedAppIconUrl: string | null | undefined = undefined;

const NOTIFY_ON_COMPLETION_KEY = "orc-notify-on-completion";
const NOTIFY_ON_KILL_SWITCH_KEY = "orc-notify-on-kill-switch";

function pathToFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return "file:///" + normalized;
  }
  return "file://" + normalized;
}

/**
 * Get app icon URL for notifications. Caches result. Returns undefined if unavailable.
 */
async function getAppIconUrl(): Promise<string | undefined> {
  if (cachedAppIconUrl !== undefined) {
    return cachedAppIconUrl ?? undefined;
  }
  try {
    if (typeof window.orc?.iconPath !== "function") {
      cachedAppIconUrl = null;
      return undefined;
    }
    const path = await window.orc.iconPath();
    if (!path) {
      cachedAppIconUrl = null;
      return undefined;
    }
    const url = pathToFileUrl(path);
    cachedAppIconUrl = url;
    return url;
  } catch {
    cachedAppIconUrl = null;
    return undefined;
  }
}

function getNotifyOnCompletion(): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_ON_COMPLETION_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

function getNotifyOnKillSwitch(): boolean {
  try {
    const raw = localStorage.getItem(NOTIFY_ON_KILL_SWITCH_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw !== "false";
  } catch {
    return true;
  }
}

/** Keys and getters for Settings UI */
export const NOTIFY_ON_COMPLETION_STORAGE_KEY = NOTIFY_ON_COMPLETION_KEY;
export const NOTIFY_ON_KILL_SWITCH_STORAGE_KEY = NOTIFY_ON_KILL_SWITCH_KEY;
export { getNotifyOnCompletion, getNotifyOnKillSwitch };

/** Safe, bounded tag for completion notification (one per torrent). */
function completionTag(torrentId: string | undefined, torrentName: string): string {
  if (torrentId) return `torrent-complete-${torrentId}`;
  const safe = torrentName.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  return safe ? `torrent-complete-${safe}` : `torrent-complete-${Date.now()}`;
}

/**
 * Set the URL used for notification sounds (from settings). Call with null to use built-in tone.
 */
export function setNotificationSoundUrl(url: string | null): void {
  cachedNotificationSoundUrl = url;
  writeStoredNotificationSoundPreference(urlToStoredNotificationSoundPreference(url));
}

/**
 * Load the saved notification sound from the main process (userData meta) and mirror to localStorage.
 * Call once on app startup so desktop notifications use the user's last choice.
 */
export async function loadPersistedNotificationSound(): Promise<string | null> {
  if (typeof window.orc?.notificationSound?.getPreference !== "function") {
    return cachedNotificationSoundUrl;
  }
  try {
    const preference = await window.orc.notificationSound.getPreference();
    const url =
      typeof window.orc.notificationSound.getUrl === "function" ? await window.orc.notificationSound.getUrl() : null;
    const effectiveUrl = url ?? storedNotificationSoundPreferenceToUrl(preference);
    setNotificationSoundUrl(effectiveUrl);
    return effectiveUrl;
  } catch (error) {
    logger.warn("Failed to load persisted notification sound:", error);
    return cachedNotificationSoundUrl;
  }
}

/**
 * Check if notifications are supported and request permission if needed
 */
async function ensurePermission(): Promise<boolean> {
  if (permissionChecked) {
    return permissionGranted;
  }

  if (!("Notification" in window)) {
    logger.warn("Desktop notifications are not supported in this environment");
    permissionChecked = true;
    permissionGranted = false;
    return false;
  }

  // Check current permission status
  if (Notification.permission === "granted") {
    permissionChecked = true;
    permissionGranted = true;
    return true;
  }

  if (Notification.permission === "denied") {
    permissionChecked = true;
    permissionGranted = false;
    return false;
  }

  // Request permission if not yet determined
  try {
    const permission = await Notification.requestPermission();
    permissionChecked = true;
    permissionGranted = permission === "granted";
    return permissionGranted;
  } catch (error) {
    logger.warn("Failed to request notification permission:", error);
    permissionChecked = true;
    permissionGranted = false;
    return false;
  }
}

/**
 * Play the current notification sound (saved in settings). Use for "Preview" in settings.
 */
export function previewNotificationSound(): void {
  playNotificationSound();
}

function playBuiltInTone(): void {
  try {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    ctx.resume?.().catch(() => {});
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
    gainNode.gain.setValueAtTime(0.25, ctx.currentTime + 0.15);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.35);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 400);
  } catch (error) {
    logger.warn("Failed to play built-in tone:", error);
  }
}

function normalizeAudioBytes(raw: unknown): Uint8Array | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (Array.isArray(raw)) return Uint8Array.from(raw.filter((v): v is number => typeof v === "number"));
  if (typeof raw === "object" && raw !== null && "data" in raw) {
    const data = (raw as { data?: unknown }).data;
    if (Array.isArray(data)) return Uint8Array.from(data.filter((v): v is number => typeof v === "number"));
  }
  return null;
}

async function playAudioBytes(bytes: Uint8Array, mime: string): Promise<boolean> {
  if (!bytes.length) return false;
  const copiedBytes = new Uint8Array(bytes);
  const blob = new Blob([copiedBytes.buffer], { type: mime || "audio/mpeg" });
  const blobUrl = URL.createObjectURL(blob);
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(blobUrl);
  };
  try {
    const audio = new Audio(blobUrl);
    audio.volume = 0.8;
    audio.onended = revoke;
    audio.onerror = revoke;
    await audio.play();
    setTimeout(revoke, 10000);
    return true;
  } catch (error) {
    revoke();
    logger.warn("Failed to play notification sound bytes:", error);
    return false;
  }
}

async function tryPlayNotificationSoundFromIpc(payload: NotificationSoundAudioPayload): Promise<boolean> {
  if (payload.type === "builtin") return false;
  if (typeof window.orc?.notificationSound?.getAudio !== "function") return false;
  try {
    const audioData = await window.orc.notificationSound.getAudio(payload);
    if (!audioData) return false;
    const bytes = normalizeAudioBytes(audioData.buffer);
    if (!bytes) return false;
    return await playAudioBytes(bytes, audioData.mime);
  } catch (error) {
    logger.warn("Failed to fetch notification sound bytes:", error);
    return false;
  }
}

async function playNotificationSoundWithFallbacks(): Promise<void> {
  const payload = urlToNotificationSoundAudioPayload(cachedNotificationSoundUrl);
  if (await tryPlayNotificationSoundFromIpc(payload)) return;

  if (cachedNotificationSoundUrl) {
    try {
      const audio = new Audio(cachedNotificationSoundUrl);
      audio.volume = 0.8;
      await audio.play();
      return;
    } catch (error) {
      logger.warn("Failed to play notification sound URL, falling back to built-in tone:", error);
    }
  }

  playBuiltInTone();
}

function playNotificationSound(): void {
  void playNotificationSoundWithFallbacks();
}

/**
 * Show a notification for torrent completion
 * @param torrentName - Display name for the body
 * @param torrentId - Optional; used for a stable tag so one notification per torrent
 */
export async function showTorrentCompleteNotification(torrentName: string, torrentId?: string): Promise<void> {
  if (!getNotifyOnCompletion()) return;
  const hasPermission = await ensurePermission();
  if (!hasPermission) return;

  try {
    const icon = await getAppIconUrl();
    const displayName = torrentName?.trim() || "Torrent";
    const notification = new Notification("Torrent Complete", {
      body: `${displayName} has finished downloading`,
      icon: icon ?? undefined,
      tag: completionTag(torrentId, torrentName),
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
    playNotificationSound();
  } catch (error) {
    logger.warn("Failed to show torrent completion notification:", error);
    playNotificationSound();
  }
}

/**
 * Show a notification when kill switch activates
 * @param detail - Optional body line (e.g. "VPN disconnected — 3 torrent(s) stopped")
 */
export async function showKillSwitchNotification(detail?: string): Promise<void> {
  if (!getNotifyOnKillSwitch()) return;
  const hasPermission = await ensurePermission();
  if (!hasPermission) return;

  try {
    const icon = await getAppIconUrl();
    const body = detail ?? "VPN not detected. Downloads/seeding stopped for privacy protection.";
    const notification = new Notification("Kill Switch Activated", {
      body,
      icon: icon ?? undefined,
      tag: "kill-switch-activated",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
    playNotificationSound();
  } catch (error) {
    logger.warn("Failed to show kill switch notification:", error);
    playNotificationSound();
  }
}

/**
 * Show a notification when kill switch releases (VPN reconnected)
 */
export async function showKillSwitchReleasedNotification(): Promise<void> {
  if (!getNotifyOnKillSwitch()) return;
  const hasPermission = await ensurePermission();
  if (!hasPermission) return;

  try {
    const icon = await getAppIconUrl();
    const notification = new Notification("Kill Switch Released", {
      body: "VPN reconnected. You can resume torrents.",
      icon: icon ?? undefined,
      tag: "kill-switch-released",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
    playNotificationSound();
  } catch (error) {
    logger.warn("Failed to show kill switch released notification:", error);
    playNotificationSound();
  }
}

/**
 * Show a test desktop notification and play the currently selected sound.
 * Used by Settings so users can quickly verify popup + tone behavior.
 */
export async function showTestDesktopNotification(): Promise<boolean> {
  const hasPermission = await ensurePermission();
  if (!hasPermission) return false;

  try {
    const icon = await getAppIconUrl();
    const notification = new Notification("ORC Torrent Test Notification", {
      body: "If you can see this popup and hear the selected tone, notifications are working.",
      icon: icon ?? undefined,
      tag: "orc-test-notification",
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    setTimeout(() => notification.close(), 5000);
    playNotificationSound();
    return true;
  } catch (error) {
    logger.warn("Failed to show test desktop notification:", error);
    playNotificationSound();
    return false;
  }
}
