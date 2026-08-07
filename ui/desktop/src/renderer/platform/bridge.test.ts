import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachAndroidListener,
  getPlatformBridge,
  type AndroidPlugin,
  type PluginListenerHandle,
} from "./bridge";

/** Mirrors Capacitor Android JSExport: addListener returns a sync { remove } handle. */
function createSyncCapacitorPlugin(): {
  plugin: AndroidPlugin;
  remove: ReturnType<typeof vi.fn>;
  listeners: Map<string, (payload: Record<string, unknown>) => void>;
} {
  const listeners = new Map<string, (payload: Record<string, unknown>) => void>();
  const remove = vi.fn().mockResolvedValue(undefined);
  const plugin = {
    bootstrap: vi.fn(),
    apiRequest: vi.fn(),
    chooseDownloadTree: vi.fn(),
    pickTorrentFile: vi.fn(),
    openDownloadedFile: vi.fn(),
    shareDownloadedFile: vi.fn(),
    setTransferPolicy: vi.fn(),
    pauseAll: vi.fn(),
    addListener(event: string, callback: (payload: Record<string, unknown>) => void): PluginListenerHandle {
      listeners.set(event, callback);
      return { remove };
    },
  } as unknown as AndroidPlugin;
  return { plugin, remove, listeners };
}

describe("attachAndroidListener", () => {
  it("tolerates Capacitor's sync addListener handle (the #22 crash)", () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn().mockReturnValue({ remove });
    const plugin = { addListener } as Pick<AndroidPlugin, "addListener">;
    const callback = vi.fn();

    // Old code did: plugin.addListener(...).then(...) which throws TypeError.
    expect(() => {
      const raw = plugin.addListener("appStateChange", callback);
      expect(typeof (raw as { then?: unknown }).then).not.toBe("function");
    }).not.toThrow();

    const unsubscribe = attachAndroidListener(plugin, "appStateChange", callback);
    expect(addListener).toHaveBeenCalledWith("appStateChange", callback);
    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("also accepts Promise-returning addListener (registerPlugin style)", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const addListener = vi.fn().mockResolvedValue({ remove });
    const plugin = { addListener } as Pick<AndroidPlugin, "addListener">;

    const unsubscribe = attachAndroidListener(plugin, "magnetLink", vi.fn());
    await Promise.resolve();
    unsubscribe();
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe("android bridge onAppStateChange (issue #22 regression)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers appStateChange without TypeError when Capacitor returns a sync handle", () => {
    const { plugin, remove, listeners } = createSyncCapacitorPlugin();
    vi.stubGlobal("window", {
      Capacitor: {
        getPlatform: () => "android",
        Plugins: { OrcAndroid: plugin },
      },
    });

    const bridge = getPlatformBridge();
    expect(bridge.platform).toBe("android");

    const onActive = vi.fn();
    let unsubscribe: (() => void) | undefined;
    expect(() => {
      unsubscribe = bridge.onAppStateChange(onActive);
    }).not.toThrow();

    listeners.get("appStateChange")?.({ active: true });
    expect(onActive).toHaveBeenCalledWith(true);

    listeners.get("appStateChange")?.({ active: false });
    expect(onActive).toHaveBeenCalledWith(false);

    unsubscribe?.();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("registers magnet and torrent listeners with sync Capacitor handles", () => {
    const { plugin, remove, listeners } = createSyncCapacitorPlugin();
    vi.stubGlobal("window", {
      Capacitor: {
        getPlatform: () => "android",
        Plugins: { OrcAndroid: plugin },
      },
    });

    const bridge = getPlatformBridge();
    const onMagnet = vi.fn();
    const onTorrent = vi.fn();

    expect(() => {
      bridge.onMagnetLink(onMagnet);
      bridge.onTorrentFile(onTorrent);
    }).not.toThrow();

    listeners.get("magnetLink")?.({ uri: "magnet:?xt=urn:btih:abc" });
    expect(onMagnet).toHaveBeenCalledWith("magnet:?xt=urn:btih:abc");

    listeners.get("torrentFile")?.({ name: "x.torrent", base64: "YmFzZTY0" });
    expect(onTorrent).toHaveBeenCalledWith({ name: "x.torrent", base64: "YmFzZTY0" });
    expect(remove).not.toHaveBeenCalled();
  });
});
