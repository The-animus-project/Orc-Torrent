import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, ChildProcess, exec, execSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import crypto from "node:crypto";
import { mkdirSync, createWriteStream, existsSync, accessSync, constants, readFileSync, readdirSync, watchFile, unwatchFile, statSync, writeFileSync, unlinkSync, copyFileSync } from "node:fs";

// ES module polyfill for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;

// Daemon connection constants
const DAEMON_PORT = 8733;
const DAEMON_HOST = "127.0.0.1";
const DAEMON_HTTP_TIMEOUT_MS = 5000; // Increased timeout for health checks

// Daemon restart configuration
const MAX_RESTART_ATTEMPTS = 10;
const INITIAL_RESTART_DELAY_MS = 5000; // Increased from 2000 to prevent rapid restarts
const MAX_RESTART_DELAY_MS = 30000;
const DAEMON_STABILITY_PERIOD_MS = 60000;
const MIN_RESTART_COOLDOWN_MS = 3000; // Minimum time between restarts to prevent loops

// Health check configuration
const DAEMON_HEALTH_CHECK_INTERVAL_MS = 10000;
const DAEMON_HEALTH_CHECK_TIMEOUT_MS = 10000;
/** Minimum splash display time for max-impact startup animation (ms) */
const MIN_SPLASH_DISPLAY_MS = 6000;
/** Splash exit animation duration (ms) */
const SPLASH_EXIT_MS = 1500;

/** Notification sound: filename (no extension) and meta file in userData */
const NOTIFICATION_SOUND_BASENAME = "notification_sound";
const NOTIFICATION_SOUND_META = "notification_sound_meta.json";
/** Folder name for bundled default notification sounds (next to renderer) */
const NOTIFICATION_SOUNDS_DEFAULT_DIR = "notification-sounds";

/** Path to folder containing default notification sound MP3s (next to renderer in build, or public in dev). */
function getDefaultNotificationSoundsDir(): string {
  const nextToRenderer = path.join(__dirname, "..", "renderer", NOTIFICATION_SOUNDS_DEFAULT_DIR);
  if (existsSync(nextToRenderer)) return nextToRenderer;
  const inPublic = path.join(__dirname, "..", "..", "public", NOTIFICATION_SOUNDS_DEFAULT_DIR);
  if (existsSync(inPublic)) return inPublic;
  return nextToRenderer;
}

/** Minimal fallback splash HTML when splash.html fails to load (data URL) */
const SPLASH_FALLBACK_DATA_URL =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(`
<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>ORC TORRENT</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: #000; color: #fff;
    font-family: system-ui, sans-serif;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 24px;
    transition: opacity ${SPLASH_EXIT_MS}ms ease;
  }
  body.splash-exit { opacity: 0; }
  .spinner {
    width: 56px; height: 56px;
    border: 3px solid rgba(255,255,255,0.2);
    border-top-color: rgba(255,255,255,0.9);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  .title { font-size: 28px; font-weight: 800; letter-spacing: 4px; text-transform: uppercase; }
  .title-orc { color: #22c55e; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head>
<body>
  <div class="spinner"></div>
  <div class="title"><span class="title-orc">ORC</span> TORRENT</div>
  <div style="font-size: 12px; color: rgba(255,255,255,0.5);">Loading...</div>
</body></html>
`);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
/** When splash was shown (for minimum display enforcement) */
let splashShownAt: number | null = null;
let daemonProc: ChildProcess | null = null;
let daemonAdminToken: string = "";
let daemonSpawnedByApp = false;
let daemonLogStream: ReturnType<typeof createWriteStream> | null = null;
let pendingMagnetLinks: string[] = [];
let pendingTorrentFile: string | null = null;
let daemonHealthCheckInterval: NodeJS.Timeout | null = null;
let daemonRestartAttempts = 0;
let daemonRestartTimeout: NodeJS.Timeout | null = null;
let lastRestartTime: number = 0; // Timestamp of last restart attempt
let isShuttingDown = false;
let isRestarting = false; // Flag to prevent concurrent restart attempts
let currentDaemonLogPath: string | null = null;

// Log file watching - module scope for cleanup in before-quit
let logWatchers = new Map<string, { lastSize: number }>();
let logWatchCallbacks = new Map<string, Set<(line: string) => void>>();

// Torrent file retry interval - module scope for cleanup
let torrentFileRetryInterval: ReturnType<typeof setInterval> | null = null;

/** Clean up all log file watchers */
function cleanupLogWatchers(): void {
  for (const [filePath] of logWatchers) {
    try {
      unwatchFile(filePath);
    } catch (err) {
      console.error(`Failed to unwatch log file ${filePath}:`, err);
    }
  }
  logWatchers.clear();
  logWatchCallbacks.clear();
}

// Global error handlers with Windows-specific improvements
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  const errorMessage = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error("Unhandled rejection details:", errorMessage);
  
  // Log to daemon log if available
  if (daemonLogStream) {
    try {
      daemonLogStream.write(`[unhandledRejection] ${errorMessage}\n`);
    } catch (logErr) {
      console.error("Failed to write unhandled rejection to log:", logErr);
    }
  }
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  const errorMessage = error.stack || error.message;
  const errorCode = (error as NodeJS.ErrnoException).code;
  
  // Log to daemon log if available
  if (daemonLogStream) {
    try {
      daemonLogStream.write(`[uncaughtException] ${errorMessage}\n`);
      if (errorCode) {
        daemonLogStream.write(`[ERROR CODE] ${errorCode}\n`);
      }
      // Windows-specific error context
      if (process.platform === "win32") {
        if (errorCode === "EACCES" || errorCode === "EPERM") {
          daemonLogStream.write(`[WINDOWS] Permission error - may need Administrator rights\n`);
        } else if (errorCode === "ENOENT") {
          daemonLogStream.write(`[WINDOWS] File not found - check antivirus hasn't blocked files\n`);
        } else if (errorCode === "EADDRINUSE") {
          daemonLogStream.write(`[WINDOWS] Port in use - another instance may be running\n`);
        }
      }
    } catch (logErr) {
      console.error("Failed to write uncaught exception to log:", logErr);
    }
  }
  
  // Show error dialog to user (only if app is ready, to avoid crashes)
  try {
    if (app && app.isReady()) {
      let userMessage = `An unexpected error occurred:\n\n${errorMessage}\n\nThe application may be unstable.`;
      
      // Windows-specific user guidance
      if (process.platform === "win32") {
        if (errorCode === "EACCES" || errorCode === "EPERM") {
          userMessage += `\n\nThis appears to be a permission error. Try running as Administrator.`;
        } else if (errorCode === "ENOENT") {
          userMessage += `\n\nA required file is missing. Check if antivirus software blocked it.`;
        }
      }
      
      dialog.showErrorBox("Unexpected Error", userMessage);
    }
  } catch (dialogErr) {
    console.error("Failed to show error dialog:", dialogErr);
  }
});

/** Resolve app icon path: prefer orc-torrent.png (desktop assets in dev, or packaged app/assets). */
function getIconPath(): string | undefined {
  const pngName = "orc-torrent.png";
  const icoName = "icon.ico";
  if (isDev) {
    const assetsDir = path.resolve(__dirname, "../../assets");
    const devPng = path.join(assetsDir, "images", pngName);
    if (existsSync(devPng)) return devPng;
    const devIco = path.join(assetsDir, "icons", icoName);
    if (existsSync(devIco)) return devIco;
    const repoRoot = path.resolve(__dirname, "../../../..");
    const orcPng = path.join(repoRoot, "images", "orc-torrent.png");
    if (existsSync(orcPng)) return orcPng;
    const orcIco = path.join(repoRoot, "icons", "orc-torrent.ico");
    if (existsSync(orcIco)) return orcIco;
    return undefined;
  }
  if (process.resourcesPath) {
    const resourcesIco = path.join(process.resourcesPath, icoName);
    if (existsSync(resourcesIco)) return resourcesIco;
    const appAssets = path.join(process.resourcesPath, "app", "assets");
    const packagedPng = path.join(appAssets, "images", pngName);
    if (existsSync(packagedPng)) return packagedPng;
    const packagedIco = path.join(appAssets, "icons", icoName);
    if (existsSync(packagedIco)) return packagedIco;
  }
  return undefined;
}

function createSplashWindow() {
  splashShownAt = Date.now();
  const iconPath = getIconPath();

  // Determine splash HTML path
  let splashPath: string;
  if (isDev) {
    splashPath = path.resolve(__dirname, "../../splash.html");
  } else {
    const appPath = app.getAppPath();
    splashPath = path.join(appPath, "splash.html");
  }

  splashWindow = new BrowserWindow({
    width: 520,
    height: 620,
    frame: false,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: "#000000",
    resizable: false,
    center: true,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  splashWindow.loadFile(splashPath).catch((err) => {
    console.error("[Splash] Failed to load splash screen:", err);
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.loadURL(SPLASH_FALLBACK_DATA_URL).catch((fallbackErr) => {
        console.error("[Splash] Fallback splash failed:", fallbackErr);
        if (splashWindow && !splashWindow.isDestroyed()) {
          splashWindow.close();
          splashWindow = null;
        }
      });
    }
  });

  // Prevent navigation away from splash
  splashWindow.webContents.on("will-navigate", (e) => {
    e.preventDefault();
  });

  return splashWindow;
}

async function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    try {
      await splashWindow.webContents.executeJavaScript(`
        document.body.classList.add('splash-exit');
      `);
      await new Promise(resolve => setTimeout(resolve, SPLASH_EXIT_MS));
    } catch (err) {
      console.warn("[Splash] Failed to play exit animation:", err);
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  }
  splashShownAt = null;
}

function createWindow() {
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#000000",
    title: "ORC TORRENT",
    icon: iconPath, // Set window icon
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // SECURITY: Enable sandbox for better security isolation
    },
  });

  // Add error handlers to log failed resource loads
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`[Main] Failed to load resource: ${validatedURL}`);
    console.error(`[Main] Error code: ${errorCode}, Description: ${errorDescription}`);
    console.error(`[Main] Is main frame: ${isMainFrame}`);
    
    if (isMainFrame) {
      // Main frame failed to load - show error to user
      dialog.showErrorBox(
        "Failed to Load UI",
        `Failed to load the application UI:\n\n${errorDescription}\n\nURL: ${validatedURL}\nError Code: ${errorCode}`
      );
    }
  });

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // Electron console levels: 0=log, 1=info, 2=warn, 3=error
    if (level >= 2) {
      console.error(`[Renderer] ${message}`);
      if (sourceId) {
        console.error(`[Renderer] Source: ${sourceId}:${line}`);
      }
    }
    // Debug console.logs from renderer are ignored in production
  });


  mainWindow.once("ready-to-show", async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Ensure daemon is running when window is shown
      if (!await isDaemonHealthy()) {
        console.warn("Daemon not healthy when window ready-to-show, attempting to start...");
        await startDaemonIfNeeded();
      }
      
      // Enforce minimum splash display for max-impact startup animation
      if (splashShownAt != null) {
        const elapsed = Date.now() - splashShownAt;
        if (elapsed < MIN_SPLASH_DISPLAY_MS) {
          await new Promise((r) => setTimeout(r, MIN_SPLASH_DISPLAY_MS - elapsed));
        }
      }
      await closeSplashWindow();
      mainWindow.show();
      
      // Send any pending magnet links once window is ready
      if (pendingMagnetLinks.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            for (const link of pendingMagnetLinks) {
              mainWindow.webContents.send("magnet-link", link);
              console.log(`Sent pending magnet link: ${link.substring(0, 50)}...`);
            }
            pendingMagnetLinks = [];
          }
        } catch (err) {
          console.error("Failed to send magnet links:", err);
        }
      }
      
      // Send any pending torrent file once window is ready
      if (pendingTorrentFile && mainWindow && !mainWindow.isDestroyed()) {
        try {
          const data = JSON.parse(pendingTorrentFile);
          if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send("open-torrent-file", data);
            console.log(`Sent pending torrent file: ${data.fileName}`);
            pendingTorrentFile = null;
          }
        } catch (err) {
          console.error("Failed to send torrent file:", err);
        }
      }
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    // When packaged, files are in app.asar or app/ directory
    // Use app.getAppPath() which correctly resolves to the app directory
    // even when opened via file association (it returns the asar path or app directory)
    const appPath = app.getAppPath();
    
    // Build the path to index.html relative to app root
    // Electron's loadFile() automatically handles asar archives, so we don't need to check existsSync
    // The path should be relative to the app root (where package.json is)
    const indexHtml = path.join(appPath, "dist", "renderer", "index.html");
    
    console.log(`[Main] Loading HTML from app path: ${appPath}`);
    console.log(`[Main] HTML file path: ${indexHtml}`);
    
    // loadFile() handles asar archives automatically, so we can use it directly
    // If the file doesn't exist, loadFile will throw an error which we'll catch
    mainWindow.loadFile(indexHtml).catch((err) => {
      console.error(`[Main] Failed to load HTML file:`, err);
      console.error(`[Main] App path: ${appPath}`);
      console.error(`[Main] __dirname: ${__dirname}`);
      console.error(`[Main] resourcesPath: ${process.resourcesPath || "N/A"}`);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        const fallbackPath = path.join(__dirname, "../renderer/index.html");
        console.log(`[Main] Trying fallback path: ${fallbackPath}`);
        mainWindow.loadFile(fallbackPath).catch((fallbackErr) => {
          console.error(`[Main] Fallback path also failed:`, fallbackErr);
          dialog.showErrorBox(
            "Failed to Load UI",
            `Failed to load the UI HTML file.\n\nError: ${err.message}\n\nApp Path: ${appPath}\n__dirname: ${__dirname}\n\nPlease rebuild the application.`
          );
        });
      } else {
        dialog.showErrorBox(
          "Failed to Load UI",
          `Failed to load the UI HTML file.\n\nError: ${err.message}\n\nApp Path: ${appPath}\n__dirname: ${__dirname}\n\nPlease rebuild the application.`
        );
      }
    });
  }
}

function handleMagnetLink(magnetUrl: string) {
  // Validate magnet URL
  if (!magnetUrl || typeof magnetUrl !== "string") {
    console.warn("[Magnet] Invalid magnet link: empty or not a string");
    return;
  }

  const trimmed = magnetUrl.trim();
  if (!trimmed.startsWith("magnet:?")) {
    console.warn(`[Magnet] Invalid magnet link format: does not start with "magnet:?" - received: ${trimmed.substring(0, 50)}...`);
    return;
  }

  // If window is ready, send immediately; otherwise store for later
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send("magnet-link", trimmed);
      console.log(`[Magnet] Sent magnet link to renderer: ${trimmed.substring(0, 50)}...`);
    } catch (err) {
      console.error("[Magnet] Failed to send magnet link to renderer:", err);
      // Fall back to storing for later
      pendingMagnetLinks.push(trimmed);
    }
  } else {
    console.log(`[Magnet] Storing magnet link for later (window not ready): ${trimmed.substring(0, 50)}...`);
    pendingMagnetLinks.push(trimmed);
  }
}

