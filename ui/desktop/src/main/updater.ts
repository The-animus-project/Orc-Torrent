import { app, BrowserWindow, ipcMain } from "electron";
import electronUpdater from "electron-updater";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { UpdatePrefs, UpdatePhase, UpdateStatus } from "../shared/updaterTypes.js";
import { isAnimusEdition } from "../shared/appEdition.js";

const { autoUpdater } = electronUpdater;

const UPDATE_PREFS_META = "update_prefs_meta.json";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

let getMainWindow: () => BrowserWindow | null = () => null;
let onBeforeInstall: () => Promise<void> = async () => {};
let checkInterval: ReturnType<typeof setInterval> | null = null;
let initialized = false;

let phase: UpdatePhase = "idle";
let lastCheckedAt: number | null = null;
let availableVersion: string | null = null;
let downloadPercent: number | null = null;
let errorMessage: string | null = null;
let prefs: UpdatePrefs = { autoCheck: true };

function getPrefsPath(): string {
  return path.join(app.getPath("userData"), UPDATE_PREFS_META);
}

function loadPrefs(): UpdatePrefs {
  const metaPath = getPrefsPath();
  if (!existsSync(metaPath)) return { autoCheck: true };
  try {
    const parsed = JSON.parse(readFileSync(metaPath, "utf8")) as { autoCheck?: boolean };
    return { autoCheck: parsed.autoCheck !== false };
  } catch {
    return { autoCheck: true };
  }
}

function savePrefs(next: UpdatePrefs): void {
  try {
    writeFileSync(getPrefsPath(), JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("[Updater] Failed to persist update preferences:", err);
  }
}

function buildStatus(): UpdateStatus {
  return {
    currentVersion: app.getVersion(),
    autoCheck: prefs.autoCheck,
    phase,
    lastCheckedAt,
    availableVersion,
    downloadPercent,
    error: errorMessage,
  };
}

function notifyStatusChanged(): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send("updater:status-changed", buildStatus());
  }
}

function setPhase(next: UpdatePhase): void {
  phase = next;
  notifyStatusChanged();
}

function clearScheduledChecks(): void {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

function scheduleAutoChecks(): void {
  clearScheduledChecks();
  if (!prefs.autoCheck) return;

  setTimeout(() => {
    void runUpdateCheck(false);
  }, STARTUP_DELAY_MS);

  checkInterval = setInterval(() => {
    void runUpdateCheck(false);
  }, CHECK_INTERVAL_MS);
}

async function runUpdateCheck(manual: boolean): Promise<UpdateStatus> {
  if (!app.isPackaged) return buildStatus();

  if (phase === "checking" || phase === "downloading") {
    return buildStatus();
  }

  errorMessage = null;
  setPhase("checking");

  try {
    await autoUpdater.checkForUpdates();
    if (manual) {
      lastCheckedAt = Date.now();
      notifyStatusChanged();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errorMessage = message;
    setPhase("error");
    console.error("[Updater] Check failed:", message);
  }

  return buildStatus();
}

function wireAutoUpdaterEvents(): void {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    errorMessage = null;
    setPhase("checking");
  });

  autoUpdater.on("update-available", (info) => {
    availableVersion = info.version ?? null;
    lastCheckedAt = Date.now();
    setPhase("available");
  });

  autoUpdater.on("update-not-available", () => {
    availableVersion = null;
    lastCheckedAt = Date.now();
    setPhase("not-available");
  });

  autoUpdater.on("download-progress", (progress) => {
    downloadPercent = progress.percent ?? null;
    setPhase("downloading");
  });

  autoUpdater.on("update-downloaded", (info) => {
    availableVersion = info.version ?? availableVersion;
    downloadPercent = 100;
    setPhase("downloaded");
  });

  autoUpdater.on("error", (err) => {
    errorMessage = err instanceof Error ? err.message : String(err);
    setPhase("error");
    console.error("[Updater] Error:", errorMessage);
  });
}

export function registerUpdaterIpc(getWindow: () => BrowserWindow | null, beforeInstall: () => Promise<void>): void {
  getMainWindow = getWindow;
  onBeforeInstall = beforeInstall;

  ipcMain.handle("updater:get-status", async (): Promise<UpdateStatus> => buildStatus());

  ipcMain.handle("updater:check", async (): Promise<UpdateStatus> => runUpdateCheck(true));

  ipcMain.handle("updater:set-auto-check", async (_event, enabled: boolean): Promise<UpdateStatus> => {
    prefs = { autoCheck: Boolean(enabled) };
    savePrefs(prefs);
    if (prefs.autoCheck) {
      scheduleAutoChecks();
    } else {
      clearScheduledChecks();
    }
    notifyStatusChanged();
    return buildStatus();
  });

  ipcMain.handle("updater:install", async (): Promise<{ success: boolean; error?: string }> => {
    try {
      await onBeforeInstall();
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { success: false, error };
    }
  });
}

export function initUpdater(getWindow: () => BrowserWindow | null, beforeInstall: () => Promise<void>): void {
  if (!app.isPackaged || isAnimusEdition() || initialized) return;
  initialized = true;

  getMainWindow = getWindow;
  onBeforeInstall = beforeInstall;
  prefs = loadPrefs();

  wireAutoUpdaterEvents();
  scheduleAutoChecks();

  console.log("[Updater] Auto-update enabled (GitHub Releases)");
}
