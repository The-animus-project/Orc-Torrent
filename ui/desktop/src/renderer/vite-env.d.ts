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
      firewall?: {
        check: () => Promise<{ exists: boolean; managed: boolean; ruleName: string; error?: string; checkAccessDenied?: boolean }>;
        checkManaged: () => Promise<boolean>;
        addRule: (options?: { port?: number; protocol?: 'tcp' | 'udp' | 'both'; profile?: 'private' | 'public' | 'domain' | 'all'; scope?: string }) => Promise<{ success: boolean; error?: string; managed?: boolean; needsElevation?: boolean }>;
        removeRule: () => Promise<{ success: boolean; error?: string }>;
      };
      daemon?: {
        getLogPath: () => Promise<string | null>;
        openLog: () => Promise<{ success: boolean; error?: string }>;
        start: () => Promise<{ success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean; error?: string }>;
        restart: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{ status: string; pid?: number }>;
        readLogs: (lines?: number) => Promise<string[]>;
        watchLogs: (callback: (line: string) => void) => (() => void);
      };
      /** Choose folder for torrent save path (e.g. add for seeding from existing files). Returns path or null if canceled. */
      showSaveFolderDialog?: () => Promise<string | null>;
      /** App icon filesystem path for notifications. */
      iconPath?: () => Promise<string | null>;
      notificationSound?: {
        getDefaults: () => Promise<string[]>;
        setDefault: (filename: string) => Promise<boolean>;
        chooseFile: () => Promise<boolean>;
        getUrl: () => Promise<string | null>;
        clear: () => Promise<void>;
      };
    };
  }
}
export {};