function extractMagnetFromArgv(argv: string[]): string | null {
  // On Windows/Linux, magnet links come as command line arguments
  for (const arg of argv) {
    if (arg && arg.trim().startsWith("magnet:?")) {
      return arg.trim();
    }
  }
  return null;
}

interface VpnStatus {
  detected: boolean;
  interfaceName: string | null;
}

function detectVpn(): VpnStatus {
  const interfaces = os.networkInterfaces();
  const vpnPatterns = [
    /^tun\d+/i,      // TUN interfaces (Linux, macOS)
    /^tap\d+/i,      // TAP interfaces (Linux, Windows)
    /^wg\d+/i,        // WireGuard interfaces
    /^utun\d+/i,      // macOS VPN interfaces
    /^ppp\d+/i,       // PPP interfaces (macOS, Linux)
    /vpn/i,           // Generic VPN naming
    /tunnel/i,        // Tunnel interfaces (Mullvad Tunnel, etc.)
    /nordlynx/i,      // NordVPN
    /openvpn/i,       // OpenVPN
    /wireguard/i,     // WireGuard
    /proton/i,        // ProtonVPN
    /expressvpn/i,    // ExpressVPN
    /surfshark/i,     // Surfshark
    /mullvad/i,       // Mullvad VPN
    /nordvpn/i,       // NordVPN
    /cyberghost/i,    // CyberGhost
    /private.*internet/i, // Private Internet Access
    /pia/i,           // Private Internet Access (abbrev)
    /tailscale/i,     // Tailscale
    /wintun/i,        // WinTun (Windows WireGuard)
  ];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || addrs.length === 0) continue;
    
    // Check if interface name matches VPN patterns
    for (const pattern of vpnPatterns) {
      if (pattern.test(name)) {
        return { detected: true, interfaceName: name };
      }
    }

    // On Windows, also check for TAP adapters and common VPN naming patterns
    if (process.platform === "win32") {
      const lowerName = name.toLowerCase();
      if (lowerName.includes("tap") || lowerName.includes("tun") || lowerName.includes("vpn") || 
          lowerName.includes("tunnel") || lowerName.includes("mullvad") || lowerName.includes("nordvpn") ||
          lowerName.includes("wireguard") || lowerName.includes("openvpn") || lowerName.includes("wintun")) {
        return { detected: true, interfaceName: name };
      }
    }
  }

  return { detected: false, interfaceName: null };
}

/**
 * Check if a directory is writable by attempting to create a test file.
 * Returns true if writable, false otherwise.
 */
async function checkDirectoryPermissions(dirPath: string): Promise<{ writable: boolean; error?: string }> {
  try {
    // First check if directory exists, create if needed
    if (!existsSync(dirPath)) {
      try {
        mkdirSync(dirPath, { recursive: true });
      } catch (mkdirErr) {
        const errCode = (mkdirErr as NodeJS.ErrnoException).code;
        if (errCode === "EACCES" || errCode === "EPERM") {
          return { writable: false, error: `Permission denied creating directory: ${dirPath}` };
        }
        return { writable: false, error: `Failed to create directory: ${mkdirErr}` };
      }
    }

    // Check if we can access the directory
    try {
      accessSync(dirPath, constants.R_OK | constants.W_OK);
    } catch (accessErr) {
      const errCode = (accessErr as NodeJS.ErrnoException).code;
      if (errCode === "EACCES" || errCode === "EPERM") {
        return { writable: false, error: `Permission denied accessing directory: ${dirPath}` };
      }
      return { writable: false, error: `Cannot access directory: ${accessErr}` };
    }

    // Try to create a test file to verify write permissions
    const testFile = path.join(dirPath, `.orc_permission_test_${Date.now()}`);
    try {
      const testStream = createWriteStream(testFile, { flags: "w" });
      await new Promise<void>((resolve, reject) => {
        testStream.write("test", (err) => {
          if (err) reject(err);
          else {
            testStream.end(() => {
              // Try to delete the test file
              try {
                const fs = require("node:fs");
                fs.unlinkSync(testFile);
              } catch {}
              resolve();
            });
          }
        });
      });
      return { writable: true };
    } catch (writeErr) {
      const errCode = (writeErr as NodeJS.ErrnoException).code;
      // Clean up test file if it was created
      try {
        const fs = require("node:fs");
        if (existsSync(testFile)) {
          fs.unlinkSync(testFile);
        }
      } catch {}
      
      if (errCode === "EACCES" || errCode === "EPERM") {
        return { writable: false, error: `Permission denied writing to directory: ${dirPath}` };
      }
      return { writable: false, error: `Cannot write to directory: ${writeErr}` };
    }
  } catch (err) {
    return { writable: false, error: `Error checking directory permissions: ${err}` };
  }
}

/**
 * Check if a binary file exists and is executable/readable.
 * Returns true if accessible, false otherwise.
 */
function checkBinaryPermissions(binPath: string): { accessible: boolean; error?: string } {
  try {
    if (!existsSync(binPath)) {
      return { accessible: false, error: `Binary not found: ${binPath}` };
    }

    try {
      // Check if file is readable
      accessSync(binPath, constants.R_OK);
      return { accessible: true };
    } catch (accessErr) {
      const errCode = (accessErr as NodeJS.ErrnoException).code;
      if (errCode === "EACCES" || errCode === "EPERM") {
        return { accessible: false, error: `Permission denied accessing binary: ${binPath}` };
      }
      return { accessible: false, error: `Cannot access binary: ${accessErr}` };
    }
  } catch (err) {
    return { accessible: false, error: `Error checking binary permissions: ${err}` };
  }
}

/**
 * Find the first writable log directory from a list of candidates.
 * Returns the path to a writable directory or null if none are writable.
 */
async function findWritableLogDirectory(): Promise<{ path: string; error?: string } | null> {
  const candidates: Array<{ path: string; name: string }> = [];

  // Primary: userData/logs
  try {
    const base = app.getPath("userData");
    candidates.push({ path: path.join(base, "logs"), name: "userData/logs" });
  } catch (err) {
    console.warn("Failed to get userData path:", err);
  }

  candidates.push({ 
    path: path.join(os.tmpdir(), "orc-torrent", "logs"), 
    name: "temp/orc-torrent/logs" 
  });

  candidates.push({ 
    path: os.tmpdir(), 
    name: "temp (direct)" 
  });

  if (isDev) {
    try {
      candidates.push({ 
        path: path.join(process.cwd(), "logs"), 
        name: "cwd/logs" 
      });
    } catch {}
  }

  // Try each candidate in order
  for (const candidate of candidates) {
    const check = await checkDirectoryPermissions(candidate.path);
    if (check.writable) {
      console.log(`[Log Directory] Using writable directory: ${candidate.path} (${candidate.name})`);
      return { path: path.join(candidate.path, "daemon.log") };
    } else {
      console.warn(`[Log Directory] Directory not writable: ${candidate.path} (${candidate.name}) - ${check.error}`);
    }
  }

  // Last resort: return temp file path even if we can't verify (better than nothing)
  const lastResort = path.join(os.tmpdir(), "orc-daemon.log");
  console.warn(`[Log Directory] All candidates failed, using last resort: ${lastResort}`);
  return { path: lastResort, error: "Could not verify any log directory is writable" };
}

function daemonLogPath(): string {
  // This function is kept for backward compatibility but now uses the new permission-aware function
  // For synchronous calls, we'll use the old logic but log a warning
  try {
    const base = app.getPath("userData");
    const dir = path.join(base, "logs");
    try {
      mkdirSync(dir, { recursive: true });
      // Directory created successfully
      return path.join(dir, "daemon.log");
    } catch (err) {
      // mkdirSync failed - could be permission error or other issue
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === "EEXIST") {
        // Directory already exists, that's fine
        return path.join(dir, "daemon.log");
      } else {
        console.error("Failed to create log directory:", err);
        const fallbackDir = path.join(os.tmpdir(), "orc-torrent", "logs");
        try {
          mkdirSync(fallbackDir, { recursive: true });
          return path.join(fallbackDir, "daemon.log");
        } catch (fallbackErr) {
          console.error("Failed to create fallback log directory:", fallbackErr);
          // Last resort: use temp file directly (directory should exist)
          return path.join(os.tmpdir(), "orc-daemon.log");
        }
      }
    }
  } catch (err) {
    console.error("Failed to get userData path:", err);
    const fallbackPath = path.join(os.tmpdir(), "orc-daemon.log");
    console.warn(`Using fallback log path: ${fallbackPath}`);
    return fallbackPath;
  }
}

function httpRequestJson(method: "GET" | "POST", pathname: string, headers?: Record<string, string>): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: DAEMON_HOST, port: DAEMON_PORT, path: pathname, method, timeout: DAEMON_HTTP_TIMEOUT_MS, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            return reject(new Error(`HTTP ${res.statusCode}: ${data || res.statusMessage}`));
          }
          if (!data) return resolve({});
          try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

async function isDaemonHealthy(): Promise<boolean> {
  try {
    // Health endpoint should respond immediately, even during initialization
    const r = await httpRequestJson("GET", "/health");
    const isHealthy = Boolean(r?.ok);
    if (!isHealthy) {
      console.warn(`[HEALTH CHECK] Health endpoint returned:`, r);
    }
    return isHealthy;
  } catch (error) {
    // Log error details for debugging (but not every attempt to avoid spam)
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes("ECONNREFUSED") || errorMsg.includes("timeout")) {
      // These are expected while daemon is starting - don't log every attempt
      return false;
    }
    // Log unexpected errors
    console.warn(`[HEALTH CHECK] Unexpected error:`, errorMsg);
    return false;
  }
}

async function isDaemonReady(): Promise<boolean> {
  try {
    // Readiness endpoint checks if initialization is complete
    const r = await httpRequestJson("GET", "/ready");
    return Boolean(r?.ready);
  } catch (error) {
    // If readiness endpoint doesn't exist yet, assume not ready
    return false;
  }
}

async function waitForHealthy(timeoutMs = DAEMON_HEALTH_CHECK_TIMEOUT_MS) {
  const start = Date.now();
  let delay = 100; // Start with faster checks (100ms)
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    if (await isDaemonHealthy()) {
      const elapsed = Date.now() - start;
      console.log(`[HEALTH CHECK] Daemon became healthy after ${elapsed}ms (${attempt} attempts)`);
      // For now, just check health (server is listening)
      return true;
    }
    await new Promise((r) => setTimeout(r, delay));
    // Increase delay more gradually, cap at 500ms
    delay = Math.min(500, Math.round(delay * 1.15));
  }
  console.warn(`[HEALTH CHECK] Daemon did not become healthy within ${timeoutMs}ms (${attempt} attempts)`);
  return false;
}

async function waitForReady(timeoutMs = DAEMON_HEALTH_CHECK_TIMEOUT_MS * 2) {
  const start = Date.now();
  let delay = 100; // Start with faster checks (100ms)
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    if (await isDaemonReady()) {
      const elapsed = Date.now() - start;
      console.log(`[READINESS CHECK] Daemon became ready after ${elapsed}ms (${attempt} attempts)`);
      return true;
    }
    await new Promise((r) => setTimeout(r, delay));
    // Increase delay more gradually, cap at 500ms
    delay = Math.min(500, Math.round(delay * 1.15));
  }
  console.warn(`[READINESS CHECK] Daemon did not become ready within ${timeoutMs}ms (${attempt} attempts)`);
  return false;
}

function httpGetJson(pathname: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: DAEMON_HOST, port: DAEMON_PORT, path: pathname, method: "GET", timeout: DAEMON_HTTP_TIMEOUT_MS },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(new Error("timeout")); });
    req.end();
  });
}

async function waitForDaemon(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await httpGetJson("/ready");
      if (r?.ready === true) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Check if a specific port is in use by an orc-daemon process.
 * Returns the PID if found, null otherwise.
 */
async function findProcessUsingPort(port: number): Promise<number | null> {
  if (process.platform !== "win32") {
    return null;
  }

  try {
    const pid = await new Promise<number | null>((resolve) => {
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }

        const lines = stdout.split("\n");
        for (const line of lines) {
          if (line.includes("LISTENING")) {
            const parts = line.trim().split(/\s+/);
            const pidStr = parts[parts.length - 1];
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid)) {
              resolve(pid);
              return;
            }
          }
        }
        resolve(null);
      });
    });

    if (!pid) {
      return null;
    }

    // Verify it's an orc-daemon process
    const isOrcDaemon = await new Promise<boolean>((resolve) => {
      exec(`tasklist /FI "PID eq ${pid}" /NH`, (error, stdout) => {
        if (error) {
          resolve(false);
          return;
        }
        const lowerOutput = stdout.toLowerCase();
        resolve(lowerOutput.includes("orc-daemon"));
      });
    });

    return isOrcDaemon ? pid : null;
  } catch (err) {
    console.warn(`[Port Hygiene] Error checking port ${port}:`, err);
    return null;
  }
}

/**
 * Kill a process by PID (Windows only).
 */
async function killProcess(pid: number): Promise<boolean> {
  if (process.platform !== "win32") {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    exec(`taskkill /PID ${pid} /F`, (error, stdout, stderr) => {
      if (error) {
        const errorMsg = error.message || String(error);
        const stderrMsg = stderr || "";
        
        if (errorMsg.includes("Access is denied") || 
            errorMsg.includes("access denied") ||
            stderrMsg.includes("Access is denied") ||
            stderrMsg.includes("access denied")) {
          console.warn(`[Port Hygiene] Permission denied killing process ${pid}. May need Administrator rights.`);
          resolve(false);
        } else if (errorMsg.includes("not found") || errorMsg.includes("not running")) {
          console.log(`[Port Hygiene] Process ${pid} already terminated`);
          resolve(true);
        } else {
          console.error(`[Port Hygiene] Failed to kill process ${pid}:`, errorMsg);
          resolve(false);
        }
      } else {
        console.log(`[Port Hygiene] Successfully killed process ${pid}`);
        resolve(true);
      }
    });
  });
}

async function cleanupStalePeerPorts(): Promise<{ cleaned: number; pids: number[] }> {
  if (process.platform !== "win32") {
    return { cleaned: 0, pids: [] };
  }

  const PEER_PORTS = [6881, 6882, 6883, 6884, 6885, 6886, 6887, 6888, 6889, 6890];
  const killedPids = new Set<number>();
  let cleaned = 0;

  console.log(`[Port Hygiene] Checking peer ports ${PEER_PORTS[0]}-${PEER_PORTS[PEER_PORTS.length - 1]} for stale processes...`);

  for (const port of PEER_PORTS) {
    const pid = await findProcessUsingPort(port);
    if (pid && !killedPids.has(pid)) {
      // Only kill if daemon is not healthy (avoid killing active daemon)
      const isHealthy = await isDaemonHealthy();
      if (!isHealthy) {
        console.log(`[Port Hygiene] Found stale orc-daemon (PID: ${pid}) using peer port ${port}`);
        const killed = await killProcess(pid);
        if (killed) {
          killedPids.add(pid);
          cleaned++;
        }
      } else {
        console.log(`[Port Hygiene] Port ${port} in use by healthy daemon (PID: ${pid}), skipping cleanup`);
      }
    }
  }

  if (cleaned > 0) {
    // Wait for ports to be released
    await new Promise((r) => setTimeout(r, 1000));
    console.log(`[Port Hygiene] Cleaned up ${cleaned} stale process(es) from peer ports`);
  } else {
    console.log(`[Port Hygiene] No stale processes found on peer ports`);
  }

  return { cleaned, pids: Array.from(killedPids) };
}

