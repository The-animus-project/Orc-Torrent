/// <reference types="vite/client" />

declare global {
  interface Window {
    orc?: {
      platform: string;
      netifs?: () => Promise<string[]>;
      vpnStatus?: () => Promise<{ detected: boolean; interfaceName: string | null }>;
      onMagnetLink?: (callback: (magnetUrl: string) => void) => (() => void) | void;
      onTorrentFile?: (callback: (data: { base64: string; fileName: string }) => void) => (() => void) | void;
      onShuttingDown?: (callback: () => void) => (() => void) | void;
      daemon?: {
        getLogPath: () => Promise<string | null>;
        openLog: () => Promise<{ success: boolean; error?: string }>;
        start: () => Promise<{ success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean; error?: string }>;
        restart: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ status: string; pid?: number }>;
        readLogs: (lines?: number) => Promise<string[]>;
        watchLogs: (callback: (line: string) => void) => () => void;
      };
      theme?: {
        getSnapshot: () => { source: "auto" | "light" | "dark"; resolved: "light" | "dark" };
        get: () => Promise<{ source: "auto" | "light" | "dark"; resolved: "light" | "dark" }>;
        set: (
          source: "auto" | "light" | "dark"
        ) => Promise<{ source: "auto" | "light" | "dark"; resolved: "light" | "dark" }>;
        onChange: (
          callback: (state: { source: "auto" | "light" | "dark"; resolved: "light" | "dark" }) => void
        ) => () => void;
      };
      /** Choose folder for torrent save path (e.g. add for seeding from existing files). Returns path or null if canceled. */
      showSaveFolderDialog?: () => Promise<string | null>;
      openExternalUrl?: (url: string) => Promise<boolean>;
      signalRendererReady?: () => void;
      onWindowVisibility?: (
        callback: (state: { focused: boolean; minimized: boolean; visible: boolean }) => void
      ) => (() => void) | void;
      /** App icon filesystem path for notifications. */
      iconPath?: () => Promise<string | null>;
      notificationSound?: {
        getDefaults: () => Promise<string[]>;
        setDefault: (filename: string) => Promise<boolean>;
        chooseFile: () => Promise<boolean>;
        getUrl: () => Promise<string | null>;
        getPreference: () => Promise<{ type: "builtin" } | { type: "default"; filename: string } | { type: "custom" }>;
        clear: () => Promise<void>;
        getAudio: (
          payload: { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" }
        ) => Promise<{ buffer: Uint8Array; mime: string } | null>;
      };
      updater?: {
        getStatus: () => Promise<import("../shared/updaterTypes").UpdateStatus>;
        check: () => Promise<import("../shared/updaterTypes").UpdateStatus>;
        setAutoCheck: (enabled: boolean) => Promise<import("../shared/updaterTypes").UpdateStatus>;
        install: () => Promise<{ success: boolean; error?: string }>;
        onStatusChanged: (callback: (status: import("../shared/updaterTypes").UpdateStatus) => void) => () => void;
      };
      edition?: {
        getBranding: () => Promise<import("../shared/appEdition").EditionBranding>;
      };
    };
  }
}
export {};
