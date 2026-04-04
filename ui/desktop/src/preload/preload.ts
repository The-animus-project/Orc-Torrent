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
  notificationSound: {
    getDefaults: () => ipcRenderer.invoke("notification-sound:get-defaults") as Promise<string[]>,
    setDefault: (filename: string) => ipcRenderer.invoke("notification-sound:set-default", filename) as Promise<boolean>,
    chooseFile: () => ipcRenderer.invoke("notification-sound:choose") as Promise<boolean>,
    getUrl: () => ipcRenderer.invoke("notification-sound:get-url") as Promise<string | null>,
    clear: () => ipcRenderer.invoke("notification-sound:clear") as Promise<void>,
    getAudio: (
      payload: { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" }
    ) =>
      ipcRenderer.invoke("notification-sound:get-audio", payload) as Promise<
        { buffer: Uint8Array; mime: string } | null
      >,
  },
});