/**
 * Self-healing port hygiene: Detect and clean up stale daemon processes
 * before starting a new one. This prevents "port already in use" errors.
 * Also cleans up peer ports (6881-6890) to prevent DirectTransport binding failures.
 * @param options.forceKillEvenIfHealthy - When true, kill the process on the port even if it
 *   responds to health checks, so we can spawn our own daemon with ORC_DOWNLOAD_DIR set.
 */
async function cleanupStaleProcessesOnPort(options?: { forceKillEvenIfHealthy?: boolean }): Promise<{ cleaned: boolean; pid?: number }> {
  if (process.platform !== "win32") {
    // For now, only implement Windows. Unix systems can be added later.
    return { cleaned: false };
  }

  try {
    // First check if port is actually in use
    const portInUse = await new Promise<boolean>((resolve) => {
      const testSocket = net.createConnection(DAEMON_PORT, DAEMON_HOST, () => {
        testSocket.destroy();
        resolve(true); // Port is listening
      });
      testSocket.on("error", () => {
        resolve(false); // Port is not in use
      });
      testSocket.setTimeout(1000, () => {
        testSocket.destroy();
        resolve(false);
      });
    });

    if (!portInUse) {
      console.log(`[Port Hygiene] Port ${DAEMON_PORT} is not in use, no cleanup needed`);
      return { cleaned: false };
    }

    // Port is in use - check if it's a healthy daemon (unless we want to replace it anyway)
    const forceKill = options?.forceKillEvenIfHealthy === true;
    const isHealthy = await isDaemonHealthy();
    if (isHealthy && !forceKill) {
      console.log(`[Port Hygiene] Port ${DAEMON_PORT} is in use by a healthy daemon, no cleanup needed`);
      return { cleaned: false };
    }
    if (isHealthy && forceKill) {
      console.log(`[Port Hygiene] Replacing external daemon with app-owned daemon (ORC_DOWNLOAD_DIR will be set)`);
    }

    // Port is in use - find and kill the process (stale or external we're replacing)
    console.warn(`[Port Hygiene] Port ${DAEMON_PORT} is in use but daemon is not healthy - attempting cleanup`);

    const pid = await findProcessUsingPort(DAEMON_PORT);
    if (!pid) {
      console.warn(`[Port Hygiene] Could not find orc-daemon process using port ${DAEMON_PORT}`);
      return { cleaned: false };
    }

    console.log(`[Port Hygiene] Found stale orc-daemon (PID: ${pid}) using port ${DAEMON_PORT}`);
    const killed = await killProcess(pid);

    if (killed) {
      // Wait a moment for port to be released
      await new Promise((r) => setTimeout(r, 500));
      
      // Verify port is now free
      const stillInUse = await new Promise<boolean>((resolve) => {
        const testSocket = net.createConnection(DAEMON_PORT, DAEMON_HOST, () => {
          testSocket.destroy();
          resolve(true);
        });
        testSocket.on("error", () => {
          resolve(false);
        });
        testSocket.setTimeout(1000, () => {
          testSocket.destroy();
          resolve(false);
        });
      });

      if (stillInUse) {
        console.warn(`[Port Hygiene] Port ${DAEMON_PORT} is still in use after killing process ${pid}`);
        return { cleaned: false, pid };
      }

      console.log(`[Port Hygiene] Port ${DAEMON_PORT} is now free after cleanup`);
      return { cleaned: true, pid };
    }

    return { cleaned: false, pid };
  } catch (err) {
    console.error("[Port Hygiene] Error during cleanup:", err);
    return { cleaned: false };
  }
}

function resolveDaemonBinary(): string {
  const exe = process.platform === "win32" ? "orc-daemon.exe" : "orc-daemon";

  console.log(`[Binary Resolution] Looking for daemon binary: ${exe}`);
  console.log(`[Binary Resolution] isDev: ${isDev}, app.isPackaged: ${app.isPackaged}`);
  console.log(`[Binary Resolution] process.resourcesPath: ${process.resourcesPath || "undefined"}`);
  console.log(`[Binary Resolution] process.execPath: ${process.execPath}`);

  // Packaged: shipped into resources/bin via electron-builder extraResources
  const packaged = process.resourcesPath 
    ? path.join(process.resourcesPath, "bin", exe)
    : null;
  
  if (packaged) {
    console.log(`[Binary Resolution] Packaged path candidate: ${packaged} (exists: ${existsSync(packaged)})`);
  }

  const exeDir = path.dirname(process.execPath);
  const packagedNextToExe = path.join(exeDir, "bin", exe);
  const packagedSameDir = path.join(exeDir, exe);

  // Dev: prefer cargo build output (repo root)
  const devCandidate = path.resolve(process.cwd(), "..", "..", "crates", "target", "debug", exe);

  const devAsset = path.resolve(process.cwd(), "assets", "bin", exe);

  // Check each path and return the first that exists
  // For packaged apps, check all packaged paths first, then fall back to dev paths
  const candidates = [
    // Packaged app paths (checked first for packaged apps)
    { path: packaged, name: "packaged (resources/bin)", check: !isDev && packaged },
    { path: packagedNextToExe, name: "packaged (exe/bin)", check: !isDev },
    { path: packagedSameDir, name: "packaged (exe dir)", check: !isDev },
    // Dev paths (checked first for dev, but also as fallback for packaged)
    { path: devCandidate, name: "dev build", check: isDev },
    { path: devAsset, name: "local asset", check: true },
    { path: packaged, name: "packaged (resources/bin) fallback", check: isDev && packaged },
    { path: packagedNextToExe, name: "packaged (exe/bin) fallback", check: isDev },
    { path: packagedSameDir, name: "packaged (exe dir) fallback", check: isDev },
    { path: devCandidate, name: "dev build fallback", check: !isDev },
  ];

  for (const candidate of candidates) {
    if (candidate.check && candidate.path) {
      try {
        // On Windows, use existsSync to check, but also verify we can access it
        if (existsSync(candidate.path)) {
          // Additional check on Windows: verify file is readable
          if (process.platform === "win32") {
            try {
              // Try to read file stats as a basic accessibility check
              accessSync(candidate.path, constants.R_OK);
            } catch (accessErr) {
              console.warn(`Binary exists at ${candidate.path} but may not be accessible:`, accessErr);
              // Continue to next candidate
              continue;
            }
          }
          console.log(`[Binary Resolution] Found binary at: ${candidate.path} (${candidate.name})`);
          return candidate.path;
        }
      } catch (err) {
        console.warn(`Error checking ${candidate.name} binary at ${candidate.path}:`, err);
      }
    }
  }

  const fallback = isDev 
    ? devCandidate 
    : (packaged || packagedNextToExe || packagedSameDir || devAsset);
  
  console.warn(`No binary found in expected locations, using fallback: ${fallback}`);
  console.warn(`Checked paths:`);
  for (const candidate of candidates) {
    if (candidate.path) {
      const exists = existsSync(candidate.path);
      console.warn(`  ${candidate.name}: ${candidate.path} (exists: ${exists})`);
    }
  }
  console.warn(`Environment info:`);
  console.warn(`  process.resourcesPath: ${process.resourcesPath || "undefined"}`);
  console.warn(`  process.execPath: ${process.execPath}`);
  console.warn(`  process.cwd(): ${process.cwd()}`);
  console.warn(`  __dirname: ${__dirname}`);
  console.warn(`  isDev: ${isDev}`);
  console.warn(`  isPackaged: ${app.isPackaged}`);
  
  return fallback;
}

