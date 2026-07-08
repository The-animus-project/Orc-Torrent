import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("orc", {
  netifs: () => ipcRenderer.invoke("netifs"),
  vpnStatus: () => ipcRenderer.invoke("vpn-status"),
  iconPath: () => ipcRenderer.invoke("get-icon-path"),
  platform: process.platform,
  onMagnetLink: (callback: (magnetUrl: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, magnetUrl: string) => {
      callback(magnetUrl);
    };
    ipcRenderer.on("magnet-link", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("magnet-link", handler);
    };
  },
  onTorrentFile: (callback: (data: { base64: string; fileName: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { base64: string; fileName: string }) => {
      callback(data);
    };
    ipcRenderer.on("open-torrent-file", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("open-torrent-file", handler);
    };
  },
  // Daemon log access and control
  daemon: {
    getLogPath: () => ipcRenderer.invoke("daemon:log-path"),
    openLog: () => ipcRenderer.invoke("daemon:open-log"),
    start: () => ipcRenderer.invoke("daemon:start"),
    stop: () => ipcRenderer.invoke("daemon:stop"),
    restart: () => ipcRenderer.invoke("daemon:restart"),
    getStatus: () => ipcRenderer.invoke("daemon:status"),
    readLogs: (lines?: number) => ipcRenderer.invoke("daemon:read-logs", lines),
    watchLogs: (callback: (line: string) => void) => {
      // Set up log watching
      ipcRenderer.invoke("daemon:watch-logs");

      // Listen for new log lines
      const handler = (_event: Electron.IpcRendererEvent, line: string) => {
        callback(line);
      };
      ipcRenderer.on("daemon:log-line", handler);

      // Return cleanup function
      return () => {
        ipcRenderer.removeListener("daemon:log-line", handler);
      };
    },
  },
  theme: {
    getSnapshot: () =>
      ipcRenderer.sendSync("app-theme:get-sync") as { source: "auto" | "light" | "dark"; resolved: "light" | "dark" },
    get: () =>
      ipcRenderer.invoke("app-theme:get") as Promise<{ source: "auto" | "light" | "dark"; resolved: "light" | "dark" }>,
    set: (source: "auto" | "light" | "dark") =>
      ipcRenderer.invoke("app-theme:set", source) as Promise<{
        source: "auto" | "light" | "dark";
        resolved: "light" | "dark";
      }>,
    onChange: (callback: (state: { source: "auto" | "light" | "dark"; resolved: "light" | "dark" }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: { source: "auto" | "light" | "dark"; resolved: "light" | "dark" }
      ) => {
        callback(state);
      };
      ipcRenderer.on("app-theme:changed", handler);
      return () => {
        ipcRenderer.removeListener("app-theme:changed", handler);
      };
    },
  },
  onWindowVisibility: (callback: (state: { focused: boolean; minimized: boolean; visible: boolean }) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: { focused: boolean; minimized: boolean; visible: boolean }
    ) => {
      callback(state);
    };
    ipcRenderer.on("window:visibility", handler);
    return () => {
      ipcRenderer.removeListener("window:visibility", handler);
    };
  },
  // App lifecycle events
  onShuttingDown: (callback: () => void) => {
    const handler = () => {
      callback();
    };
    ipcRenderer.on("app:shutting-down", handler);
    // Return cleanup function
    return () => {
      ipcRenderer.removeListener("app:shutting-down", handler);
    };
  },
  // Folder picker for choosing save path when adding torrents (add for seeding from existing folder)
  showSaveFolderDialog: () => ipcRenderer.invoke("dialog:choose-save-folder") as Promise<string | null>,
  openExternalUrl: (url: string) => ipcRenderer.invoke("shell:open-external", url) as Promise<boolean>,
  signalRendererReady: () => ipcRenderer.send("renderer:ready"),
  notificationSound: {
    getDefaults: () => ipcRenderer.invoke("notification-sound:get-defaults") as Promise<string[]>,
    setDefault: (filename: string) =>
      ipcRenderer.invoke("notification-sound:set-default", filename) as Promise<boolean>,
    chooseFile: () => ipcRenderer.invoke("notification-sound:choose") as Promise<boolean>,
    getUrl: () => ipcRenderer.invoke("notification-sound:get-url") as Promise<string | null>,
    getPreference: () =>
      ipcRenderer.invoke("notification-sound:get-preference") as Promise<
        { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" }
      >,
    clear: () => ipcRenderer.invoke("notification-sound:clear") as Promise<void>,
    getAudio: (payload: { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" }) =>
      ipcRenderer.invoke("notification-sound:get-audio", payload) as Promise<{
        buffer: Uint8Array;
        mime: string;
      } | null>,
  },
  updater: {
    getStatus: () => ipcRenderer.invoke("updater:get-status"),
    check: () => ipcRenderer.invoke("updater:check"),
    setAutoCheck: (enabled: boolean) => ipcRenderer.invoke("updater:set-auto-check", enabled),
    install: () => ipcRenderer.invoke("updater:install"),
    onStatusChanged: (callback: (status: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: unknown) => {
        callback(status);
      };
      ipcRenderer.on("updater:status-changed", handler);
      return () => {
        ipcRenderer.removeListener("updater:status-changed", handler);
      };
    },
  },
  edition: {
    getBranding: () => ipcRenderer.invoke("edition:get-branding"),
  },
});
