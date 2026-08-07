export interface AndroidBootstrap {
  baseUrl: string;
  storageReady: boolean;
  storageLabel: string | null;
  allowCellular: boolean;
  killSwitchEnabled: boolean;
  vpnActive: boolean;
}

export interface PickedTorrentFile {
  name: string;
  base64: string;
}

export interface TransferPolicy {
  allowCellular: boolean;
  killSwitchEnabled: boolean;
}

export interface PlatformBridge {
  readonly platform: "desktop" | "android" | "web";
  bootstrap(): Promise<AndroidBootstrap | null>;
  chooseDownloadTree(): Promise<{ granted: boolean; label: string | null }>;
  pickTorrentFile(): Promise<PickedTorrentFile | null>;
  openDownloadedFile(torrentId: string, fileIndex: number): Promise<boolean>;
  shareDownloadedFile(torrentId: string, fileIndex: number): Promise<boolean>;
  setTransferPolicy(policy: TransferPolicy): Promise<void>;
  pauseAll(): Promise<void>;
  onAppStateChange(callback: (active: boolean) => void): () => void;
  onMagnetLink(callback: (uri: string) => void): () => void;
  onTorrentFile(callback: (file: PickedTorrentFile) => void): () => void;
}

export type PluginListenerHandle = {
  remove(): Promise<void>;
};

export type AndroidPlugin = {
  bootstrap(): Promise<AndroidBootstrap>;
  apiRequest(options: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    body?: string;
  }): Promise<{ status: number; statusText: string; headers: Record<string, string>; body: string }>;
  chooseDownloadTree(): Promise<{ granted: boolean; label: string | null }>;
  pickTorrentFile(): Promise<PickedTorrentFile | null>;
  openDownloadedFile(options: { torrentId: string; fileIndex: number }): Promise<{ opened: boolean }>;
  shareDownloadedFile(options: { torrentId: string; fileIndex: number }): Promise<{ shared: boolean }>;
  setTransferPolicy(policy: TransferPolicy): Promise<void>;
  pauseAll(): Promise<void>;
  addListener(
    event: "magnetLink" | "torrentFile" | "appStateChange",
    callback: (payload: { uri?: string; name?: string; base64?: string; active?: boolean }) => void
  ): PluginListenerHandle | Promise<PluginListenerHandle>;
};

function androidPlugin(): AndroidPlugin | null {
  return window.Capacitor?.Plugins?.OrcAndroid ?? null;
}

const noop = () => {};

function isThenable<T>(value: T | PromiseLike<T>): value is PromiseLike<T> {
  return typeof (value as PromiseLike<T>)?.then === "function";
}

/** Capacitor's injected Plugins.*.addListener returns a sync handle; registerPlugin returns a Promise. */
export function attachAndroidListener(
  plugin: Pick<AndroidPlugin, "addListener">,
  event: "magnetLink" | "torrentFile" | "appStateChange",
  callback: (payload: { uri?: string; name?: string; base64?: string; active?: boolean }) => void
): () => void {
  let handle: PluginListenerHandle | null = null;
  const result = plugin.addListener(event, callback);
  // Injected Capacitor stubs return { remove } sync. registerPlugin may return a Promise
  // that also exposes .remove, or a plain Promise of the handle.
  if (typeof (result as PluginListenerHandle)?.remove === "function") {
    handle = result as PluginListenerHandle;
  } else if (isThenable(result)) {
    void Promise.resolve(result).then((value) => {
      handle = value;
    });
  }
  return () => void handle?.remove();
}

const androidBridge: PlatformBridge = {
  platform: "android",
  async bootstrap() {
    const plugin = androidPlugin();
    if (!plugin) throw new Error("ORC Android native plugin is unavailable");
    return plugin.bootstrap();
  },
  async chooseDownloadTree() {
    const plugin = androidPlugin();
    if (!plugin) throw new Error("ORC Android native plugin is unavailable");
    return plugin.chooseDownloadTree();
  },
  async pickTorrentFile() {
    const plugin = androidPlugin();
    if (!plugin) throw new Error("ORC Android native plugin is unavailable");
    return plugin.pickTorrentFile();
  },
  async openDownloadedFile(torrentId, fileIndex) {
    const plugin = androidPlugin();
    return plugin ? (await plugin.openDownloadedFile({ torrentId, fileIndex })).opened : false;
  },
  async shareDownloadedFile(torrentId, fileIndex) {
    const plugin = androidPlugin();
    return plugin ? (await plugin.shareDownloadedFile({ torrentId, fileIndex })).shared : false;
  },
  async setTransferPolicy(policy) {
    const plugin = androidPlugin();
    if (!plugin) throw new Error("ORC Android native plugin is unavailable");
    await plugin.setTransferPolicy(policy);
  },
  async pauseAll() {
    const plugin = androidPlugin();
    if (!plugin) throw new Error("ORC Android native plugin is unavailable");
    await plugin.pauseAll();
  },
  onAppStateChange(callback) {
    const plugin = androidPlugin();
    if (!plugin) return noop;
    return attachAndroidListener(plugin, "appStateChange", ({ active }) => callback(active === true));
  },
  onMagnetLink(callback) {
    const plugin = androidPlugin();
    if (!plugin) return noop;
    return attachAndroidListener(plugin, "magnetLink", ({ uri }) => {
      if (uri) callback(uri);
    });
  },
  onTorrentFile(callback) {
    const plugin = androidPlugin();
    if (!plugin) return noop;
    return attachAndroidListener(plugin, "torrentFile", ({ name, base64 }) => {
      if (name && base64) callback({ name, base64 });
    });
  },
};

const desktopBridge: PlatformBridge = {
  platform: "desktop",
  async bootstrap() {
    return null;
  },
  async chooseDownloadTree() {
    const path = await window.orc?.showSaveFolderDialog?.();
    return { granted: Boolean(path), label: path ?? null };
  },
  async pickTorrentFile() {
    return null;
  },
  async openDownloadedFile() {
    return false;
  },
  async shareDownloadedFile() {
    return false;
  },
  async setTransferPolicy() {},
  async pauseAll() {},
  onAppStateChange(callback) {
    return window.orc?.onWindowVisibility?.(({ visible }) => callback(visible)) || noop;
  },
  onMagnetLink(callback) {
    return window.orc?.onMagnetLink?.(callback) || noop;
  },
  onTorrentFile(callback) {
    return window.orc?.onTorrentFile?.(({ fileName, base64 }) => callback({ name: fileName, base64 })) || noop;
  },
};

const webBridge: PlatformBridge = {
  ...desktopBridge,
  platform: "web",
  onAppStateChange(callback) {
    const listener = () => callback(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", listener);
    return () => document.removeEventListener("visibilitychange", listener);
  },
  onMagnetLink: () => noop,
  onTorrentFile: () => noop,
};

export function getPlatformBridge(): PlatformBridge {
  if (window.Capacitor?.getPlatform?.() === "android") return androidBridge;
  if (window.orc) return desktopBridge;
  return webBridge;
}