async function startDaemonIfNeeded(): Promise<boolean> {
  if (await isDaemonHealthy()) {
    const cleanupResult = await cleanupStaleProcessesOnPort({ forceKillEvenIfHealthy: true });
    if (cleanupResult.cleaned && cleanupResult.pid) {
      console.log(`[Start] Replaced external daemon (PID ${cleanupResult.pid}) with app-owned daemon (ORC_DOWNLOAD_DIR set)`);
      await new Promise((r) => setTimeout(r, 500)); // Allow port to be released
    } else if (!cleanupResult.cleaned) {
      isRestarting = false;
      return true;
    }
    // If we cleaned, fall through to spawn our daemon below
  }

  // If we're shutting down, don't start the daemon
  if (isShuttingDown) {
    console.log("Skipping daemon start - app is shutting down");
    isRestarting = false;
    return false;
  }
  
  // Prevent concurrent restart attempts
  if (isRestarting) {
    console.warn("[START] Already restarting, skipping duplicate start attempt");
    return false;
  }
  
  // If there's a pending restart, cancel it since we're starting now
  if (daemonRestartTimeout) {
    clearTimeout(daemonRestartTimeout);
    daemonRestartTimeout = null;
  }
  
  isRestarting = true;

  // Self-healing port hygiene: Clean up stale processes before starting
  console.log(`[Port Hygiene] Checking for stale processes on port ${DAEMON_PORT}...`);
  const cleanupResult = await cleanupStaleProcessesOnPort();
  if (cleanupResult.cleaned) {
    console.log(`[Port Hygiene] Cleaned up stale process (PID: ${cleanupResult.pid})`);
    if (daemonLogStream) {
      try {
        daemonLogStream.write(`[Port Hygiene] Cleaned up stale daemon process (PID: ${cleanupResult.pid}) before starting new daemon\n`);
      } catch {}
    }
  } else if (cleanupResult.pid) {
    console.warn(`[Port Hygiene] Could not clean up process ${cleanupResult.pid} - startup may fail`);
  }

  // Also clean up peer ports (6881-6890) to prevent DirectTransport binding failures
  console.log(`[Port Hygiene] Checking for stale processes on peer ports (6881-6890)...`);
  const peerCleanupResult = await cleanupStalePeerPorts();
  if (peerCleanupResult.cleaned > 0) {
    console.log(`[Port Hygiene] Cleaned up ${peerCleanupResult.cleaned} stale process(es) from peer ports (PIDs: ${peerCleanupResult.pids.join(', ')})`);
    if (daemonLogStream) {
      try {
        daemonLogStream.write(`[Port Hygiene] Cleaned up ${peerCleanupResult.cleaned} stale process(es) from peer ports\n`);
      } catch {}
    }
  }

  const bin = resolveDaemonBinary();

  // Pre-flight permission checks
  console.log("[Pre-flight] Checking binary permissions...");
  const binCheck = checkBinaryPermissions(bin);
  if (!binCheck.accessible) {
    const errorMsg = `Binary permission check failed: ${binCheck.error}`;
    console.error(`[Pre-flight] ${errorMsg}`);
    
    // Try to find an alternative binary
    console.log("[Pre-flight] Attempting to find alternative binary...");
    const altBin = resolveDaemonBinary(); // This will try all candidates again
    if (altBin !== bin) {
      const altCheck = checkBinaryPermissions(altBin);
      if (altCheck.accessible) {
        console.log(`[Pre-flight] Using alternative binary: ${altBin}`);
        // Continue with alternative binary
      } else {
        // Both failed - show error
        dialog.showErrorBox(
          "Permission Error",
          `Cannot access daemon binary.\n\n${binCheck.error}\n\nPlease check:\n- File permissions\n- Antivirus software\n- Try running as Administrator`
        );
        return false;
      }
    } else {
      // No alternative found
      dialog.showErrorBox(
        "Permission Error",
        `Cannot access daemon binary.\n\n${binCheck.error}\n\nPlease check:\n- File permissions\n- Antivirus software\n- Try running as Administrator`
      );
      return false;
    }
  }

  daemonAdminToken = crypto.randomBytes(24).toString("hex");

  const env = {
    ...process.env,
    DAEMON_BIND: `${DAEMON_HOST}:${DAEMON_PORT}`,
    DAEMON_ADMIN_TOKEN: daemonAdminToken,
    RUST_LOG: "info,orc_bt_core=debug,orc_daemon=debug", // Enable verbose logging
    ORC_DOWNLOAD_DIR: app.getPath('downloads'), // Save torrents in user's Downloads folder
  };

  console.log("[Pre-flight] Finding writable log directory...");
  let logFile: string;
  let log: ReturnType<typeof createWriteStream>;
  
  const logDirResult = await findWritableLogDirectory();
  if (logDirResult) {
    logFile = logDirResult.path;
    currentDaemonLogPath = logFile;
    if (logDirResult.error) {
      console.warn(`[Pre-flight] Log directory warning: ${logDirResult.error}`);
    }
  } else {
    console.warn("[Pre-flight] Async log finder failed, using fallback");
    try {
      logFile = daemonLogPath();
      currentDaemonLogPath = logFile;
    } catch (err) {
      console.error("Failed to determine log path:", err);
      logFile = path.join(os.tmpdir(), "orc-daemon.log");
      currentDaemonLogPath = logFile;
    }
  }

  // Verify log directory is writable before proceeding
  const logDir = path.dirname(logFile);
  const logDirCheck = await checkDirectoryPermissions(logDir);
  if (!logDirCheck.writable) {
    console.warn(`[Pre-flight] Log directory may not be writable: ${logDirCheck.error}`);
    const tempLogFile = path.join(os.tmpdir(), "orc-daemon.log");
    console.log(`[Pre-flight] Using temp directory for logs: ${tempLogFile}`);
    logFile = tempLogFile;
    currentDaemonLogPath = logFile;
  }
  
  if (daemonLogStream) {
    try {
      daemonLogStream.end();
    } catch (err) {
      console.error("Error closing previous log stream:", err);
    }
    daemonLogStream = null;
  }
  
  try {
    log = createWriteStream(logFile, { flags: "a" });
    daemonLogStream = log;
  } catch (err) {
    console.error(`Failed to create log file at ${logFile}:`, err);
    const fallbackLog = process.stderr;
    daemonLogStream = fallbackLog as any; // Type workaround, but will work for writing
    log = fallbackLog as any;
    fallbackLog.write(`[WARNING] Could not create log file at ${logFile}, logging to stderr\n`);
    fallbackLog.write(`[ERROR] ${err instanceof Error ? err.message : String(err)}\n`);
  }

  try {
    // Check if binary exists on Windows - spawn() can fail silently on Windows
    if (process.platform === "win32" && !existsSync(bin)) {
      const errorMsg = `Binary not found: ${bin}`;
      console.error(errorMsg);
      console.error(`process.resourcesPath: ${process.resourcesPath || "undefined"}`);
      console.error(`process.execPath: ${process.execPath}`);
      console.error(`__dirname: ${__dirname}`);
      console.error(`isDev: ${isDev}`);
      throw new Error(errorMsg);
    }
    
    console.log(`Starting daemon from: ${bin}`);
    console.log(`Daemon bind: ${DAEMON_HOST}:${DAEMON_PORT}`);
    console.log(`Log file: ${logFile}`);
    
    daemonProc = spawn(bin, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    daemonSpawnedByApp = true;
    
    console.log(`Daemon process spawned (PID: ${daemonProc.pid || "unknown"})`);
    
    // Log initial process info
    try {
      log.write(`[STARTUP] Daemon process started\n`);
      log.write(`[STARTUP] PID: ${daemonProc.pid || "unknown"}\n`);
      log.write(`[STARTUP] Binary: ${bin}\n`);
      log.write(`[STARTUP] Bind: ${DAEMON_HOST}:${DAEMON_PORT}\n`);
      log.write(`[STARTUP] Environment: DAEMON_BIND=${env.DAEMON_BIND}, DAEMON_ADMIN_TOKEN=${env.DAEMON_ADMIN_TOKEN ? "set" : "not set"}, RUST_LOG=${env.RUST_LOG}, ORC_DOWNLOAD_DIR=${env.ORC_DOWNLOAD_DIR}\n`);
    } catch (logErr) {
      console.error("Failed to write startup info to log:", logErr);
    }
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const errorMessage = error.message || String(e);
    
    try {
      log.write(`[ERROR] Failed to spawn daemon: ${errorMessage}\n`);
      log.write(`[ERROR] Binary path: ${bin}\n`);
      log.write(`[ERROR] Binary exists: ${existsSync(bin)}\n`);
      if (process.platform === "win32") {
        log.write(`[ERROR] On Windows, ensure the binary exists and is not blocked by antivirus\n`);
      }
      if (log !== (process.stderr as any) && typeof log.end === "function") {
        log.end();
      }
    } catch (logErr) {
      console.error("Failed to write error to log:", logErr);
    }
    daemonLogStream = null;
    
    // User-friendly error messages
    let userMessage: string;
    
    if (isDev) {
      // Developer mode - show build instructions
      userMessage = `Could not start the Rust daemon.

Expected binary at:
${bin}

Build it with:
cd crates && cargo build -p orc-daemon

Log path:
${logFile}`;
    } else {
      // Packaged app - user-friendly message
      userMessage = `Could not start the daemon process.

The application is missing required files. This may indicate:
- The installation is incomplete or corrupted
- Antivirus software blocked or removed the daemon executable
- Files were deleted or moved

Please try:
1. Reinstalling the application
2. Checking your antivirus software (Windows Defender, etc.)
3. Running the application as Administrator

Log file location:
${logFile}

Expected daemon binary location:
${bin}`;
    }

    if (process.platform === "win32") {
      if (errorMessage.includes("ENOENT") || !existsSync(bin)) {
        if (!isDev) {
          userMessage += `\n\nWindows-specific troubleshooting:
- Check if ${path.basename(bin)} exists in the application directory
- Review Windows Defender or antivirus quarantine logs
- Try running the installer again to restore missing files`;
        } else {
          userMessage += `\n\nWindows-specific issues:
- The binary file may not exist at the expected location
- Antivirus software may have blocked or quarantined the file
- Check Windows Defender or your antivirus logs`;
        }
      } else if (errorMessage.includes("EACCES") || errorMessage.includes("permission")) {
        userMessage += `\n\nWindows permission error:
- Try running the application as Administrator
- Check if another process is using the binary
- Ensure the file is not read-only`;
      }
    }
    
    dialog.showErrorBox("Daemon start failed", userMessage);
    isRestarting = false;
    return false;
  }

  if (!daemonProc) {
    // Only call end() if log is a file stream (not stderr fallback)
    if (log !== (process.stderr as any) && typeof log.end === "function") {
      try {
        log.end();
      } catch (err) {
        console.error("Error closing log stream:", err);
      }
    }
    daemonLogStream = null;
    isRestarting = false;
    return false;
  }

    daemonProc.on("error", (err) => {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;
    
    try {
      log.write(`[daemon error] ${errorMsg}\n`);
      if (errorStack) {
        log.write(`[daemon error stack] ${errorStack}\n`);
      }
      // On Windows, provide more context for common errors
      if (process.platform === "win32") {
        if (errorMsg.includes("ENOENT")) {
          log.write(`[WARNING] Binary not found - check if antivirus blocked it\n`);
          log.write(`[WARNING] Binary path was: ${bin}\n`);
        } else if (errorMsg.includes("EACCES")) {
          log.write(`[WARNING] Permission denied - may need to run as Administrator\n`);
        } else if (errorMsg.includes("spawn")) {
          log.write(`[WARNING] Failed to spawn process - check binary permissions and antivirus\n`);
        }
      }
    } catch (logErr) {
      console.error("Failed to write daemon error to log:", logErr);
    }
    
    // If we get an error event, the process will likely exit soon
    // But we'll let the exit handler deal with restart logic
    console.error(`[CRITICAL] Daemon process error: ${errorMsg}`);
    if (errorStack) {
      console.error(`[CRITICAL] Stack: ${errorStack}`);
    }
  });

  daemonProc.stdout?.on("data", (b) => {
    try {
      const output = b.toString();
      log.write(b);
      // Also log to console for immediate debugging
      const lines = output.trim().split("\n");
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.log(`[Daemon stdout] ${line}`);
          // Check for key startup messages
          if (line.includes("listening on") || line.includes("daemon listening")) {
            console.log(`[STARTUP] Daemon is listening - should become healthy soon`);
          }
        }
      });
    } catch (logErr) {
      console.error("Failed to write stdout to log:", logErr);
    }
  });
  
  daemonProc.stderr?.on("data", (b) => {
    try {
      const output = b.toString();
      log.write(b);
      // Also log to console for immediate debugging
      const lines = output.trim().split("\n");
      lines.forEach((line: string) => {
        if (line.trim()) {
          console.error(`[Daemon stderr] ${line}`);
          // Check for critical errors
          if (line.includes("error") || line.includes("Error") || line.includes("ERROR") || 
              line.includes("failed to bind") || line.includes("panic")) {
            console.error(`[CRITICAL] Daemon error detected: ${line}`);
          }
        }
      });
    } catch (logErr) {
      console.error("Failed to write stderr to log:", logErr);
    }
  });

  daemonProc.on("exit", (code, signal) => {
    const procRef = daemonProc;
    daemonProc = null; // Clear reference immediately to prevent race conditions
    
    try {
      log.write(`\n[daemon exit] code=${code}, signal=${signal || "none"}\n`);
      console.error(`[Daemon Exit] Process exited with code: ${code}, signal: ${signal || "none"}`);
      
      // On Windows, provide exit code meaning
      if (process.platform === "win32" && code !== null && code !== 0) {
        log.write(`[WARNING] Daemon exited with non-zero code ${code}\n`);
        log.write(`[INFO] Common Windows exit codes:\n`);
        log.write(`[INFO]   1 = general error\n`);
        log.write(`[INFO]   2 = invalid DAEMON_BIND\n`);
        log.write(`[INFO]   3 = refused non-loopback bind\n`);
        log.write(`[INFO]   4 = failed to bind port (port may be in use)\n`);
        log.write(`[INFO]   5 = server error\n`);
        log.write(`[INFO]   3221226505 = access violation (crash)\n`);
        
        if (code === 4) {
          log.write(`[ERROR] Port ${DAEMON_PORT} is likely already in use!\n`);
          log.write(`[ERROR] Check with: netstat -ano | findstr :${DAEMON_PORT}\n`);
          log.write(`[INFO] Port hygiene will attempt cleanup before restart\n`);
        }
      }
    } catch (logErr) {
      console.error("Failed to write exit code to log:", logErr);
    }
    
    // Don't restart if we're shutting down or if we didn't spawn this process
    if (isShuttingDown || !daemonSpawnedByApp) {
      try {
        log.write(`[INFO] Not restarting daemon (shutting down: ${isShuttingDown}, spawned by app: ${daemonSpawnedByApp})\n`);
        if (log !== (process.stderr as any) && typeof log.end === "function") {
          log.end(() => {
            daemonLogStream = null;
          });
        } else {
          daemonLogStream = null;
        }
      } catch (closeErr) {
        console.error("Error closing log stream:", closeErr);
        daemonLogStream = null;
      }
      return;
    }
    
    // Check if we've exceeded max restart attempts
    if (daemonRestartAttempts >= MAX_RESTART_ATTEMPTS) {
      try {
        log.write(`[ERROR] Maximum restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Stopping automatic restarts.\n`);
        log.write(`[ERROR] Please restart the application manually.\n`);
        if (log !== (process.stderr as any) && typeof log.end === "function") {
          log.end(() => {
            daemonLogStream = null;
          });
        } else {
          daemonLogStream = null;
        }
      } catch (closeErr) {
        console.error("Error closing log stream:", closeErr);
        daemonLogStream = null;
      }
      
      // Show error to user after max attempts
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox(
          "Daemon Crashed",
          `The daemon has crashed ${MAX_RESTART_ATTEMPTS} times and automatic restart has been disabled.\n\nPlease restart the application.\n\nExit code: ${code}\nLog: ${logFile}`
        );
      }
      return;
    }
    
    // For a managed daemon, we always restart on exit (regardless of exit code)
    // to keep the service running. The only exceptions are:
    // For exit code 4 (port in use), use shorter delay since we'll clean up the port
    const isPortInUse = code === 4;
    const delay = isPortInUse 
      ? Math.min(1000, INITIAL_RESTART_DELAY_MS) // 1 second for port issues
      : Math.min(
          INITIAL_RESTART_DELAY_MS * Math.pow(2, daemonRestartAttempts),
          MAX_RESTART_DELAY_MS
        );
    daemonRestartAttempts++;
    
    try {
      if (isPortInUse) {
        log.write(`[INFO] Daemon exited due to port in use. Will cleanup and restart in ${delay}ms (attempt ${daemonRestartAttempts}/${MAX_RESTART_ATTEMPTS})\n`);
      } else {
        log.write(`[INFO] Daemon exited unexpectedly (code: ${code}). Will restart in ${delay}ms (attempt ${daemonRestartAttempts}/${MAX_RESTART_ATTEMPTS})\n`);
      }
    } catch (logErr) {
      console.error("Failed to write restart info to log:", logErr);
    }
    
    console.warn(`Daemon crashed (exit code: ${code}). Restarting in ${delay}ms (attempt ${daemonRestartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
    
    // Schedule restart with exponential backoff (or shorter delay for port issues)
    daemonRestartTimeout = setTimeout(async () => {
      daemonRestartTimeout = null;
      if (isShuttingDown || !mainWindow || mainWindow.isDestroyed()) {
        console.log("Skipping daemon restart - app is shutting down or window closed");
        isRestarting = false;
        return;
      }
      
      // Prevent concurrent restart attempts
      if (isRestarting) {
        console.warn("[RESTART] Already restarting, skipping duplicate restart attempt");
        return;
      }
      
      // Enforce cooldown period to prevent rapid restart loops
      const timeSinceLastRestart = Date.now() - lastRestartTime;
      if (timeSinceLastRestart < MIN_RESTART_COOLDOWN_MS) {
        const remainingCooldown = MIN_RESTART_COOLDOWN_MS - timeSinceLastRestart;
        console.warn(`[RESTART COOLDOWN] Too soon since last restart (${timeSinceLastRestart}ms < ${MIN_RESTART_COOLDOWN_MS}ms). Waiting ${remainingCooldown}ms more...`);
        daemonRestartTimeout = setTimeout(async () => {
          daemonRestartTimeout = null;
          // Retry after cooldown
          if (!isShuttingDown && mainWindow && !mainWindow.isDestroyed() && !isRestarting) {
            isRestarting = true;
            try {
              daemonProc?.removeAllListeners("exit");
              daemonProc = null;
              daemonSpawnedByApp = false;
              await startDaemonIfNeeded();
            } finally {
              isRestarting = false;
            }
          }
        }, remainingCooldown);
        return;
      }
      
      lastRestartTime = Date.now();
      isRestarting = true;
      
      try {
        console.log(`Attempting to restart daemon (attempt ${daemonRestartAttempts}/${MAX_RESTART_ATTEMPTS})...`);
        // Reset the spawned flag temporarily so startDaemonIfNeeded will actually start it
        daemonSpawnedByApp = false;
        await startDaemonIfNeeded();
        
        // Wait for daemon to become healthy (increased timeout for reliability)
        const healthy = await waitForHealthy(DAEMON_HEALTH_CHECK_TIMEOUT_MS);
        if (healthy) {
          console.log("Daemon restarted successfully and is healthy");
          // Schedule counter reset after a period of stability
          // This gives the daemon time to prove it's stable
          setTimeout(async () => {
            if (!isShuttingDown && await isDaemonHealthy()) {
              daemonRestartAttempts = 0;
              lastRestartTime = 0; // Reset cooldown timer on successful stability
              console.log(`Daemon has been stable for ${DAEMON_STABILITY_PERIOD_MS / 1000} seconds, resetting restart attempt counter`);
              try {
                if (daemonLogStream && daemonLogStream !== (process.stderr as any)) {
                  daemonLogStream.write(`[INFO] Daemon stable, restart counter reset to 0\n`);
                }
              } catch (logErr) {
                // Ignore log errors
              }
            }
          }, DAEMON_STABILITY_PERIOD_MS);
        } else {
          console.warn("Daemon restarted but did not become healthy within timeout");
          // Counter will continue to increment on next crash
        }
      } catch (err) {
        console.error("Failed to restart daemon:", err);
        // The restart will be retried by the health check interval
        // Don't increment counter here - it will increment on next exit
      } finally {
        isRestarting = false;
      }
    }, delay);
  });

  console.log(`Waiting for daemon to become healthy (timeout: ${DAEMON_HEALTH_CHECK_TIMEOUT_MS / 1000}s)...`);
  try {
    log.write(`[HEALTH CHECK] Starting health check, waiting up to ${DAEMON_HEALTH_CHECK_TIMEOUT_MS / 1000} seconds...\n`);
    log.write(`[HEALTH CHECK] Checking if daemon is listening on ${DAEMON_HOST}:${DAEMON_PORT}...\n`);
  } catch (logErr) {
    // Ignore log errors
  }
  
  const up = await waitForHealthy(DAEMON_HEALTH_CHECK_TIMEOUT_MS);
  if (!up) {
    // Log diagnostic information
    try {
      log.write(`[HEALTH CHECK] Failed - daemon did not become healthy within ${DAEMON_HEALTH_CHECK_TIMEOUT_MS / 1000} seconds\n`);
      log.write(`[DIAGNOSTIC] Checking if process is still running...\n`);
      
      // Check if process is still alive
      if (daemonProc) {
        try {
          // On Windows, check if process exists
          if (process.platform === "win32") {
            // Try to get process exit code (null means still running)
            const exitCode = (daemonProc as any).exitCode;
            if (exitCode !== null && exitCode !== undefined) {
              log.write(`[DIAGNOSTIC] Process has exited with code: ${exitCode}\n`);
            } else {
              log.write(`[DIAGNOSTIC] Process appears to be running (PID: ${daemonProc.pid})\n`);
            }
          } else {
            // On Unix, try to send signal 0 to check if process exists
            try {
              if (daemonProc.pid) {
                process.kill(daemonProc.pid, 0);
                log.write(`[DIAGNOSTIC] Process is running (PID: ${daemonProc.pid})\n`);
              }
            } catch (killErr) {
              log.write(`[DIAGNOSTIC] Process may have exited (kill check failed)\n`);
            }
          }
        } catch (procErr) {
          log.write(`[DIAGNOSTIC] Could not check process status: ${procErr}\n`);
        }
      } else {
        log.write(`[DIAGNOSTIC] Process reference is null\n`);
      }
      
      // Check if port is accessible
      log.write(`[DIAGNOSTIC] Checking if port ${DAEMON_PORT} is accessible...\n`);
      
      // Try to connect to the port to see if it's listening
      try {
        const testSocket = net.createConnection(DAEMON_PORT, DAEMON_HOST, () => {
          log.write(`[DIAGNOSTIC] Port ${DAEMON_PORT} is accessible (connection successful)\n`);
          testSocket.destroy();
        });
        testSocket.on("error", (err: Error) => {
          log.write(`[DIAGNOSTIC] Port ${DAEMON_PORT} connection failed: ${err.message}\n`);
          if (err.message.includes("ECONNREFUSED")) {
            log.write(`[DIAGNOSTIC] Port is not listening - daemon may not have started properly\n`);
          } else if (err.message.includes("EADDRINUSE")) {
            log.write(`[DIAGNOSTIC] Port is in use by another process\n`);
          }
        });
        testSocket.setTimeout(2000, () => {
          log.write(`[DIAGNOSTIC] Port connection test timed out\n`);
          testSocket.destroy();
        });
      } catch (testErr) {
        log.write(`[DIAGNOSTIC] Could not test port connection: ${testErr}\n`);
      }
    } catch (logErr) {
      console.error("Failed to write diagnostic info:", logErr);
    }
    // Check if process exited
    let processStatus = "unknown";
    let exitCode: number | null = null;
    if (daemonProc) {
      try {
        exitCode = (daemonProc as any).exitCode;
        if (exitCode !== null && exitCode !== undefined) {
          processStatus = `exited with code ${exitCode}`;
        } else {
          processStatus = `running (PID: ${daemonProc.pid})`;
        }
      } catch {
        processStatus = "status unknown";
      }
    } else {
      processStatus = "process reference lost";
    }
    
    const errorMsg = `The daemon process started but did not become healthy.

Port: ${DAEMON_PORT}
Binary: ${bin}
Process Status: ${processStatus}
Log: ${logFile}

Possible causes:
- Another process is already bound to port ${DAEMON_PORT}
- The daemon binary failed to start (check the log file)
- Firewall is blocking the daemon
- The daemon crashed on startup
- The daemon is taking longer than expected to initialize

Check the log file at: ${logFile}
The log file contains detailed error messages from the daemon process.

To check if port is in use:
Windows: netstat -ano | findstr :${DAEMON_PORT}
Linux/Mac: lsof -i :${DAEMON_PORT}`;
    
    console.error(errorMsg);
    console.error(`Process status: ${processStatus}`);
    if (exitCode !== null) {
      console.error(`Exit code: ${exitCode}`);
    }
    
    dialog.showErrorBox("Daemon not responding", errorMsg);
    isRestarting = false;
    return false;
  } else {
    console.log(`Daemon is healthy and reachable on ${DAEMON_HOST}:${DAEMON_PORT}`);
    
    // Wait for daemon to be ready (fully initialized) before allowing operations
    console.log(`Waiting for daemon to become ready (timeout: ${DAEMON_HEALTH_CHECK_TIMEOUT_MS * 2 / 1000}s)...`);
    try {
      log.write(`[READINESS CHECK] Daemon is healthy, waiting for readiness...\n`);
    } catch (logErr) {
      // Ignore log errors
    }
    
    const ready = await waitForReady(DAEMON_HEALTH_CHECK_TIMEOUT_MS * 2);
    if (!ready) {
      console.warn(`Daemon is healthy but not ready within timeout - operations may fail`);
      try {
        log.write(`[WARNING] Daemon health check passed but readiness check timed out\n`);
      } catch (logErr) {
        // Ignore log errors
      }
      // Still return true to allow operations (daemon may become ready later)
    } else {
      console.log(`Daemon is ready and fully initialized`);
      try {
        log.write(`[READINESS CHECK] Daemon is ready\n`);
      } catch (logErr) {
        // Ignore log errors
      }
    }
    
    // Reset restart counter on successful start
    daemonRestartAttempts = 0;
    lastRestartTime = 0; // Reset cooldown timer on successful start
    isRestarting = false;
    return true;
  }
}

async function gracefulShutdownIfOwned() {
  if (!daemonProc || !daemonSpawnedByApp) return;

  // Store reference to avoid race condition
  const procRef = daemonProc;
  const logStreamRef = daemonLogStream;
  
  try {
    await httpRequestJson("POST", "/admin/shutdown", { "x-admin-token": daemonAdminToken });
  } catch {
    // Ignore and fall back to process kill
  }

  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (procRef.killed) break;
    // if process has exited, procRef.exitCode will be non-null
    if ((procRef as any).exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 120));
  }

  if ((procRef as any).exitCode === null && !procRef.killed) {
    try { 
      procRef.kill(); 
    } catch {}
  }
  
  if (logStreamRef && logStreamRef !== (process.stderr as any) && typeof logStreamRef.end === "function") {
    try {
      logStreamRef.end();
    } catch (err) {
      console.error("Error closing log stream during shutdown:", err);
    }
    daemonLogStream = null;
  }
}

interface FirewallRuleInfo {
  exists: boolean;
  managed: boolean; // true if managed by Group Policy
  error?: string;
  /** true if check failed due to access denied / admin required (can't read rules) */
  checkAccessDenied?: boolean;
}

async function checkWindowsFirewallRule(ruleName: string): Promise<FirewallRuleInfo> {
  return new Promise((resolve) => {
    const escaped = ruleName.replace(/"/g, '""');
    const command = `netsh advfirewall firewall show rule name="${escaped}"`;
    exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const msg = (error.message || stderr || String(stdout || '')).toLowerCase();
        const accessDenied = isElevationError(msg) || msg.includes('access is denied') || msg.includes('access denied');
        resolve({
          exists: false,
          managed: false,
          checkAccessDenied: accessDenied,
          error: error.message || stderr,
        });
        return;
      }
      const ruleExists = stdout.includes(ruleName) && !stdout.includes("No rules match");
      const isManaged = stdout.includes("Group Policy") || stdout.includes("GP");
      resolve({ exists: ruleExists, managed: isManaged });
    });
  });
}

/**
 * Check for outbound firewall rules for ORC TORRENT
 * Returns true if at least one outbound rule exists
 */
async function checkWindowsFirewallOutboundRules(): Promise<{ exists: boolean; checkAccessDenied?: boolean }> {
  return new Promise((resolve) => {
    // Check for any ORC TORRENT outbound rules
    const command = `netsh advfirewall firewall show rule name=all | findstr /C:"ORC" /C:"orc" | findstr /C:"Outbound"`;
    exec(command, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const msg = (error.message || stderr || String(stdout || '')).toLowerCase();
        const accessDenied = isElevationError(msg) || msg.includes('access is denied') || msg.includes('access denied');
        resolve({
          exists: false,
          checkAccessDenied: accessDenied,
        });
        return;
      }
      // If we get output, outbound rules exist
      const hasOutboundRules = stdout.trim().length > 0 && stdout.toLowerCase().includes('outbound');
      resolve({ exists: hasOutboundRules });
    });
  });
}

async function checkIfFirewallManaged(): Promise<boolean> {
  return new Promise((resolve) => {
    // Check if firewall is managed by Group Policy
    const command = `netsh advfirewall show allprofiles state`;
    exec(command, { encoding: 'utf8' }, (error, stdout) => {
      if (error) {
        resolve(false);
        return;
      }
      // Check if output indicates Group Policy management
      const isManaged = stdout.includes("Group Policy") || stdout.includes("GP");
      resolve(isManaged);
    });
  });
}

interface AddFirewallRuleOptions {
  ruleName: string;
  exePath: string;
  port?: number; // Specific port (optional - if not provided, allows any port for the program)
  protocol?: 'tcp' | 'udp' | 'both'; // Default: 'tcp'
  profile?: 'private' | 'public' | 'domain' | 'all'; // Default: 'private'
  scope?: string; // e.g., "LocalSubnet" or specific IP range
}

const RUN_AS_ADMIN_MSG =
  "Administrator rights are required. Right-click ORC TORRENT → Run as administrator, then try the firewall fix again.";

function isElevationError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("elevation") ||
    m.includes("administrator") ||
    m.includes("access denied") ||
    m.includes("access is denied") ||
    m.includes("requested operation requires") ||
    m.includes("run as") ||
    m.includes("permission") ||
    m.includes("1223") || // ERROR_CANCELLED (user cancelled UAC)
    m.includes("canceled by the user") ||
    m.includes("cancelled by the user")
  );
}

async function addWindowsFirewallRulesBatch(
  rules: Array<{ port: number; protocol?: 'tcp' | 'udp' | 'both'; profile?: 'private' | 'public' | 'domain' | 'all' }>,
  exePath: string,
  baseRuleName: string = "ORC TORRENT BitTorrent Peer"
): Promise<{ success: boolean; error?: string; needsElevation?: boolean; added: number; skipped: number }> {
  return new Promise((resolve) => {
    const escapeForCmd = (str: string) => str.replace(/"/g, '""');
    const escapedExePath = escapeForCmd(exePath);
    const validProfiles = ['private', 'public', 'domain'];
    
    // Build all netsh commands in a single PowerShell script
    const netshCommands: string[] = [];
    
    for (const rule of rules) {
      const port = rule.port;
      const protocol = rule.protocol || 'both';
      const profile = rule.profile || 'all';
      const profilesToUse = profile === 'all' ? validProfiles : [profile];
      const protocolsToUse = protocol === 'both' ? ['tcp', 'udp'] : [protocol];
      
      for (const prof of profilesToUse) {
        for (const proto of protocolsToUse) {
          const ruleSuffix = profilesToUse.length > 1 || protocolsToUse.length > 1 ? ` (${prof}/${proto})` : '';
          const fullRuleName = `${baseRuleName} Port ${port}${ruleSuffix}`;
          const escapedRuleName = escapeForCmd(fullRuleName);
          
          // Build netsh commands for both inbound and outbound
          const createNetshCommand = (direction: 'in' | 'out') => {
            const directionSuffix = direction === 'out' ? ' Out' : '';
            const fullRuleNameWithDir = `${baseRuleName} Port ${port}${directionSuffix}${ruleSuffix}`;
            const escapedRuleNameWithDir = escapeForCmd(fullRuleNameWithDir);
            
            const netshArgs = [
              'advfirewall',
              'firewall',
              'add',
              'rule',
              `name="${escapedRuleNameWithDir}"`,
              `dir=${direction}`,
              'action=allow',
              `program="${escapedExePath}"`,
              `profile=${prof}`,
              'enable=yes',
              `localport=${port}`,
              `protocol=${proto}`
            ];
            
            // Build netsh command with proper escaping
            const netshArgsEscaped = netshArgs.map(arg => {
              // Escape single quotes for PowerShell
              return `'${arg.replace(/'/g, "''")}'`;
            });
            
            return `try { ` +
              `  $result = & netsh ${netshArgsEscaped.join(' ')} 2>&1; ` +
              `  if ($LASTEXITCODE -eq 0) { $added++ } ` +
              `  elseif ($result -match 'already exists|object already exists') { $skipped++ } ` +
              `  else { Write-Warning "Failed to add rule: $result" } ` +
              `} catch { ` +
              `  if ($_.Exception.Message -match 'already exists|object already exists') { $skipped++ } ` +
              `  else { Write-Warning "Error: $($_.Exception.Message)" } ` +
              `}`;
          };
          
          // Add both inbound and outbound commands
          netshCommands.push(createNetshCommand('in'));
          netshCommands.push(createNetshCommand('out'));
        }
      }
    }
    
    if (netshCommands.length === 0) {
      resolve({ success: true, added: 0, skipped: 0 });
      return;
    }
    
    // Create single PowerShell script that runs all commands with elevation
    const psScript = [
      '$ErrorActionPreference = "Continue"',
      '$added = 0',
      '$skipped = 0',
      ...netshCommands,
      'Write-Host "BATCH_RESULT: Added=$added Skipped=$skipped"',
      'if ($added -gt 0 -or $skipped -gt 0) { exit 0 } else { exit 1 }'
    ].join('\n');
    
    // Use temporary file approach to avoid command-line length limits
    // Write script to temp file, then execute it with elevation
    const tempDir = os.tmpdir();
    const tempScriptPath = path.join(tempDir, `orc-firewall-rules-${Date.now()}-${Math.random().toString(36).substring(7)}.ps1`);
    
    try {
      // Write script to temp file
      writeFileSync(tempScriptPath, psScript, 'utf8');
      
      // Create wrapper that elevates and runs the temp script file (single UAC prompt)
      const wrapperScript = [
        `$scriptPath = "${tempScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`,
        '$process = Start-Process -FilePath "powershell.exe" -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath -Verb RunAs -Wait -PassThru -NoNewWindow',
        '$exitCode = $process.ExitCode',
        'Remove-Item -Path $scriptPath -Force -ErrorAction SilentlyContinue',
        'exit $exitCode'
      ].join('; ');
      
      const wrapperBytes = Buffer.from(wrapperScript, 'utf16le');
      const wrapperBase64 = wrapperBytes.toString('base64');
      const command = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${wrapperBase64}`;
      
      // Execute with elevation (single UAC prompt)
      exec(command, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        // Clean up temp file even if execution failed
        try {
          if (existsSync(tempScriptPath)) {
            unlinkSync(tempScriptPath);
          }
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
        
        if (error) {
        const errorMsg = (error.message || stderr || String(stdout || '')).toLowerCase();
        if (isElevationError(errorMsg)) {
          resolve({ success: false, error: RUN_AS_ADMIN_MSG, needsElevation: true, added: 0, skipped: 0 });
          return;
        }
        // Try to parse added/skipped from output
        const batchMatch = stdout.match(/BATCH_RESULT:\s*Added=(\d+)\s+Skipped=(\d+)/);
        if (batchMatch) {
          const added = parseInt(batchMatch[1], 10);
          const skipped = parseInt(batchMatch[2], 10);
          if (added > 0 || skipped > 0) {
            resolve({ success: true, added, skipped });
            return;
          }
        }
        
        resolve({ success: false, error: error.message || stderr || 'Unknown error', added: 0, skipped: 0 });
        return;
      }
      
      // Parse output to get counts
      const batchMatch = stdout.match(/BATCH_RESULT:\s*Added=(\d+)\s+Skipped=(\d+)/);
      if (batchMatch) {
        const added = parseInt(batchMatch[1], 10);
        const skipped = parseInt(batchMatch[2], 10);
        resolve({ success: true, added, skipped });
      } else {
        resolve({ success: true, added: 0, skipped: 0 });
      }
      });
    } catch (writeError) {
      // If we can't write the temp file, fall back to old method (but this may still fail)
      resolve({ success: false, error: `Failed to create temporary script file: ${writeError}`, added: 0, skipped: 0 });
    }
  });
}

async function addWindowsFirewallRule(options: AddFirewallRuleOptions): Promise<{ success: boolean; error?: string; needsElevation?: boolean }> {
  return new Promise((resolve) => {
    const { ruleName, exePath, port, protocol = 'tcp', profile = 'private', scope } = options;
    
    // Validate port if provided
    if (port !== undefined && (port < 1 || port > 65535 || !Number.isInteger(port))) {
      resolve({ success: false, error: `Invalid port: ${port}. Must be between 1 and 65535.` });
      return;
    }
    
    // Validate profile - 'all' is not a valid netsh profile, need to handle separately
    const validProfiles = ['private', 'public', 'domain'];
    const profilesToUse = profile === 'all' ? validProfiles : [profile];
    
    // Escape rule name and path for use in netsh command-line arguments
    // Use double-quote escaping for Windows command-line
    const escapeForCmd = (str: string) => str.replace(/"/g, '""');
    const escapedRuleName = escapeForCmd(ruleName);
    const escapedExePath = escapeForCmd(exePath);
    
    // For each profile, create a separate rule (netsh doesn't support 'all' directly)
    // Also handle protocol 'both' by creating separate TCP and UDP rules
    const protocolsToUse = protocol === 'both' ? ['tcp', 'udp'] : [protocol];
    
    const createRule = (prof: string, proto: string, portSuffix: string = '') => {
      const ruleSuffix = profilesToUse.length > 1 || protocolsToUse.length > 1 || portSuffix ? ` (${prof}/${proto}${portSuffix})` : '';
      const fullRuleName = `${ruleName}${ruleSuffix}`;
      
      // Escape rule name and path for netsh (double-quote escaping)
      const escapedRuleNameForNetsh = escapeForCmd(fullRuleName);
      const escapedExePathForNetsh = escapedExePath;
      
      // Build netsh arguments - escape each value properly
      // For values in double quotes (name, program), we already escaped double quotes
      // Create both inbound and outbound rules for full connectivity
      const createRuleForDirection = (direction: 'in' | 'out') => {
        const directionSuffix = direction === 'out' ? ' Out' : '';
        const fullRuleNameWithDir = `${ruleName}${directionSuffix}${ruleSuffix}`;
        const escapedRuleNameForNetsh = escapeForCmd(fullRuleNameWithDir).replace(/'/g, "''");
        
        const netshArgsArray = [
          `'advfirewall'`,
          `'firewall'`,
          `'add'`,
          `'rule'`,
          `'name="${escapedRuleNameForNetsh}"'`,
          `'dir=${direction}'`,
          `'action=allow'`,
          `'program="${escapedExePathForNetsh.replace(/'/g, "''")}"'`,
          `'profile=${prof}'`,
          `'enable=yes'`
        ];
        
        if (port) {
          netshArgsArray.push(`'localport=${port}'`, `'protocol=${proto}'`);
        } else {
          netshArgsArray.push(`'protocol=${proto}'`);
        }
        
        if (scope) {
          netshArgsArray.push(`'remoteip=${scope.replace(/'/g, "''")}'`);
        }
        
        return netshArgsArray;
      };
      
      // Create PowerShell script that elevates and runs netsh for both directions
      // Use encoded command to avoid escaping issues with special characters in paths
      const createPsScript = (netshArgs: string[]) => {
        const psScript = [
          '$netshArgs = @(' + netshArgs.join(',') + ')',
          "$process = Start-Process -FilePath 'netsh' -ArgumentList $netshArgs -Verb RunAs -Wait -PassThru",
          'exit $process.ExitCode'
        ].join('\n');
        
        // Encode PowerShell script as base64 (UTF-16LE encoded) to avoid escaping issues
        const psScriptBytes = Buffer.from(psScript, 'utf16le');
        const psScriptBase64 = psScriptBytes.toString('base64');
        
        return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psScriptBase64}`;
      };
      
      // Get commands for both inbound and outbound
      const netshArgsArrayIn = createRuleForDirection('in');
      const netshArgsArrayOut = createRuleForDirection('out');
      
      // Return commands for both inbound and outbound
      return {
        inbound: createPsScript(netshArgsArrayIn),
        outbound: createPsScript(netshArgsArrayOut)
      };
    };
    
    // Create commands for all profile/protocol combinations (both inbound and outbound)
    const commands: string[] = [];
    for (const prof of profilesToUse) {
      for (const proto of protocolsToUse) {
        const portSuffix = port ? `:${port}` : '';
        const ruleCommands = createRule(prof, proto, portSuffix);
        commands.push(ruleCommands.inbound);
        commands.push(ruleCommands.outbound); // Add outbound rule for peer connections
      }
    }
    
    // Execute all commands sequentially
    let commandIndex = 0;
    const executeNext = () => {
      if (commandIndex >= commands.length) {
        resolve({ success: true });
        return;
      }
      
      exec(commands[commandIndex], { encoding: 'utf8' }, (error, stdout, stderr) => {
        if (error) {
          // If error occurs, check if it's because rule already exists (that's OK)
          const errorMsg = (error.message || stderr || String(stdout || ''));
          const lower = errorMsg.toLowerCase();
          if (lower.includes('already exists') || lower.includes('object already exists')) {
            // Rule exists, continue to next command
            commandIndex++;
            executeNext();
            return;
          }
          // Detect elevation/admin requirement (UAC cancelled, access denied, etc.)
          if (isElevationError(errorMsg)) {
            resolve({ success: false, error: RUN_AS_ADMIN_MSG, needsElevation: true });
            return;
          }
          resolve({ success: false, error: error.message || stderr || 'Unknown error' });
          return;
        }
        
        commandIndex++;
        executeNext();
      });
    };
    
    executeNext();
  });
}

async function removeWindowsFirewallRule(ruleName: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Remove firewall rules (may require elevation if rule was created with elevation)
    // First try without elevation, if it fails try with elevation
    const escapedRuleName = ruleName.replace(/"/g, '""');
    
    // Try to find all rules matching the name pattern (may have multiple for different profiles/protocols)
    const findRulesCommand = `netsh advfirewall firewall show rule name="${escapedRuleName}" verbose | findstr /C:"Rule Name"`;
    
    exec(findRulesCommand, { encoding: 'utf8' }, (findError, findStdout) => {
      // Get all matching rule names
      const ruleNames: string[] = [];
      if (!findError && findStdout) {
        const lines = findStdout.split('\n');
        for (const line of lines) {
          const match = line.match(/Rule Name:\s*(.+)/i);
          if (match && match[1]) {
            const fullRuleName = match[1].trim();
            if (fullRuleName.startsWith(ruleName)) {
              ruleNames.push(fullRuleName);
            }
          }
        }
      }
      
      // If no rules found by pattern, try exact name
      if (ruleNames.length === 0) {
        ruleNames.push(ruleName);
      }
      
      // Create commands to delete all matching rules
      const commands = ruleNames.map(name => {
        const escaped = name.replace(/"/g, '""');
        return `netsh advfirewall firewall delete rule name="${escaped}"`;
      });
      
      // Try deleting without elevation first
      let commandIndex = 0;
      const executeNext = () => {
        if (commandIndex >= commands.length) {
          resolve({ success: true });
          return;
        }
        
        exec(commands[commandIndex], { encoding: 'utf8' }, (error, stdout, stderr) => {
          if (error) {
            // If access denied, try with elevation
            const errorMsg = (error.message || stderr || '').toLowerCase();
            if (errorMsg.includes('access') || errorMsg.includes('denied') || errorMsg.includes('administrator')) {
              // Try with elevation
              const ruleToDelete = ruleNames[commandIndex];
              // Escape for netsh command-line (double-quote escaping)
              const escapedForNetsh = ruleToDelete.replace(/"/g, '""');
              // Escape for PowerShell single-quoted string
              const escapedForPs = escapedForNetsh.replace(/'/g, "''");
              
              const psScript = [
                "$ruleName = '" + escapedForPs.replace(/\$/g, '$$') + "'",
                '$netshArgs = @(\'advfirewall\',\'firewall\',\'delete\',\'rule\',"name=`"$ruleName`"")',
                '$process = Start-Process -FilePath \'netsh\' -ArgumentList $netshArgs -Verb RunAs -Wait -PassThru',
                'exit $process.ExitCode'
              ].join('\n');
              
              const psScriptBytes = Buffer.from(psScript, 'utf16le');
              const psScriptBase64 = psScriptBytes.toString('base64');
              const elevatedCommand = `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${psScriptBase64}`;
              
              exec(elevatedCommand, { encoding: 'utf8' }, (elevError, elevStdout, elevStderr) => {
                if (elevError) {
                  // Ignore "object not found" errors (rule already deleted)
                  const elevErrorMsg = (elevError.message || elevStderr || '').toLowerCase();
                  if (!elevErrorMsg.includes('not found') && !elevErrorMsg.includes('cannot find')) {
                    resolve({ success: false, error: elevError.message || elevStderr || 'Unknown error' });
                    return;
                  }
                }
                commandIndex++;
                executeNext();
              });
              return;
            }
            
            // Ignore "object not found" errors (rule already deleted)
            const errorMsgLower = errorMsg.toLowerCase();
            if (!errorMsgLower.includes('not found') && !errorMsgLower.includes('cannot find')) {
              resolve({ success: false, error: error.message || stderr || 'Unknown error' });
              return;
            }
          }
          
          commandIndex++;
          executeNext();
        });
      };
      
      executeNext();
    });
  });
}

