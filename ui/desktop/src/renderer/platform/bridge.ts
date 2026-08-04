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
  ): Promise<{ remove(): Promise<void> }>;
};

function androidPlugin(): AndroidPlugin | null {
  return window.Capacitor?.Plugins?.OrcAndroid ?? null;
}

const noop = () => {};

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
    let handle: { remove(): Promise<void> } | null = null;
    void plugin
      .addListener("appStateChange", ({ active }) => callback(active === true))
      .then((value) => (handle = value));
    return () => void handle?.remove();
  },
  onMagnetLink(callback) {
    const plugin = androidPlugin();
    if (!plugin) return noop;
    let handle: { remove(): Promise<void> } | null = null;
    void plugin.addListener("magnetLink", ({ uri }) => uri && callback(uri)).then((value) => (handle = value));
    return () => void handle?.remove();
  },
  onTorrentFile(callback) {
    const plugin = androidPlugin();
    if (!plugin) return noop;
    let handle: { remove(): Promise<void> } | null = null;
    void plugin
      .addListener("torrentFile", ({ name, base64 }) => {
        if (name && base64) callback({ name, base64 });
      })
      .then((value) => (handle = value));
    return () => void handle?.remove();
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