/**
 * Windows Firewall Management (Best Practices Implementation)
 * 
 * Following Windows desktop application best practices for networking apps:
 * 
 * 1. **No automatic prompts on startup** - App runs as standard user by default
 * 2. **Opt-in firewall rules** - Only request firewall rules when user explicitly enables
 *    features requiring inbound connections (e.g., seeding, remote control)
 * 3. **Minimum scope rules** - Rules are scoped to specific executable, specific ports (if provided),
 *    and private profile by default (not public networks)
 * 4. **Detect managed environments** - Gracefully handle Group Policy managed firewalls
 * 5. **Clean separation** - Firewall operations are isolated and only triggered by user action
 * 
 */


// Protocol registration will be done in app.whenReady() to ensure app is fully initialized

// Handle second instance (Windows/Linux) - when app is already running
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running - it will handle the magnet link/torrent file
  // This instance should quit to avoid duplicate windows
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    // Focus existing window
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      } catch (err) {
        console.error("Error focusing window:", err);
      }
    }

    // Extract magnet link from command line
    const magnet = extractMagnetFromArgv(commandLine);
    if (magnet) {
      handleMagnetLink(magnet);
    }

    // Extract torrent file from command line
    for (const arg of commandLine) {
      if (arg && arg.toLowerCase().endsWith(".torrent")) {
        console.log(`[Second Instance] Found torrent file in command line: ${arg}`);
        // Normalize the path using the enhanced normalization function
        const normalizedPath = normalizeTorrentFilePath(arg);
        console.log(`[Second Instance] Normalized path: ${normalizedPath}`);
        if (existsSync(normalizedPath)) {
          handleTorrentFile(normalizedPath);
          break;
        } else {
          console.warn(`[Second Instance] Torrent file not found: ${normalizedPath}`);
          // Show error to user if window is available
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showErrorBox(
              "Torrent File Not Found",
              `The torrent file could not be found:\n\n${normalizedPath}\n\nPlease verify the file exists and try again.`
            );
          }
        }
      }
    }
  });
}

// Handle open-url event (macOS)
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (url && url.startsWith("magnet:?")) {
    handleMagnetLink(url);
  }
});

/**
 * Normalizes a file path to handle Windows edge cases including:
 * - Quoted paths (with spaces)
 * - UNC paths (\\server\share\file.torrent)
 * - Long paths (\\?\ prefix)
 * - Network paths
 * - Relative paths from different working directories
 */
function normalizeTorrentFilePath(filePath: string): string {
  if (!filePath) {
    return filePath;
  }

  let normalized = filePath.trim();
  
  // Strip surrounding quotes if present (Windows quotes paths with spaces)
  if ((normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'"))) {
    normalized = normalized.slice(1, -1);
  }

  // Handle long path prefix (\\?\) - preserve it for Windows
  const isLongPath = normalized.startsWith("\\\\?\\");
  const isUncLongPath = normalized.startsWith("\\\\?\\UNC\\");
  
  if (isUncLongPath) {
    // Convert \\?\UNC\server\share to \\server\share
    normalized = "\\\\" + normalized.substring(8);
  } else if (isLongPath) {
    // Keep \\?\ prefix for long paths
    // path.resolve will handle the rest
  }

  // For UNC paths (\\server\share), path.resolve doesn't work well
  // Check if it's already an absolute UNC path
  if (normalized.startsWith("\\\\") && !normalized.startsWith("\\\\?")) {
    // UNC path - normalize separators but don't resolve
    normalized = normalized.replace(/\//g, "\\");
    return normalized;
  }

  // For regular paths, resolve relative paths and normalize separators
  try {
    normalized = path.resolve(normalized);
  } catch (resolveErr) {
    console.warn(`[Path Normalization] path.resolve failed, using original path: ${resolveErr}`);
    normalized = normalized.replace(/\//g, path.sep);
  }

  return normalized;
}

function checkTorrentFileAssociation(): { isRegistered: boolean; details: string } {
  if (process.platform !== "win32") {
    return { isRegistered: true, details: "File association check only available on Windows" };
  }

  if (!app.isPackaged) {
    return { isRegistered: false, details: "File associations only work in packaged/installed builds" };
  }

  try {
    // On Windows, electron-builder registers file associations during installation
    // We can't directly check the registry without native modules, but we can infer
    // that if the app is packaged and installed, associations should be registered
    // (assuming the installer ran with perMachine: true)
    const execPath = app.getPath("exe");
    const isInstalled = execPath.includes("Program Files") || execPath.includes("AppData");
    
    if (isInstalled) {
      return { 
        isRegistered: true, 
        details: `App appears to be installed at: ${execPath}. File associations should be registered if installed via NSIS installer with perMachine: true.` 
      };
    } else {
      return { 
        isRegistered: false, 
        details: `App is packaged but may not be properly installed. Executable path: ${execPath}. File associations require proper installation.` 
      };
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { 
      isRegistered: false, 
      details: `Could not verify file association status: ${error}` 
    };
  }
}

function handleTorrentFile(filePath: string) {
  if (!filePath || !filePath.toLowerCase().endsWith(".torrent")) {
    console.warn(`[Torrent File] Invalid file path or not a .torrent file: ${filePath}`);
    return;
  }

  try {
    // Normalize the path to handle Windows edge cases
    const normalizedPath = normalizeTorrentFilePath(filePath);
    
    console.log(`[Torrent File] Processing torrent file: ${normalizedPath}`);
    
    // Verify file exists before trying to read
    if (!existsSync(normalizedPath)) {
      const errorMsg = `Torrent file not found: ${normalizedPath}\n\nPossible causes:\n- The file was moved or deleted\n- The path contains invalid characters\n- Network path is unavailable\n- Insufficient permissions to access the file`;
      console.error(`[Torrent File] ${errorMsg}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox("Torrent File Not Found", errorMsg);
      } else {
        // If window doesn't exist yet, show error when window is ready
        dialog.showErrorBox("Torrent File Not Found", errorMsg);
      }
      return;
    }

    // Check file size (max ~7MB for ~10MB base64 encoded)
    try {
      const stats = require("fs").statSync(normalizedPath);
      const fileSizeMB = stats.size / (1024 * 1024);
      if (fileSizeMB > 7) {
        const errorMsg = `Torrent file is too large (${fileSizeMB.toFixed(2)}MB). Maximum size is 7MB.`;
        console.error(`[Torrent File] ${errorMsg}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showErrorBox("Torrent File Error", errorMsg);
        }
        return;
      }
    } catch (statErr) {
      console.warn(`[Torrent File] Could not check file size: ${statErr}`);
    }

    // Read the file and convert to base64
    let fileBuffer: Buffer;
    try {
      fileBuffer = readFileSync(normalizedPath);
    } catch (readErr) {
      const error = readErr instanceof Error ? readErr : new Error(String(readErr));
      const errorCode = (readErr as NodeJS.ErrnoException).code;
      let errorMsg = `Failed to read torrent file: ${error.message}\n\nFile: ${normalizedPath}\n\nPossible causes:\n- File is locked by another program\n- Insufficient permissions\n- File is corrupted or invalid\n- Network path is unavailable`;
      
      // Add specific error code information if available
      if (errorCode) {
        errorMsg += `\n\nError code: ${errorCode}`;
        if (errorCode === "EACCES") {
          errorMsg += "\n\nAccess denied. Please check file permissions.";
        } else if (errorCode === "ENOENT") {
          errorMsg += "\n\nFile not found. The file may have been moved or deleted.";
        } else if (errorCode === "EBUSY" || errorCode === "ELOCKED") {
          errorMsg += "\n\nFile is locked. Please close any programs using this file and try again.";
        }
      }
      
      console.error(`[Torrent File] ${errorMsg}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showErrorBox("Torrent File Read Error", errorMsg);
      } else {
        // Show error even if window doesn't exist yet
        dialog.showErrorBox("Torrent File Read Error", errorMsg);
      }
      return;
    }
    
    const base64 = fileBuffer.toString("base64");
    const fileName = path.basename(normalizedPath);

    console.log(`[Torrent File] Successfully read file: ${fileName} (${(fileBuffer.length / 1024).toFixed(2)}KB)`);

    const data = { base64, fileName };

    // Send to renderer
    const sendToRenderer = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          // Check if webContents is ready (not loading)
          if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            // Check if webContents is actually loaded (not just created)
            const url = mainWindow.webContents.getURL();
            if (url && url !== "about:blank") {
              mainWindow.webContents.send("open-torrent-file", data);
              console.log(`[Torrent File] Sent torrent file to renderer: ${fileName}`);
              return true;
            } else {
              console.log(`[Torrent File] WebContents not ready yet (URL: ${url}), will retry...`);
            }
          }
        } catch (err) {
          console.error("[Torrent File] Failed to send torrent file to renderer:", err);
        }
      }
      return false;
    };

    // Try to send immediately
    if (!sendToRenderer()) {
      // If send failed, store for later
      pendingTorrentFile = JSON.stringify(data);
      console.log(`[Torrent File] Stored torrent file for later: ${fileName}`);
      
      // Retry multiple times with increasing delays
      // Clear any existing retry interval first
      if (torrentFileRetryInterval) {
        clearInterval(torrentFileRetryInterval);
        torrentFileRetryInterval = null;
      }

      let retryCount = 0;
      const maxRetries = 10;
      torrentFileRetryInterval = setInterval(() => {
        retryCount++;
        if (sendToRenderer()) {
          pendingTorrentFile = null;
          if (torrentFileRetryInterval) {
            clearInterval(torrentFileRetryInterval);
            torrentFileRetryInterval = null;
          }
          console.log(`[Torrent File] Successfully sent torrent file after ${retryCount} retries`);
        } else if (retryCount >= maxRetries) {
          if (torrentFileRetryInterval) {
            clearInterval(torrentFileRetryInterval);
            torrentFileRetryInterval = null;
          }
          console.error(`[Torrent File] Failed to send torrent file after ${maxRetries} retries`);
          // Show error to user if window is available
          if (mainWindow && !mainWindow.isDestroyed()) {
            dialog.showErrorBox(
              "Torrent File Import Error",
              `Failed to import torrent file: ${fileName}\n\nThe application window may not be ready. Please try:\n\n1. Importing the file again from within the application (File > Open Torrent)\n2. Restarting the application and trying again\n3. Checking if the file is corrupted or invalid`
            );
          }
        }
      }, 500);
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    let errorMsg = `Failed to process torrent file:\n\n${error.message}`;
    
    // Add helpful context based on error type
    if (error.message.includes("ENOENT") || error.message.includes("not found")) {
      errorMsg += "\n\nThe file may have been moved, deleted, or the path is incorrect.";
    } else if (error.message.includes("EACCES") || error.message.includes("permission")) {
      errorMsg += "\n\nAccess denied. Please check file permissions and ensure you have read access.";
    } else if (error.message.includes("network") || error.message.includes("ECONNREFUSED")) {
      errorMsg += "\n\nNetwork path may be unavailable. Please check your network connection.";
    } else {
      errorMsg += `\n\nTechnical details:\n${error.stack || ""}`;
    }
    
    console.error(`[Torrent File] ${errorMsg}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox("Torrent File Processing Error", errorMsg);
    } else {
      // Show error even if window doesn't exist yet
      dialog.showErrorBox("Torrent File Processing Error", errorMsg);
    }
  }
}

// Handle open-file event (primarily macOS; Windows/Linux typically use command line args)
// On Windows, this can also fire when files are opened while app is running
app.on("open-file", (event, filePath) => {
  event.preventDefault();
  console.log(`[Open File Event] Received file: ${filePath}`);
  if (filePath && filePath.toLowerCase().endsWith(".torrent")) {
    handleTorrentFile(filePath);
  } else {
    console.warn(`[Open File Event] Received non-torrent file: ${filePath}`);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (e) => {
  // Mark that we're shutting down to prevent restarts
  isShuttingDown = true;
  isRestarting = false; // Clear restart flag on shutdown
  
  // Notify renderer about shutdown so it can show shutdown overlay
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send("app:shutting-down");
      // Give renderer a moment to show the overlay
      setTimeout(() => {
        continueShutdown(e);
      }, 100);
    } catch (err) {
      console.error("Failed to send shutdown notification:", err);
      continueShutdown(e);
    }
  } else {
    continueShutdown(e);
  }
});

function continueShutdown(e: Electron.Event) {
  // Cancel any pending restart
  if (daemonRestartTimeout) {
    clearTimeout(daemonRestartTimeout);
    daemonRestartTimeout = null;
  }
  
  // Stop daemon health check
  if (daemonHealthCheckInterval) {
    clearInterval(daemonHealthCheckInterval);
    daemonHealthCheckInterval = null;
  }

  // Clean up log file watchers
  cleanupLogWatchers();

  // Clean up torrent file retry interval
  if (torrentFileRetryInterval) {
    clearInterval(torrentFileRetryInterval);
    torrentFileRetryInterval = null;
  }

  // Close splash window if still open
  closeSplashWindow();
  
  if (daemonSpawnedByApp) {
    e.preventDefault();
    gracefulShutdownIfOwned()
      .catch((err) => {
        console.error("Error during graceful shutdown:", err);
      })
      .finally(() => {
        // Force close main window after cleanup
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.close();
        }
        app.exit(0);
      });
  }
}

app.whenReady().then(async () => {
  try {
    protocol.handle("app", (request) => {
      const url = request.url;
      if (url === "app://notification-sound" || url.startsWith("app://notification-sound?")) {
        const userData = app.getPath("userData");
        const metaPath = path.join(userData, NOTIFICATION_SOUND_META);
        if (!existsSync(metaPath)) {
          return new Response("", { status: 404 });
        }
        try {
          const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { type?: string; ext?: string; filename?: string };
          if (meta.type === "default") {
            return new Response("", { status: 404 });
          }
          const ext = meta.ext ?? ".wav";
          const soundPath = path.join(userData, NOTIFICATION_SOUND_BASENAME + ext);
          if (!existsSync(soundPath)) {
            return new Response("", { status: 404 });
          }
          const buf = readFileSync(soundPath);
          const mime = ext === ".mp3" ? "audio/mpeg" : ext === ".ogg" ? "audio/ogg" : ext === ".m4a" ? "audio/mp4" : "audio/wav";
          return new Response(buf, { headers: { "Content-Type": mime } });
        } catch {
          return new Response("", { status: 404 });
        }
      }
      if (url.startsWith("app://default-notification-sounds/")) {
        try {
          const filename = decodeURIComponent(url.slice("app://default-notification-sounds/".length).replace(/\?.*$/, ""));
          if (!filename || filename.includes("..") || path.isAbsolute(filename)) {
            return new Response("", { status: 404 });
          }
          const dir = getDefaultNotificationSoundsDir();
          const soundPath = path.join(dir, path.basename(filename));
          if (!existsSync(soundPath) || path.extname(soundPath).toLowerCase() !== ".mp3") {
            return new Response("", { status: 404 });
          }
          const buf = readFileSync(soundPath);
          return new Response(buf, { headers: { "Content-Type": "audio/mpeg" } });
        } catch {
          return new Response("", { status: 404 });
        }
      }
      return new Response("", { status: 404 });
    });

    ipcMain.handle("get-icon-path", async () => getIconPath() ?? null);

    ipcMain.handle("dialog:choose-save-folder", async (): Promise<string | null> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!win || win.isDestroyed()) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ["openDirectory"],
        title: "Choose folder for torrent (save / seed from existing files)",
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0] ?? null;
    });

    // Notification sound: choose file (copied to userData), get URL for renderer, or clear
    ipcMain.handle("notification-sound:choose", async (): Promise<boolean> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
      if (!win || win.isDestroyed()) return false;
      const result = await dialog.showOpenDialog(win, {
        properties: ["openFile"],
        title: "Choose notification sound",
        filters: [
          { name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a", "aac"] },
          { name: "All", extensions: ["*"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return false;
      const src = result.filePaths[0];
      const ext = path.extname(src).toLowerCase() || ".wav";
      const userData = app.getPath("userData");
      const dest = path.join(userData, NOTIFICATION_SOUND_BASENAME + ext);
      const metaPath = path.join(userData, NOTIFICATION_SOUND_META);
      try {
        copyFileSync(src, dest);
        writeFileSync(metaPath, JSON.stringify({ type: "custom", ext }));
        return true;
      } catch (err) {
        console.error("Failed to save notification sound:", err);
        return false;
      }
    });

    ipcMain.handle("notification-sound:set-default", async (_event, filename: string): Promise<boolean> => {
      if (typeof filename !== "string" || !filename.trim() || filename.includes("..")) return false;
      const base = path.basename(filename);
      if (path.extname(base).toLowerCase() !== ".mp3") return false;
      const dir = getDefaultNotificationSoundsDir();
      const soundPath = path.join(dir, base);
      if (!existsSync(soundPath)) return false;
      const userData = app.getPath("userData");
      const metaPath = path.join(userData, NOTIFICATION_SOUND_META);
      try {
        writeFileSync(metaPath, JSON.stringify({ type: "default", filename: base }));
        return true;
      } catch (err) {
        console.error("Failed to set default notification sound:", err);
        return false;
      }
    });

    ipcMain.handle("notification-sound:get-defaults", async (): Promise<string[]> => {
      try {
        const dir = getDefaultNotificationSoundsDir();
        if (!existsSync(dir)) return [];
        const files = readdirSync(dir, { withFileTypes: true });
        return files
          .filter((f) => f.isFile() && path.extname(f.name).toLowerCase() === ".mp3")
          .map((f) => f.name)
          .sort();
      } catch {
        return [];
      }
    });

    ipcMain.handle("notification-sound:get-url", async (): Promise<string | null> => {
      const userData = app.getPath("userData");
      const metaPath = path.join(userData, NOTIFICATION_SOUND_META);
      if (!existsSync(metaPath)) return null;
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { type?: string; ext?: string; filename?: string };
        if (meta.type === "default" && meta.filename) {
          const dir = getDefaultNotificationSoundsDir();
          const soundPath = path.join(dir, path.basename(meta.filename));
          return existsSync(soundPath) ? "app://default-notification-sounds/" + encodeURIComponent(meta.filename) : null;
        }
        const ext = meta.ext ?? ".wav";
        const soundPath = path.join(userData, NOTIFICATION_SOUND_BASENAME + ext);
        return existsSync(soundPath) ? "app://notification-sound" : null;
      } catch {
        return null;
      }
    });

    ipcMain.handle("notification-sound:clear", async (): Promise<void> => {
      const userData = app.getPath("userData");
      const metaPath = path.join(userData, NOTIFICATION_SOUND_META);
      const exts = [".wav", ".mp3", ".ogg", ".m4a", ".aac"];
      try {
        for (const ext of exts) {
          const p = path.join(userData, NOTIFICATION_SOUND_BASENAME + ext);
          if (existsSync(p)) unlinkSync(p);
        }
        if (existsSync(metaPath)) unlinkSync(metaPath);
      } catch (err) {
        console.error("Failed to clear notification sound:", err);
      }
    });

    ipcMain.handle("netifs", async () => {
      const ifs = os.networkInterfaces();
      return Object.keys(ifs).filter((k) => (ifs[k] ?? []).length > 0);
    });

    ipcMain.handle("vpn-status", async (): Promise<VpnStatus> => {
      return detectVpn();
    });

    // Daemon log file access
    ipcMain.handle("daemon:log-path", async (): Promise<string | null> => {
      return currentDaemonLogPath;
    });

    ipcMain.handle("daemon:open-log", async (): Promise<{ success: boolean; error?: string }> => {
      if (!currentDaemonLogPath) {
        return { success: false, error: "Log file path not available" };
      }
      try {
        // Open the folder containing the log file and select the file
        shell.showItemInFolder(currentDaemonLogPath);
        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, error };
      }
    });

    // Port hygiene - manual cleanup trigger
    ipcMain.handle("daemon:cleanup-port", async (): Promise<{ success: boolean; cleaned: boolean; pid?: number; error?: string }> => {
      try {
        console.log("[IPC] Manual port cleanup requested");
        const result = await cleanupStaleProcessesOnPort();
        return { success: true, ...result };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, cleaned: false, error };
      }
    });

    // Daemon control handlers
    ipcMain.handle("daemon:start", async (): Promise<{ success: boolean; error?: string }> => {
      try {
        if (isRestarting) {
          return { success: false, error: "Daemon is already starting or restarting" };
        }
        if (daemonProc && daemonSpawnedByApp) {
          // Check if process is actually running
          const isHealthy = await isDaemonHealthy();
          if (isHealthy) {
            return { success: true };
          }
        }
        const started = await startDaemonIfNeeded();
        if (started) {
          return { success: true };
        } else {
          return { success: false, error: "Failed to start daemon" };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, error };
      }
    });

    ipcMain.handle("daemon:stop", async (): Promise<{ success: boolean; error?: string }> => {
      try {
        if (!daemonSpawnedByApp) {
          return { success: false, error: "Daemon was not started by this application" };
        }
        await gracefulShutdownIfOwned();
        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, error };
      }
    });

    ipcMain.handle("daemon:restart", async (): Promise<{ success: boolean; error?: string }> => {
      try {
        if (isRestarting) {
          return { success: false, error: "Daemon is already restarting" };
        }
        if (daemonSpawnedByApp && daemonProc) {
          await gracefulShutdownIfOwned();
          // Wait a bit for shutdown to complete
          await new Promise((r) => setTimeout(r, 1000));
        }
        const started = await startDaemonIfNeeded();
        if (started) {
          return { success: true };
        } else {
          return { success: false, error: "Failed to restart daemon" };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, error };
      }
    });

    ipcMain.handle("daemon:status", async (): Promise<{ status: string; pid?: number }> => {
      try {
        if (isRestarting) {
          return { status: "starting" };
        }
        if (daemonProc && daemonSpawnedByApp) {
          const exitCode = (daemonProc as any).exitCode;
          if (exitCode !== null) {
            return { status: "stopped" };
          }
          const isHealthy = await isDaemonHealthy();
          if (isHealthy) {
            return { status: "running", pid: daemonProc.pid || undefined };
          } else {
            return { status: "starting" };
          }
        } else {
          // Check if daemon is running externally
          const isHealthy = await isDaemonHealthy();
          if (isHealthy) {
            return { status: "running" };
          } else {
            return { status: "stopped" };
          }
        }
      } catch (err) {
        return { status: "unknown" };
      }
    });

    // Log file reading and watching (uses module-scope Maps for cleanup)
    ipcMain.handle("daemon:read-logs", async (_event, lines: number = 100): Promise<string[]> => {
      try {
        if (!currentDaemonLogPath || !existsSync(currentDaemonLogPath)) {
          return [];
        }
        const content = readFileSync(currentDaemonLogPath, "utf-8");
        const allLines = content.split("\n").filter((line) => line.trim().length > 0);
        // Return last N lines
        return allLines.slice(-lines);
      } catch (err) {
        console.error("Failed to read logs:", err);
        return [];
      }
    });

    // Watch log file and send updates via IPC events
    ipcMain.handle("daemon:watch-logs", (event): { success: boolean; error?: string } => {
      try {
        if (!currentDaemonLogPath) {
          return { success: false, error: "Log file path not available" };
        }

        const callbackId = event.sender.id.toString();
        
        // Create callback function
        const callback = (line: string) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send("daemon:log-line", line);
          }
        };

        // Add to callbacks set
        if (!logWatchCallbacks.has(callbackId)) {
          logWatchCallbacks.set(callbackId, new Set());
        }
        logWatchCallbacks.get(callbackId)!.add(callback);

        // Set up file watcher if not already watching this path
        if (!logWatchers.has(currentDaemonLogPath)) {
          let lastSize = 0;
          try {
            if (existsSync(currentDaemonLogPath)) {
              const stats = statSync(currentDaemonLogPath);
              lastSize = stats.size;
            }
          } catch {}

          const watchedPath = currentDaemonLogPath; // Capture for closure
          logWatchers.set(watchedPath, { lastSize });

          watchFile(watchedPath, { interval: 500 }, (curr, prev) => {
            // Check if file still exists
            if (!existsSync(watchedPath)) {
              return;
            }

            const watcherState = logWatchers.get(watchedPath);
            if (!watcherState) return;

            if (curr.size > prev.size) {
              // File grew, read new content
              try {
                const content = readFileSync(watchedPath, "utf-8");
                const newContent = content.slice(watcherState.lastSize);
                watcherState.lastSize = curr.size;
                
                // Split into lines and send each new line
                const newLines = newContent.split("\n").filter((line) => line.trim().length > 0);
                newLines.forEach((line) => {
                  // Send to all registered callbacks
                  logWatchCallbacks.forEach((callbacks) => {
                    callbacks.forEach((cb) => {
                      try {
                        cb(line);
                      } catch (err) {
                        console.error("Error in log callback:", err);
                      }
                    });
                  });
                });
              } catch (err) {
                console.error("Error reading new log content:", err);
              }
            } else if (curr.size < prev.size) {
              // File was truncated or recreated
              watcherState.lastSize = 0;
            }
          });
        }

        // Clean up when renderer is destroyed
        event.sender.once("destroyed", () => {
          const callbacks = logWatchCallbacks.get(callbackId);
          if (callbacks) {
            callbacks.delete(callback);
            if (callbacks.size === 0) {
              logWatchCallbacks.delete(callbackId);
            }
          }
        });

        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { success: false, error };
      }
    });

    // Register protocol handler for Windows/Linux (must be done after app is ready)
    if (process.platform !== "darwin") {
      try {
        const isDefault = app.isDefaultProtocolClient("magnet");
        if (!isDefault) {
          const registered = app.setAsDefaultProtocolClient("magnet");
          if (registered) {
            console.log("[Protocol] Successfully registered as default magnet protocol handler");
          } else {
            console.warn("[Protocol] Failed to register as default magnet protocol handler - magnet links may not open from OS");
          }
        } else {
          console.log("[Protocol] Already registered as default magnet protocol handler");
        }
      } catch (err) {
        console.error("[Protocol] Error during magnet protocol registration:", err);
        // Continue - app can still work without OS-level protocol handler
      }
    }

    // Check torrent file association status on Windows (for debugging and user feedback)
    if (process.platform === "win32") {
      const associationStatus = checkTorrentFileAssociation();
      console.log(`[File Association] Status: ${associationStatus.isRegistered ? "Registered" : "Not Registered"}`);
      console.log(`[File Association] Details: ${associationStatus.details}`);
      
      // In development mode, warn that file associations won't work
      if (!app.isPackaged) {
        console.warn("[File Association] Running in development mode - file associations only work in packaged/installed builds");
      }
    }

    // Show splash screen first
    console.log(`[Startup] Showing splash screen...`);
    createSplashWindow();
    
    // Start daemon and create window in parallel for faster startup
    console.log(`[Startup] Starting daemon (isDev: ${isDev}, isPackaged: ${app.isPackaged})...`);
    console.log(`[Startup] process.resourcesPath: ${process.resourcesPath || "undefined"}`);
    console.log(`[Startup] process.execPath: ${process.execPath}`);
    
    // Create window immediately (hidden) so it can load in background
    createWindow();
    
    // Start daemon in background (don't block window creation)
    startDaemonIfNeeded().then(() => {
      console.log(`[Startup] Daemon startup completed`);
    }).catch((err) => {
      console.error(`[Startup] Daemon startup failed:`, err);
    });


    // This is a safety check - daemon should already be started above
    if (!await isDaemonHealthy()) {
      console.warn("Daemon not healthy when window ready, attempting to start...");
      await startDaemonIfNeeded();
    }

    // Start periodic health check to ensure daemon stays running while GUI is open
    // Start continuous health monitoring with self-healing
    let consecutiveHealthFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3; // Restart after 3 consecutive failures
    
    daemonHealthCheckInterval = setInterval(async () => {
      if (isShuttingDown) {
        if (daemonHealthCheckInterval) {
          clearInterval(daemonHealthCheckInterval);
          daemonHealthCheckInterval = null;
        }
        return;
      }
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        const isHealthy = await isDaemonHealthy();
        
        if (isHealthy) {
          // Reset failure counter on success
          if (consecutiveHealthFailures > 0) {
            console.log(`[HEALTH CHECK] Daemon recovered after ${consecutiveHealthFailures} failures`);
            consecutiveHealthFailures = 0;
          }
        } else {
          consecutiveHealthFailures++;
          console.warn(`[HEALTH CHECK] Daemon health check failed (${consecutiveHealthFailures}/${MAX_CONSECUTIVE_FAILURES})`);
          
          // Check if process is still alive (if we spawned it)
          let processDead = false;
          if (daemonSpawnedByApp && daemonProc) {
            try {
              if (process.platform === "win32") {
                // On Windows, check exit code and also verify process still exists
                const exitCode = (daemonProc as any).exitCode;
                if (exitCode !== null && exitCode !== undefined) {
                  console.warn(`[HEALTH CHECK] Daemon process has exited (code: ${exitCode})`);
                  processDead = true;
                } else {
                  // Exit code is null, but verify process actually exists using tasklist
                  // This handles zombie processes that haven't reported exit yet
                  if (daemonProc.pid) {
                    try {
                      const result = execSync(`tasklist /FI "PID eq ${daemonProc.pid}" /NH`, { 
                        encoding: 'utf8', 
                        timeout: 2000,
                        maxBuffer: 1024 * 1024 // 1MB buffer
                      });
                      const resultLower = result.toLowerCase();
                      const pidStr = daemonProc.pid.toString();
                      // Check if process exists and is orc-daemon
                      if (!resultLower.includes("orc-daemon") && !resultLower.includes(pidStr)) {
                        console.warn(`[HEALTH CHECK] Process ${daemonProc.pid} not found in tasklist, treating as dead`);
                        processDead = true;
                      }
                    } catch (tasklistErr) {
                      // If tasklist fails (command not found, timeout, etc.), log but don't assume dead
                      // This could be a transient issue, so let consecutive failures handle it
                      const errMsg = tasklistErr instanceof Error ? tasklistErr.message : String(tasklistErr);
                      if (!errMsg.includes("not found") && !errMsg.includes("ENOENT")) {
                        console.warn(`[HEALTH CHECK] Could not verify process existence via tasklist: ${errMsg}`);
                      }
                    }
                  }
                }
              } else {
                // On Unix, try to send signal 0 to check if process exists
                try {
                  if (daemonProc.pid) {
                    process.kill(daemonProc.pid, 0);
                  } else {
                    console.warn(`[HEALTH CHECK] Process PID is null, treating as dead`);
                    processDead = true;
                  }
                } catch (killErr) {
                  console.warn(`[HEALTH CHECK] Daemon process appears to be dead: ${killErr}`);
                  processDead = true;
                }
              }
            } catch (err) {
              // If we can't determine process state, be conservative and assume it might be dead
              console.warn(`[HEALTH CHECK] Error checking process state: ${err}`);
              // Don't set processDead = true here - let consecutive failures handle it
            }
          } else if (daemonSpawnedByApp && !daemonProc) {
            // Process reference is null but we spawned it - process is definitely dead
            console.warn(`[HEALTH CHECK] Process reference is null but we spawned it - process is dead`);
            processDead = true;
          }
          
          // If process is dead or we've had too many failures, restart
          if (processDead || consecutiveHealthFailures >= MAX_CONSECUTIVE_FAILURES) {
            if (processDead) {
              console.warn(`[HEALTH CHECK] Daemon process is dead, forcing restart...`);
              // Clear process reference to allow restart
              daemonProc = null;
              daemonSpawnedByApp = false;
            } else {
              console.warn(`[HEALTH CHECK] Daemon unresponsive after ${consecutiveHealthFailures} failures, restarting...`);
            }
            
            // Only restart if we're not already in a restart attempt and cooldown has passed
            const timeSinceLastRestart = Date.now() - lastRestartTime;
            if (!isRestarting && !daemonRestartTimeout && daemonSpawnedByApp === false) {
              if (timeSinceLastRestart < MIN_RESTART_COOLDOWN_MS) {
                const remainingCooldown = MIN_RESTART_COOLDOWN_MS - timeSinceLastRestart;
                console.warn(`[HEALTH CHECK] Restart cooldown active (${timeSinceLastRestart}ms < ${MIN_RESTART_COOLDOWN_MS}ms). Waiting ${remainingCooldown}ms more before restart...`);
                return; // Skip restart this cycle, will retry on next health check
              }
              
              // Clear any pending restart timeout since health check is triggering restart
              if (daemonRestartTimeout) {
                clearTimeout(daemonRestartTimeout);
                daemonRestartTimeout = null;
              }
              
              // Force cleanup of stale process if needed
              try {
                await cleanupStaleProcessesOnPort();
                // Reset failure counter before restart attempt
                consecutiveHealthFailures = 0;
                lastRestartTime = Date.now();
                const restarted = await startDaemonIfNeeded();
                
                if (restarted) {
                  // Wait a bit and check if restart was successful
                  setTimeout(async () => {
                    const healthy = await isDaemonHealthy();
                    if (healthy) {
                      console.log(`[HEALTH CHECK] Daemon restarted successfully`);
                    } else {
                      console.warn(`[HEALTH CHECK] Daemon restart may have failed`);
                    }
                  }, 2000);
                }
              } catch (restartErr) {
                console.error(`[HEALTH CHECK] Error during restart attempt:`, restartErr);
                // Reset isRestarting flag on error - startDaemonIfNeeded should have reset it, but be safe
                isRestarting = false;
              }
            } else if (isRestarting || daemonRestartTimeout) {
              // Already restarting or has pending restart, skip
              console.log(`[HEALTH CHECK] Restart already in progress, skipping duplicate restart`);
            }
          }
        }
      } else {
        // Window closed, stop health checking
        if (daemonHealthCheckInterval) {
          clearInterval(daemonHealthCheckInterval);
          daemonHealthCheckInterval = null;
        }
      }
    }, DAEMON_HEALTH_CHECK_INTERVAL_MS);

    // Handle magnet link or torrent file from command line when app first starts
    if (process.platform !== "darwin") {
      const magnet = extractMagnetFromArgv(process.argv);
      if (magnet) {
        // Small delay to ensure window is ready
        setTimeout(() => handleMagnetLink(magnet), 500);
      }
      // Check for .torrent file in command line arguments
      console.log(`[Startup] Checking command line arguments for torrent files...`);
      console.log(`[Startup] process.argv:`, process.argv);
      for (const arg of process.argv) {
        if (arg && arg.toLowerCase().endsWith(".torrent")) {
          console.log(`[Startup] Found torrent file in argv: ${arg}`);
          // Normalize the path using the enhanced normalization function
          const normalizedPath = normalizeTorrentFilePath(arg);
          console.log(`[Startup] Normalized path: ${normalizedPath}`);
          if (existsSync(normalizedPath)) {
            console.log(`[Startup] Torrent file exists, will open after window is ready`);
            // Wait for window to be ready before handling the file
            const tryOpenFile = () => {
              if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
                const url = mainWindow.webContents.getURL();
                if (url && url !== "about:blank") {
                  handleTorrentFile(normalizedPath);
                } else {
                  // Window not ready yet, try again in 200ms
                  setTimeout(tryOpenFile, 200);
                }
              } else {
                // Window not created yet, try again in 200ms
                setTimeout(tryOpenFile, 200);
              }
            };
            setTimeout(tryOpenFile, 500);
            break;
          } else {
            console.warn(`[Startup] Torrent file not found: ${normalizedPath}`);
            // The error will be shown by handleTorrentFile if it's called
          }
        }
      }
    }
  } catch (error) {
    console.error("Error during app initialization:", error);
    const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
    dialog.showErrorBox(
      "Initialization Error",
      `Failed to initialize the application:\n\n${errorMessage}`
    );
    app.exit(1);
  }
}).catch((error) => {
  console.error("Failed to ready app:", error);
  const errorMessage = error instanceof Error ? error.stack || error.message : String(error);
  dialog.showErrorBox(
    "Startup Error",
    `Failed to start the application:\n\n${errorMessage}`
  );
  app.exit(1);
});
