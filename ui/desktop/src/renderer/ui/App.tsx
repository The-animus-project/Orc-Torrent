/// <reference types="../vite-env.d.ts" />
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./styles.css";
import "./themes/animus-graffiti.css";
import {
  Toast,
  ActionToast,
  StatusToast,
  ErrorBoundary,
  Modal,
  AddTorrent,
  FileSelectionDialog,
  BootGate,
  Spinner,
  DropZone,
  KawaiiHeartRing,
  AnarchyEmblemRing,
  SearchPage,
  SearchSettingsPanel,
  type DaemonHealthState,
} from "../components";
import { AppShell, MainLayout, StatusBar, type StatusFilter, type SmartView } from "./layout";
import { AnimusShell, type AnimusPageId } from "./layout/AnimusShell";
import { TorrentPortfolio } from "../components/torrents";
import { TorrentInspector } from "../components/inspector";
import { NetworkPostureCenter } from "../components/network";
import { AnimusDashboardPage } from "../components/AnimusDashboardPage";
import {
  PrivacyKillSwitchDrawer,
  NetworkPage,
  EventsPage,
  SecuritySettings,
  EngineSettings,
  DaemonControl,
  NotificationSoundSettings,
  UpdateSettings,
  PrivacyStatusCard,
  WatchFoldersSettings,
  SeedingSettingsPanel,
  BandwidthSettingsPanel,
} from "../components";
import type {
  Torrent,
  TorrentStatus,
  WalletStatus,
  OverlayStatus,
  NetPosture,
  Health,
  Version,
  Toast as ToastType,
  ActionToastNotification,
  StatusToastNotification,
  VpnStatus,
  KillSwitchConfig,
  TorrentEvent,
  SearchFeatureSettings,
  PrivacyStatus,
  BandwidthProfile,
} from "../types";
import { getJson, postJson } from "../utils/api";
import { addMagnetToDaemon } from "../utils/torrentImport";
import { getSearchSettings } from "../utils/searchApi";
import { useDaemonHealth, useTorrentData, usePrivacyStatus, useTorrentEvents, usePollingController } from "../hooks";
import { loadPersistedNotificationSound } from "../utils/notifications";
import { useKeyboardShortcuts, type KeyboardShortcut } from "../utils/keyboard";
import { getErrorMessage, isApiError } from "../utils/errorHandling";
import { infoHashFromTorrentBytes } from "../lib/infoHash";
import { logger } from "../utils/logger";
import { fmtBytesPerSec } from "../utils/format";
import { createEvent, addEvent } from "../utils/eventService";
import {
  NOTIFICATION_VISUAL_THEME_REGISTRY,
  NOTIFICATION_VISUAL_THEME_STORAGE_KEY,
  getNotificationVisualThemePreviewMessage,
  isNotificationVisualTheme,
  readNotificationVisualTheme,
  usesAnarchyEmblemRing,
  usesKawaiiHeartRing,
  writeNotificationVisualTheme,
  type NotificationVisualTheme,
} from "../../shared/notificationVisualThemeRegistry";
import {
  isAppThemeMode,
  type AppThemeMode,
  type AppThemeState,
  type ResolvedAppTheme,
} from "../../shared/appThemeRegistry";

const SESSION_RATE_LIMITS_STORAGE_KEY = "orc-session-rate-limits";
const BYTES_PER_KILOBYTE = 1024;
const OFFICIAL_WEBSITE_URL = "https://orclabs.io";

type StoredSessionRateLimits = {
  enabled: boolean;
  downloadKBps: string;
  uploadKBps: string;
};

function readStoredSessionRateLimits(): StoredSessionRateLimits {
  if (typeof window === "undefined") {
    return { enabled: false, downloadKBps: "", uploadKBps: "" };
  }

  try {
    const raw = window.localStorage.getItem(SESSION_RATE_LIMITS_STORAGE_KEY);
    if (!raw) {
      return { enabled: false, downloadKBps: "", uploadKBps: "" };
    }

    const parsed = JSON.parse(raw) as Partial<StoredSessionRateLimits>;
    return {
      enabled: Boolean(parsed.enabled),
      downloadKBps: typeof parsed.downloadKBps === "string" ? parsed.downloadKBps : "",
      uploadKBps: typeof parsed.uploadKBps === "string" ? parsed.uploadKBps : "",
    };
  } catch {
    return { enabled: false, downloadKBps: "", uploadKBps: "" };
  }
}

function toRateLimitBps(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.min(Math.round(parsed * BYTES_PER_KILOBYTE), 4_294_967_295);
}

function getFallbackResolvedTheme(): ResolvedAppTheme {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function getInitialAppThemeState(): AppThemeState {
  try {
    const snapshot = window.orc?.theme?.getSnapshot?.();
    if (
      snapshot &&
      isAppThemeMode(snapshot.source) &&
      (snapshot.resolved === "light" || snapshot.resolved === "dark")
    ) {
      return snapshot;
    }
  } catch {
    // Ignore and fall back to system preference.
  }

  return {
    source: "auto",
    resolved: getFallbackResolvedTheme(),
  };
}

export default function App() {
  const initialSessionRateLimits = readStoredSessionRateLimits();
  const initialAppThemeState = getInitialAppThemeState();
  const [mounted, setMounted] = useState(false);
  const [daemonLogPath, setDaemonLogPath] = useState<string | null>(null);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [toast, setToast] = useState<ToastType | null>(null);
  const [actionToast, setActionToast] = useState<ActionToastNotification | null>(null);
  const [statusToast, setStatusToast] = useState<StatusToastNotification | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusToastPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [netifs, setNetifs] = useState<string[]>([]);
  const [editionBranding, setEditionBranding] = useState({
    badgeLabel: "",
    tagline: "Private torrent client",
    accentColor: "",
    logoUrl: "./images/orctorrent-logo.png",
    sidebarLogoUrl: "",
    sidebarArtworkUrl: "",
    sidebarEmblemUrl: "",
    brandMarkUrl: "",
    surfaceWatermarkUrl: "",
    splashBackgroundUrl: "",
    splashLogoUrl: "",
    themeId: "standard",
    edition: "standard",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadsSearchQuery, setDownloadsSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [downloadsFilter, setDownloadsFilter] = useState<"all" | "downloading" | "seeding" | "completed" | "error">(
    "all"
  );
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [showAddTorrentModal, setShowAddTorrentModal] = useState(false);
  const [showKillSwitchDrawer, setShowKillSwitchDrawer] = useState(false);
  const [showFileSelectionDialog, setShowFileSelectionDialog] = useState(false);
  const [showFileFoundModal, setShowFileFoundModal] = useState(false);
  const [fileFoundTorrentId, setFileFoundTorrentId] = useState<string | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [appThemeSource, setAppThemeSource] = useState<AppThemeMode>(initialAppThemeState.source);
  const [resolvedAppTheme, setResolvedAppTheme] = useState<ResolvedAppTheme>(initialAppThemeState.resolved);
  const [notificationVisualTheme, setNotificationVisualTheme] = useState<NotificationVisualTheme>(() =>
    readNotificationVisualTheme()
  );
  const [pendingTorrentId, setPendingTorrentId] = useState<string | null>(null);
  const [pendingTorrentName, setPendingTorrentName] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<AnimusPageId>("torrents");
  const [settingsTab, setSettingsTab] = useState<
    | "general"
    | "downloads"
    | "watch"
    | "seeding"
    | "bandwidth"
    | "search"
    | "privacy"
    | "network"
    | "interface"
    | "advanced"
  >("general");
  const [privacyStatus, setPrivacyStatus] = useState<PrivacyStatus | null>(null);
  const [bandwidthProfile, setBandwidthProfile] = useState<BandwidthProfile>("normal");
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState(initialSessionRateLimits.enabled);
  const [downloadLimitInput, setDownloadLimitInput] = useState(initialSessionRateLimits.downloadKBps);
  const [uploadLimitInput, setUploadLimitInput] = useState(initialSessionRateLimits.uploadKBps);
  const [isApplyingSpeedLimits, setIsApplyingSpeedLimits] = useState(false);
  const [loadingOperations, setLoadingOperations] = useState<Set<string>>(new Set());
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const pendingDialogOpenRef = useRef<string | null>(null);
  const dialogOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { intervals } = usePollingController();
  const { events, pushEvent, clearEvents, processStatusUpdates } = useTorrentEvents();

  const pushToast = useCallback((kind: "error" | "info", msg: string) => {
    setToast({ kind, msg });
    // Toast.tsx owns the dismiss lifecycle (animation + onClose callback).
    // We only use a timer here as a safety net in case the Toast component
    // unmounts before it can fire onClose (e.g. page navigation).
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 5000);
  }, []);

  const handleOpenOfficialWebsite = useCallback(async () => {
    try {
      const opened = await window.orc?.openExternalUrl?.(OFFICIAL_WEBSITE_URL);
      if (!opened) {
        pushToast("error", "Could not open Orclabs.io in your browser");
      }
    } catch {
      pushToast("error", "Could not open Orclabs.io in your browser");
    }
  }, [pushToast]);

  const pushActionToast = useCallback(
    (kind: "error" | "info", msg: string, actionLabel: string, onAction: () => void | Promise<void>) => {
      setActionToast({ kind, msg, actionLabel, onAction });
    },
    []
  );

  const pushStatusToast = useCallback((phase: "loading" | "success" | "error", msg: string, detail?: string) => {
    setStatusToast({ phase, msg, detail });
  }, []);

  const handleNotificationVisualThemeChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    const nextTheme: NotificationVisualTheme = isNotificationVisualTheme(value) ? value : "electric";
    setNotificationVisualTheme(nextTheme);
    writeNotificationVisualTheme(nextTheme);
  }, []);

  const handleAppThemeSourceChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (editionBranding.edition === "animus") {
        pushToast("info", "AnimUS Edition uses a fixed dark shell.");
        return;
      }

      const value = e.target.value;
      const nextSource: AppThemeMode = isAppThemeMode(value) ? value : "auto";

      try {
        if (window.orc?.theme?.set) {
          const nextState = await window.orc.theme.set(nextSource);
          setAppThemeSource(nextState.source);
          setResolvedAppTheme(nextState.resolved);
        } else {
          setAppThemeSource(nextSource);
          setResolvedAppTheme(
            nextSource === "dark" ? "dark" : nextSource === "light" ? "light" : getFallbackResolvedTheme()
          );
        }
        pushToast("info", `App theme set to ${nextSource}.`);
      } catch (err) {
        pushToast("error", getErrorMessage(err, "Failed to update app theme"));
      }
    },
    [editionBranding.edition, pushToast]
  );

  const handleNotificationThemePreview = useCallback(() => {
    pushToast("info", getNotificationVisualThemePreviewMessage(notificationVisualTheme));
  }, [pushToast, notificationVisualTheme]);

  const handleActionNotificationPreview = useCallback(() => {
    pushActionToast("info", "Action preview: This popup can trigger a follow-up operation.", "Run Action", () =>
      pushToast("info", "Action executed from notification.")
    );
  }, [pushActionToast, pushToast]);

  const handleStatusNotificationPreview = useCallback(() => {
    if (statusToastPreviewTimer.current) {
      clearTimeout(statusToastPreviewTimer.current);
      statusToastPreviewTimer.current = null;
    }
    pushStatusToast("loading", "Checking torrent files", "Verifying file map and integrity...");
    statusToastPreviewTimer.current = setTimeout(() => {
      pushStatusToast("success", "Verification complete", "All selected files are ready to download.");
      statusToastPreviewTimer.current = null;
    }, 1400);
  }, [pushStatusToast]);

  const handleNotificationSettingsError = useCallback(
    (msg: string) => {
      pushToast("error", msg);
    },
    [pushToast]
  );

  const handleNotificationSettingsSuccess = useCallback(
    (msg: string) => {
      pushToast("info", msg);
    },
    [pushToast]
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SESSION_RATE_LIMITS_STORAGE_KEY,
        JSON.stringify({
          enabled: speedLimitEnabled,
          downloadKBps: downloadLimitInput,
          uploadKBps: uploadLimitInput,
        } satisfies StoredSessionRateLimits)
      );
    } catch {
      // Ignore local persistence failures for optional desktop-only preferences.
    }
  }, [speedLimitEnabled, downloadLimitInput, uploadLimitInput]);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
      if (statusToastPreviewTimer.current) {
        clearTimeout(statusToastPreviewTimer.current);
        statusToastPreviewTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window.orc?.edition?.getBranding !== "function") {
      return;
    }
    void window.orc.edition.getBranding().then((branding) => {
      setEditionBranding({
        badgeLabel: branding.badgeLabel ?? "",
        tagline: branding.tagline ?? "Private torrent client",
        accentColor: branding.accentColor ?? "",
        logoUrl: branding.logoUrl ?? "./images/orctorrent-logo.png",
        sidebarLogoUrl: branding.sidebarLogoUrl ?? branding.logoUrl ?? "./images/orctorrent-logo.png",
        sidebarArtworkUrl: branding.sidebarArtworkUrl ?? "",
        sidebarEmblemUrl: branding.sidebarEmblemUrl ?? "",
        brandMarkUrl: branding.brandMarkUrl ?? "",
        surfaceWatermarkUrl: branding.surfaceWatermarkUrl ?? "./images/animus/corner-watermark.png",
        splashBackgroundUrl: branding.splashBackgroundUrl ?? "",
        splashLogoUrl: branding.splashLogoUrl ?? "",
        themeId: branding.themeId ?? "standard",
        edition: branding.edition ?? "standard",
      });
      if (branding.accentColor) {
        document.documentElement.style.setProperty("--edition-accent", branding.accentColor);
      }
      if (branding.edition === "animus") {
        document.documentElement.dataset.appEdition = "animus";
        if (document.body) {
          document.body.dataset.appEdition = "animus";
        }
        setCurrentPage((current) => (current === "torrents" ? "dashboard" : current));
      } else {
        delete document.documentElement.dataset.appEdition;
        if (document.body) {
          delete document.body.dataset.appEdition;
        }
      }
    });
  }, []);

  const isAnimusEdition = editionBranding.edition === "animus";
  const landingPage: AnimusPageId = isAnimusEdition ? "dashboard" : "torrents";

  const setNetPostureRef = useRef<(np: NetPosture) => void>(() => {});
  const setVpnStatusRef = useRef<(vpn: VpnStatus) => void>(() => {});
  const setKillSwitchRef = useRef<(ks: KillSwitchConfig) => void>(() => {});

  const { ping, online, health, version } = useDaemonHealth();

  const {
    torrents,
    torrentStatuses,
    status,
    wallet,
    overlay,
    searchSettings,
    refreshAll,
    refreshStatus,
    refreshSearchSettings,
    setSearchSettings,
  } = useTorrentData({
    online,
    ping,
    intervals,
    pushToast,
    processStatusUpdates,
    selectedTorrentId: selectedIds.size === 1 ? Array.from(selectedIds)[0] : null,
    onNetPosture: (np) => setNetPostureRef.current(np),
    onVpnFromPosture: (vpn) => setVpnStatusRef.current(vpn),
    onKillSwitchFromPosture: (ks) => setKillSwitchRef.current(ks),
  });

  const selectedTorrent = useMemo(() => {
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      return torrents.find((t) => t.id === id) ?? null;
    }
    return null;
  }, [torrents, selectedIds]);

  const { netPosture, vpnStatus, killSwitch, setNetPosture, setVpnStatus, setKillSwitch, refreshVpnStatus } =
    usePrivacyStatus({
      online,
      intervals,
      pushToast,
      pushEvent,
      torrents,
      torrentStatuses,
      refreshAll,
    });

  setNetPostureRef.current = setNetPosture;
  setVpnStatusRef.current = setVpnStatus;
  setKillSwitchRef.current = setKillSwitch;

  const daemonHealthDetails = useMemo(() => {
    if (!online) {
      return "Daemon offline - Connecting...";
    }
    const errorCount = Array.from(torrentStatuses.values()).filter((s) => s.state === "error").length;
    if (errorCount > 0) {
      return `${errorCount} torrent(s) with errors - Click for details`;
    }
    const uptime = health?.uptime_sec ? Math.floor(health.uptime_sec / 60) : 0;
    return `Daemon healthy - Uptime: ${uptime} minutes, ${torrents.length} torrent(s)`;
  }, [online, torrentStatuses, health, torrents.length]);

  const daemonHealthState = useMemo((): DaemonHealthState => {
    if (!online) return "offline";
    const hasErrors = Array.from(torrentStatuses.values()).some((s) => s.state === "error");
    return hasErrors ? "error" : "healthy";
  }, [online, torrentStatuses]);

  const hasConfiguredSpeedLimits = useMemo(
    () => toRateLimitBps(downloadLimitInput) !== null || toRateLimitBps(uploadLimitInput) !== null,
    [downloadLimitInput, uploadLimitInput]
  );

  const applySessionSpeedLimits = useCallback(
    async (nextEnabled: boolean) => {
      const downloadBps = nextEnabled ? toRateLimitBps(downloadLimitInput) : null;
      const uploadBps = nextEnabled ? toRateLimitBps(uploadLimitInput) : null;
      const invalidDownload = downloadLimitInput.trim() !== "" && downloadBps === null;
      const invalidUpload = uploadLimitInput.trim() !== "" && uploadBps === null;

      if (invalidDownload || invalidUpload) {
        pushToast("error", "Use positive numbers for upload and download limits.");
        return false;
      }

      if (nextEnabled && downloadBps === null && uploadBps === null) {
        pushToast("info", "Add an upload or download limit before turning speed limits on.");
        return false;
      }

      setIsApplyingSpeedLimits(true);
      try {
        await postJson("/torrents/limits", {
          download_bps: downloadBps,
          upload_bps: uploadBps,
        });

        const appliedEnabled = nextEnabled && (downloadBps !== null || uploadBps !== null);
        setSpeedLimitEnabled(appliedEnabled);
        pushToast(
          "info",
          appliedEnabled
            ? `Speed limits applied${downloadBps !== null || uploadBps !== null ? "." : ""}`
            : "Speed limits turned off."
        );
        return true;
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to update speed limits"));
        return false;
      } finally {
        setIsApplyingSpeedLimits(false);
      }
    },
    [downloadLimitInput, uploadLimitInput, pushToast]
  );

  const handleSpeedLimitToggle = useCallback(async () => {
    const nextEnabled = !speedLimitEnabled;
    if (nextEnabled && !hasConfiguredSpeedLimits) {
      setSettingsTab("downloads");
      setCurrentPage("settings");
      pushToast("info", "Set an upload or download limit first, then enable it.");
      return;
    }

    await applySessionSpeedLimits(nextEnabled);
  }, [applySessionSpeedLimits, hasConfiguredSpeedLimits, pushToast, speedLimitEnabled]);

  const handleTorrentSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleTorrentAdded = useCallback(
    async (id: string, showFileDialog: boolean = false, torrentName?: string) => {
      setSelectedIds(new Set([id]));
      // Generate torrent added event
      pushEvent(
        createEvent("torrent_added", "info", "Torrent added to client", {
          torrentId: id,
          torrentName: torrentName || "Unknown",
        })
      );
      // Don't await refreshAll() - do it in background to avoid blocking UI
      refreshAll().catch((err) => logger.errorWithPrefix("App", "Failed to refresh torrents:", err));
      refreshStatus(id);

      // For .torrent files, files are available immediately, so show file selection dialog
      if (showFileDialog) {
        // Prevent duplicate dialog opens for the same torrent
        if (pendingDialogOpenRef.current === id || pendingTorrentId === id) {
          return;
        }

        // Clear any existing timeout
        if (dialogOpenTimeoutRef.current) {
          clearTimeout(dialogOpenTimeoutRef.current);
          dialogOpenTimeoutRef.current = null;
        }

        pendingDialogOpenRef.current = id;

        // Use a shorter delay and proper async handling
        dialogOpenTimeoutRef.current = setTimeout(async () => {
          try {
            const [torrent, status] = await Promise.all([
              getJson<Torrent>(`/torrents/${id}`),
              getJson<TorrentStatus>(`/torrents/${id}/status`).catch(() => null),
            ]);
            // Only open dialog if this is still the pending torrent (prevent race conditions)
            if (pendingDialogOpenRef.current !== id) {
              dialogOpenTimeoutRef.current = null;
              return;
            }
            const alreadyPresent =
              status && (status.state === "downloading" || status.state === "seeding") && status.downloaded_bytes > 0;
            if (alreadyPresent) {
              setFileFoundTorrentId(id);
              setShowFileFoundModal(true);
              pendingDialogOpenRef.current = null;
            } else {
              setPendingTorrentId(id);
              setPendingTorrentName(torrent?.name || "New Torrent");
              setShowFileSelectionDialog(true);
              pendingDialogOpenRef.current = null;
            }
          } catch (e) {
            if (pendingDialogOpenRef.current === id) {
              setPendingTorrentId(id);
              setPendingTorrentName("New Torrent");
              setShowFileSelectionDialog(true);
              pendingDialogOpenRef.current = null;
            }
          } finally {
            dialogOpenTimeoutRef.current = null;
          }
        }, 100); // Reduced from 300ms to 100ms for faster response
      }
    },
    [refreshAll, refreshStatus, pendingTorrentId, pushEvent]
  );

  const addMagnetLink = useCallback(
    async (magnetUrl: string) => {
      if (!online) {
        pushToast("error", "Cannot add torrent: daemon not connected");
        return;
      }
      try {
        // Use longer timeout for magnet links (30 seconds) as daemon may need to fetch metadata
        const res = await addMagnetToDaemon(magnetUrl);
        if (!res?.id) {
          pushToast("error", "Daemon rejected torrent add request");
          return;
        }
        handleTorrentAdded(res.id);
        pushToast(
          "info",
          "Torrent added from magnet link. File selection will be available after metadata is fetched."
        );
        // For magnet links, don't show file selection dialog immediately (files not available yet)
        // User can select files later once metadata is fetched
      } catch (e: unknown) {
        const errorMessage = getErrorMessage(e, "Failed to add torrent from magnet link");
        pushToast("error", errorMessage);
        pushActionToast("error", "Magnet add failed. Retry with the same link?", "Retry", () =>
          addMagnetLink(magnetUrl)
        );
      }
    },
    [online, handleTorrentAdded, pushToast, pushActionToast]
  );

  // Handle dropped torrent file
  const handleDroppedFile = useCallback(
    async (file: File) => {
      if (!online) {
        pushToast("error", "Cannot add torrent: daemon not connected");
        return;
      }

      if (!file.name.endsWith(".torrent")) {
        pushToast("error", "Invalid file type. Please drop a .torrent file.");
        return;
      }

      try {
        // Read file as bytes for hash check
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);

        // Check for duplicates by info hash (use fresh list)
        const hash = await infoHashFromTorrentBytes(bytes);
        if (hash) {
          const listRes = await getJson<{ items: Torrent[] }>("/torrents");
          const existing = listRes.items.find((t) => t.info_hash_hex?.toLowerCase() === hash.toLowerCase());
          if (existing) {
            setSelectedIds(new Set([existing.id]));
            setFileFoundTorrentId(existing.id);
            setShowFileFoundModal(true);
            pushToast("info", "Already added — showing existing torrent");
            return;
          }
        }

        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.slice(i, i + chunk));
        }
        const b64 = btoa(binary);

        // Add torrent to daemon
        const res = await postJson<{ id: string }>(
          "/torrents",
          {
            torrent_b64: b64,
            name_hint: file.name,
          },
          60000
        );

        if (!res?.id) {
          pushToast("error", "Daemon rejected torrent add request");
          return;
        }

        handleTorrentAdded(res.id, true);
        pushToast("info", `Torrent added: ${file.name}`);
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to add dropped torrent file"));
      }
    },
    [online, handleTorrentAdded, pushToast]
  );

  // Bulk action handlers
  const handleBulkStop = useCallback(
    async (ids: string[]) => {
      if (!online || ids.length === 0) return;
      const opId = "stop";
      setLoadingOperations((prev) => new Set(prev).add(opId));
      try {
        const promises = ids.map((id) => postJson(`/torrents/${id}/stop`, {}));
        await Promise.all(promises);
        pushToast("info", `Stopped ${ids.length} torrent(s)`);
        refreshAll();
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to stop torrent(s)"));
      } finally {
        setLoadingOperations((prev) => {
          const next = new Set(prev);
          next.delete(opId);
          return next;
        });
      }
    },
    [online, pushToast, refreshAll]
  );

  // Fetch network interfaces (once on mount)
  useEffect(() => {
    (async () => {
      try {
        if (window.orc?.netifs) {
          const ifs = await window.orc.netifs();
          if (Array.isArray(ifs)) {
            setNetifs(ifs);
          }
        }
      } catch (err) {
        logger.errorWithPrefix("App", "Failed to fetch network interfaces:", err);
        // Network interface fetch failure is non-critical, log but don't show toast
        setNetifs([]); // Set empty array as fallback
      }
    })();
  }, []);

  // Mark as mounted once component loads
  useEffect(() => {
    setMounted(true);

    // Ensure body has js-loaded class
    if (document.body) {
      document.body.classList.add("js-loaded");
    }

    // Fetch daemon log path
    if (window.orc?.daemon?.getLogPath) {
      window.orc.daemon
        .getLogPath()
        .then((path: string | null) => {
          setDaemonLogPath(path);
        })
        .catch(() => {
          // Ignore errors
        });
    }

    // Listen for shutdown event
    if (window.orc?.onShuttingDown) {
      const cleanup = window.orc.onShuttingDown(() => {
        setIsShuttingDown(true);
      });
      return cleanup;
    }
  }, []);

  useEffect(() => {
    const nextTheme = isAnimusEdition ? "dark" : resolvedAppTheme;
    document.documentElement.dataset.appTheme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    if (document.body) {
      document.body.dataset.appTheme = nextTheme;
    }
  }, [isAnimusEdition, resolvedAppTheme]);

  useEffect(() => {
    let active = true;

    window.orc?.theme
      ?.get?.()
      .then((state) => {
        if (!active || !state || !isAppThemeMode(state.source)) return;
        if (state.resolved !== "light" && state.resolved !== "dark") return;
        setAppThemeSource(state.source);
        setResolvedAppTheme(state.resolved);
      })
      .catch(() => {
        // Ignore theme API failures and keep the bootstrap snapshot.
      });

    const cleanup = window.orc?.theme?.onChange?.((state) => {
      if (!state || !isAppThemeMode(state.source)) return;
      if (state.resolved !== "light" && state.resolved !== "dark") return;
      setAppThemeSource(state.source);
      setResolvedAppTheme(state.resolved);
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (window.orc?.theme?.onChange || appThemeSource !== "auto" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (event: MediaQueryListEvent) => {
      setResolvedAppTheme(event.matches ? "dark" : "light");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [appThemeSource]);

  // Restore notification sound from userData meta (and sync localStorage mirror)
  useEffect(() => {
    void loadPersistedNotificationSound();
  }, []);

  // Keep theme state aligned if storage changes (e.g. another window)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== NOTIFICATION_VISUAL_THEME_STORAGE_KEY || !event.newValue) return;
      if (isNotificationVisualTheme(event.newValue)) {
        setNotificationVisualTheme(event.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Keyboard shortcuts
  const keyboardShortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      {
        key: "m",
        ctrl: true,
        handler: () => setShowAddTorrentModal(true),
        description: "Add Magnet Link",
      },
      {
        key: "t",
        ctrl: true,
        handler: () => setShowAddTorrentModal(true),
        description: "Add Torrent File",
      },
      {
        key: "f",
        ctrl: true,
        handler: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            isAnimusEdition ? ".animusTopSearchInput" : ".searchInput"
          );
          searchInput?.focus();
        },
        description: "Focus Search",
      },
      {
        key: "?",
        ctrl: true,
        handler: () => setShowKeyboardShortcuts((prev) => !prev),
        description: "Show Keyboard Shortcuts",
      },
      {
        key: "Escape",
        handler: () => {
          if (showAddTorrentModal) setShowAddTorrentModal(false);
          if (showKillSwitchDrawer) setShowKillSwitchDrawer(false);
          if (showFileSelectionDialog) {
            setShowFileSelectionDialog(false);
            // Clear pending ref to allow reopening
            pendingDialogOpenRef.current = null;
            if (dialogOpenTimeoutRef.current) {
              clearTimeout(dialogOpenTimeoutRef.current);
              dialogOpenTimeoutRef.current = null;
            }
            setPendingTorrentId(null);
            setPendingTorrentName("");
          }
          if (showKeyboardShortcuts) setShowKeyboardShortcuts(false);
          // Navigate back to the main landing page if on another page
          if (currentPage !== landingPage) {
            setCurrentPage(landingPage);
          }
        },
        description: "Close Modal/Drawer or Navigate Back",
      },
    ],
    [
      showAddTorrentModal,
      showKillSwitchDrawer,
      showFileSelectionDialog,
      showKeyboardShortcuts,
      currentPage,
      isAnimusEdition,
      landingPage,
    ]
  );

  useKeyboardShortcuts(keyboardShortcuts, mounted && online);

  useEffect(() => {
    if (!window.orc?.onMagnetLink) {
      logger.warn("window.orc.onMagnetLink is not available");
      return;
    }
    const cleanup = window.orc.onMagnetLink(addMagnetLink);
    return () => {
      if (cleanup && typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [addMagnetLink]);

  // Handle torrent files opened from OS
  // Track pending wait intervals for cleanup
  const torrentFileWaitRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!window.orc?.onTorrentFile) {
      logger.warn("window.orc.onTorrentFile is not available");
      return;
    }

    // Capture current online state to avoid stale closure
    const currentOnline = online;

    const handleTorrentFile = async (data: { base64: string; fileName: string }) => {
      logger.logWithPrefix(
        "Torrent File",
        `Received torrent file from OS: ${data.fileName} (${(data.base64.length / 1024).toFixed(2)}KB base64)`
      );

      if (!currentOnline) {
        logger.warn("[Torrent File] Daemon not connected, will retry when effect re-runs");
        // Just show error - effect will re-run when online changes
        pushToast(
          "error",
          "Cannot add torrent: daemon not connected. Please wait for the daemon to start and try again."
        );
        return;
      }

      let hash: string | null = null;
      try {
        // Check for duplicates by info hash
        const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
        hash = await infoHashFromTorrentBytes(bytes);
        if (hash) {
          // Refresh torrent list to get latest
          const listRes = await getJson<{ items: Torrent[] }>("/torrents");
          const existing = listRes.items.find((t) => t.info_hash_hex?.toLowerCase() === hash!.toLowerCase());
          if (existing) {
            handleTorrentSelect(existing.id, false);
            setFileFoundTorrentId(existing.id);
            setShowFileFoundModal(true);
            pushToast("info", "Already added — showing existing torrent");
            return;
          }
        }

        logger.logWithPrefix("Torrent File", `Adding torrent to daemon: ${data.fileName}`);
        // Use longer timeout for file uploads (60 seconds)
        const res = await postJson<{ id: string }>(
          "/torrents",
          {
            torrent_b64: data.base64,
            name_hint: data.fileName,
          },
          60000
        ); // 60 second timeout for file uploads

        if (!res?.id) {
          logger.errorWithPrefix("Torrent File", "Daemon rejected torrent add request (no ID returned)");
          pushToast("error", "Daemon rejected torrent add request");
          return;
        }

        logger.logWithPrefix("Torrent File", `Torrent added successfully with ID: ${res.id}`);
        handleTorrentAdded(res.id);
        pushToast("info", `Torrent added: ${data.fileName} - Starting automatically...`);
      } catch (e: unknown) {
        const message = getErrorMessage(e, "Failed to add torrent file");
        // Check if error indicates duplicate/file exists
        if (
          message.toLowerCase().includes("already exists") ||
          message.toLowerCase().includes("file exists") ||
          message.toLowerCase().includes("duplicate")
        ) {
          // Try to find existing torrent by hash
          if (hash) {
            try {
              const listRes = await getJson<{ items: Torrent[] }>("/torrents");
              const existing = listRes.items.find((t) => t.info_hash_hex?.toLowerCase() === hash!.toLowerCase());
              if (existing) {
                handleTorrentSelect(existing.id, false);
                setFileFoundTorrentId(existing.id);
                setShowFileFoundModal(true);
                pushToast("info", "Already added — showing existing torrent");
                return;
              }
            } catch {}
          }
        }
        logger.errorWithPrefix("Torrent File", "Error adding torrent:", e);
        pushToast("error", `Failed to add torrent: ${message}`);
      }
    };

    const cleanup = window.orc.onTorrentFile(handleTorrentFile);
    return () => {
      // Clear any pending wait interval
      if (torrentFileWaitRef.current) {
        clearInterval(torrentFileWaitRef.current);
        torrentFileWaitRef.current = null;
      }
      if (cleanup && typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [online, handleTorrentAdded, pushToast, refreshStatus]);

  // Calculate active torrent count for pause all
  const activeTorrentCount = useMemo(() => {
    return torrents.filter((t) => {
      const status = torrentStatuses.get(t.id);
      return status && (status.state === "downloading" || status.state === "seeding");
    }).length;
  }, [torrents, torrentStatuses]);

  // Calculate paused torrent count for resume all
  const pausedTorrentCount = useMemo(() => {
    return torrents.filter((t) => {
      const status = torrentStatuses.get(t.id);
      return status && status.state === "stopped";
    }).length;
  }, [torrents, torrentStatuses]);

  // Calculate global stats
  const globalStats = useMemo(() => {
    let totalUp = 0;
    let totalDown = 0;
    for (const status of torrentStatuses.values()) {
      if (status && typeof status.up_rate_bps === "number") {
        totalUp += status.up_rate_bps;
      }
      if (status && typeof status.down_rate_bps === "number") {
        totalDown += status.down_rate_bps;
      }
    }
    return { up: totalUp, down: totalDown };
  }, [torrentStatuses]);

  const downloadingCount = useMemo(() => {
    return torrents.filter((torrent) => torrentStatuses.get(torrent.id)?.state === "downloading").length;
  }, [torrentStatuses, torrents]);

  const seedingCount = useMemo(() => {
    return torrents.filter((torrent) => torrentStatuses.get(torrent.id)?.state === "seeding").length;
  }, [torrentStatuses, torrents]);

  const dashboardTorrents = useMemo(() => {
    const rankStatus = (status: TorrentStatus | null): number => {
      switch (status?.state) {
        case "downloading":
          return 0;
        case "seeding":
          return 1;
        case "checking":
          return 2;
        case "error":
          return 3;
        case "stopped":
          return 4;
        default:
          return 5;
      }
    };

    return [...torrents]
      .sort((left, right) => {
        const leftStatus = torrentStatuses.get(left.id) ?? null;
        const rightStatus = torrentStatuses.get(right.id) ?? null;
        const leftRank = rankStatus(leftStatus);
        const rightRank = rankStatus(rightStatus);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        const leftRate = (leftStatus?.down_rate_bps ?? 0) + (leftStatus?.up_rate_bps ?? 0);
        const rightRate = (rightStatus?.down_rate_bps ?? 0) + (rightStatus?.up_rate_bps ?? 0);
        if (leftRate !== rightRate) {
          return rightRate - leftRate;
        }

        return right.added_at_ms - left.added_at_ms;
      })
      .slice(0, 6)
      .map((torrent) => ({
        torrent,
        status: torrentStatuses.get(torrent.id) ?? null,
      }));
  }, [torrentStatuses, torrents]);

  const handleBulkStart = useCallback(
    async (ids: string[]) => {
      if (!online || ids.length === 0) return;
      const opId = "start";
      setLoadingOperations((prev) => new Set(prev).add(opId));
      try {
        const promises = ids.map((id) => postJson(`/torrents/${id}/start`, {}));
        await Promise.all(promises);
        pushToast("info", `Started ${ids.length} torrent(s)`);
        refreshAll();
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to start torrent(s)"));
      } finally {
        setLoadingOperations((prev) => {
          const next = new Set(prev);
          next.delete(opId);
          return next;
        });
      }
    },
    [online, pushToast, refreshAll]
  );

  const handleBulkPause = useCallback(
    async (ids: string[]) => {
      // Pause is the same as stop
      await handleBulkStop(ids);
    },
    [handleBulkStop]
  );

  // Pause all active torrents
  const handlePauseAll = useCallback(async () => {
    if (!online || activeTorrentCount === 0) return;
    const activeIds = torrents
      .filter((t) => {
        const status = torrentStatuses.get(t.id);
        return status && (status.state === "downloading" || status.state === "seeding");
      })
      .map((t) => t.id);
    if (activeIds.length > 0) {
      await handleBulkStop(activeIds);
      pushToast("info", `Paused all ${activeIds.length} active torrent(s)`);
    }
  }, [online, activeTorrentCount, torrents, torrentStatuses, handleBulkStop, pushToast]);

  // Resume all paused torrents
  const handleResumeAll = useCallback(async () => {
    if (!online || pausedTorrentCount === 0) return;
    const pausedIds = torrents
      .filter((t) => {
        const status = torrentStatuses.get(t.id);
        return status && status.state === "stopped";
      })
      .map((t) => t.id);
    if (pausedIds.length > 0) {
      await handleBulkStart(pausedIds);
      pushToast("info", `Resumed all ${pausedIds.length} paused torrent(s)`);
    }
  }, [online, pausedTorrentCount, torrents, torrentStatuses, handleBulkStart, pushToast]);

  const handleBulkRemove = useCallback(
    async (ids: string[]) => {
      if (!online || ids.length === 0) return;
      const opId = "remove";
      setLoadingOperations((prev) => new Set(prev).add(opId));
      try {
        const promises = ids.map((id) => postJson(`/torrents/${id}/remove`, {}));
        await Promise.all(promises);
        pushToast("info", `Removed ${ids.length} torrent(s)`);
        refreshAll();
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to remove torrent(s)"));
      } finally {
        setLoadingOperations((prev) => {
          const next = new Set(prev);
          next.delete(opId);
          return next;
        });
      }
    },
    [online, pushToast, refreshAll]
  );

  // Stable toolbar callbacks — avoids breaking AppShell's memo on every render
  const withLoading = useCallback((opId: string, fn: () => Promise<void>) => {
    setLoadingOperations((prev) => new Set(prev).add(opId));
    fn().finally(() => {
      setLoadingOperations((prev) => {
        const next = new Set(prev);
        next.delete(opId);
        return next;
      });
    });
  }, []);

  const handleToolbarStart = useCallback(() => {
    withLoading("start", () => handleBulkStart(Array.from(selectedIds)));
  }, [withLoading, handleBulkStart, selectedIds]);

  const handleToolbarPause = useCallback(() => {
    withLoading("stop", () => handleBulkPause(Array.from(selectedIds)));
  }, [withLoading, handleBulkPause, selectedIds]);

  const handleToolbarStop = useCallback(() => {
    withLoading("stop", () => handleBulkStop(Array.from(selectedIds)));
  }, [withLoading, handleBulkStop, selectedIds]);

  const handleToolbarRemove = useCallback(() => {
    withLoading("remove", () => handleBulkRemove(Array.from(selectedIds)));
  }, [withLoading, handleBulkRemove, selectedIds]);

  const handleForceRecheck = useCallback(async () => {
    if (!online || selectedIds.size === 0) {
      pushToast("info", "Select torrent(s) to force recheck");
      return;
    }
    withLoading("recheck", async () => {
      try {
        await Promise.all(Array.from(selectedIds).map((id) => postJson(`/torrents/${id}/recheck`, {})));
        pushToast("info", `Force recheck initiated for ${selectedIds.size} torrent(s)`);
        refreshAll();
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to force recheck"));
      }
    });
  }, [online, selectedIds, withLoading, pushToast, refreshAll]);

  const handleForceAnnounce = useCallback(async () => {
    if (!online || selectedIds.size === 0) {
      pushToast("info", "Select torrent(s) to force announce");
      return;
    }
    withLoading("announce", async () => {
      try {
        await Promise.all(Array.from(selectedIds).map((id) => postJson(`/torrents/${id}/announce`, {})));
        pushToast("info", `Force announce initiated for ${selectedIds.size} torrent(s)`);
        refreshAll();
      } catch (e: unknown) {
        pushToast("error", getErrorMessage(e, "Failed to force announce"));
      }
    });
  }, [online, selectedIds, withLoading, pushToast, refreshAll]);

  const handleOpenVpnDrawer = useCallback(() => setShowKillSwitchDrawer(true), []);
  const handleOpenAddModal = useCallback(() => setShowAddTorrentModal(true), []);
  const handleOpenSettings = useCallback(() => {
    setSettingsTab("general");
    setCurrentPage("settings");
  }, []);
  const handleOpenSearch = useCallback(() => {
    setCurrentPage("search");
  }, []);
  const handleReturnToTorrents = useCallback(() => {
    setCurrentPage(landingPage);
  }, [landingPage]);
  const handleOpenDownloads = useCallback(() => {
    setCurrentPage("torrents");
  }, []);
  const handleOpenTorrentInDownloads = useCallback((torrentId: string) => {
    setSelectedIds(new Set([torrentId]));
    setCurrentPage("torrents");
  }, []);
  const handleCloseSettings = handleReturnToTorrents;

  const handleSettingsToolbarAction = useCallback(() => {
    if (currentPage === "settings") {
      handleReturnToTorrents();
      return;
    }

    setSettingsTab("general");
    setCurrentPage("settings");
  }, [currentPage, handleReturnToTorrents]);

  const handleStatusFilterChange = useCallback((filter: StatusFilter) => {
    setStatusFilter(filter);
    setCurrentPage("torrents");
  }, []);

  const handleSmartViewChange = useCallback((view: SmartView | null) => {
    setSmartView(view);
    setCurrentPage("torrents");
  }, []);

  const handleLabelClick = useCallback(
    (label: string) => {
      pushToast("info", `Filtering by label: ${label}`);
      setCurrentPage("torrents");
    },
    [pushToast]
  );

  const handleNetworkPageClick = useCallback(() => {
    setCurrentPage("network");
  }, []);

  const handleEventsPageClick = useCallback(() => {
    setCurrentPage("events");
  }, []);

  const handleSettingsPageClick = useCallback(() => {
    setSettingsTab("general");
    setCurrentPage("settings");
  }, []);

  // Health indicator click handler - show relevant info based on state
  const handleHealthClick = useCallback(() => {
    switch (daemonHealthState) {
      case "offline":
        pushToast("error", "Daemon is offline. Check if the application started correctly.");
        break;
      case "error":
        pushToast("error", "Some torrents have errors. Check the torrent list for details.");
        break;
      case "warning":
        pushToast("info", "Daemon is running with warnings. Check logs for details.");
        break;
      case "healthy":
        pushToast(
          "info",
          `Daemon healthy - Uptime: ${health?.uptime_sec ? Math.floor(health.uptime_sec / 60) : 0} minutes`
        );
        break;
    }
  }, [daemonHealthState, health, pushToast]);

  const settingsReturnLabel = isAnimusEdition ? "Back to dashboard" : "Back to downloads";
  const settingsPageDescription = isAnimusEdition
    ? "Privacy, bandwidth, notifications, and daemon controls live here. Press Escape or use the button on the right to return to the dashboard."
    : "Privacy, bandwidth, notifications, and daemon controls live here. Press Escape or use the button on the right to return to downloads.";

  const daemonBanner = !online ? (
    <div className={`banner ${notificationVisualTheme}`}>
      {usesKawaiiHeartRing(notificationVisualTheme) ? <KawaiiHeartRing /> : null}
      {usesAnarchyEmblemRing(notificationVisualTheme) ? <AnarchyEmblemRing /> : null}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
        <Spinner size={40} />
        <div style={{ flex: 1 }}>
          <div className="bannerTitle">Connecting to daemon...</div>
          <div className="bannerBody">
            The application is starting the daemon process. If this message persists, please check the log file for
            errors.
          </div>
          {daemonLogPath && (
            <div
              style={{
                fontSize: "12px",
                opacity: 0.7,
                marginBottom: "8px",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              Log: {daemonLogPath}
            </div>
          )}
          {window.orc?.daemon?.openLog && (
            <button
              className="btn ghost"
              onClick={async () => {
                try {
                  const result = await window.orc?.daemon?.openLog();
                  if (result && !result.success && result.error) {
                    pushToast("error", `Failed to open log: ${result.error}`);
                  }
                } catch (err) {
                  pushToast("error", "Failed to open log file");
                }
              }}
            >
              Open Log File Location
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const settingsPageContent = (
    <div className="settingsPage">
      <div className="settingsPageHeader">
        <div className="settingsPageHeaderCopy">
          <div className="settingsPageEyebrow">Settings</div>
          <h1 className="settingsPageTitle">Tune your desktop client</h1>
          <p className="settingsPageDescription">{settingsPageDescription}</p>
        </div>
        <div className="settingsPageHeaderActions">
          <button type="button" className="btn" onClick={handleOpenSearch}>
            Open search
          </button>
          <button type="button" className="btn" onClick={() => setCurrentPage("events")}>
            View events
          </button>
          <button type="button" className="btn primary" onClick={handleCloseSettings}>
            {settingsReturnLabel}
          </button>
        </div>
      </div>
      <div className="settingsTabsBar">
        {[
          ["general", "General"],
          ["downloads", "Downloads"],
          ["watch", "Watch"],
          ["seeding", "Seeding"],
          ["bandwidth", "Bandwidth"],
          ["search", "Search"],
          ["privacy", "Privacy"],
          ["network", "Network"],
          ["interface", "Interface"],
          ["advanced", "Advanced"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={`settingsTabBtn ${settingsTab === id ? "active" : ""}`}
            onClick={() => setSettingsTab(id as typeof settingsTab)}
            aria-pressed={settingsTab === id}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="settingsPageContent">
        {settingsTab === "general" && (
          <>
            <div className="settingsSectionCard settingsSummaryCard">
              <h2 className="settingsSectionCardTitle">Application</h2>
              <div className="settingsSummaryRows">
                <div className="settingsSummaryRow">
                  <span>Launch on startup</span>
                  <span className="settingsSummaryBadge muted">Planned</span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Start paused</span>
                  <span className="settingsSummaryBadge muted">Planned</span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Show notifications</span>
                  <span className="settingsSummaryBadge ok">Enabled</span>
                </div>
              </div>
              <p className="settingsSummaryNote">
                Startup-specific preferences are not surfaced by the daemon yet, so this view keeps them visible without
                pretending they already persist.
              </p>
            </div>

            <div className="settingsSectionCard settingsSummaryCard officialWebsiteCard">
              <div>
                <div className="settingsPageEyebrow">Official website</div>
                <h2 className="settingsSectionCardTitle">Orclabs.io</h2>
                <p className="settingsSummaryNote">
                  Visit the official home of ORC Torrent for project news, downloads, and documentation.
                </p>
              </div>
              <button type="button" className="btn primary" onClick={() => void handleOpenOfficialWebsite()}>
                Visit Orclabs.io ↗
              </button>
            </div>

            <div className="settingsSectionCard settingsSectionCardWide">
              <h2 className="settingsSectionCardTitle">Updates</h2>
              <UpdateSettings onError={(msg) => pushToast("error", msg)} onSuccess={(msg) => pushToast("info", msg)} />
            </div>

            <div className="settingsSectionCard settingsSummaryCard">
              <h2 className="settingsSectionCardTitle">System status</h2>
              <div className="settingsSummaryRows">
                <div className="settingsSummaryRow">
                  <span>VPN protected</span>
                  <span className={`settingsSummaryBadge ${vpnStatus?.posture === "connected" ? "ok" : "warn"}`}>
                    {vpnStatus?.posture === "connected" ? "On" : "Checking"}
                  </span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Daemon connected</span>
                  <span className={`settingsSummaryBadge ${online ? "ok" : "warn"}`}>
                    {online ? "OK" : "Connecting"}
                  </span>
                </div>
                <div className="settingsSummaryRow">
                  <span>VPN transfer pause armed</span>
                  <span className={`settingsSummaryBadge ${killSwitch?.enabled ? "ok" : "muted"}`}>
                    {killSwitch?.enabled ? "On" : "Off"}
                  </span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Protection posture</span>
                  <span
                    className={`settingsSummaryBadge ${netPosture?.state === "protected" ? "ok" : netPosture?.state === "leak_risk" ? "warn" : "muted"}`}
                  >
                    {netPosture?.state === "protected"
                      ? "Protected"
                      : netPosture?.state === "leak_risk"
                        ? "At risk"
                        : "Unconfigured"}
                  </span>
                </div>
              </div>
            </div>

            <div className="settingsSectionCard settingsSummaryCard">
              <h2 className="settingsSectionCardTitle">Quick sections</h2>
              <div className="settingsQuickGrid">
                <button className="btn" onClick={() => setSettingsTab("downloads")}>
                  Downloads
                </button>
                <button className="btn" onClick={() => setSettingsTab("search")}>
                  Search
                </button>
                <button className="btn" onClick={() => setSettingsTab("privacy")}>
                  Privacy
                </button>
                <button className="btn" onClick={() => setSettingsTab("network")}>
                  Network
                </button>
                <button className="btn" onClick={() => setSettingsTab("interface")}>
                  Interface
                </button>
                <button className="btn" onClick={() => setCurrentPage("events")}>
                  Events
                </button>
                <button className="btn" onClick={() => setSettingsTab("advanced")}>
                  Advanced
                </button>
              </div>
            </div>

            <div className="settingsSectionCard settingsSectionCardWide">
              <h2 className="settingsSectionCardTitle">Notification sounds</h2>
              <div className="settingsSection">
                <NotificationSoundSettings
                  onError={handleNotificationSettingsError}
                  onSuccess={handleNotificationSettingsSuccess}
                />
              </div>
            </div>
          </>
        )}

        {settingsTab === "downloads" && (
          <>
            <div className="settingsSectionCard settingsSummaryCard">
              <h2 className="settingsSectionCardTitle">Downloads</h2>
              <div className="settingsSummaryRows">
                <div className="settingsSummaryRow">
                  <span>Active torrents</span>
                  <span className="settingsSummaryValue">{activeTorrentCount}</span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Paused torrents</span>
                  <span className="settingsSummaryValue">{pausedTorrentCount}</span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Visible filter</span>
                  <span className="settingsSummaryValue">{downloadsFilter}</span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Speed limit mode</span>
                  <span className={`settingsSummaryBadge ${speedLimitEnabled ? "ok" : "muted"}`}>
                    {speedLimitEnabled ? "Enabled" : "Off"}
                  </span>
                </div>
              </div>
              <div className="settingsQuickActions">
                <button className="btn" onClick={handlePauseAll} disabled={!online || activeTorrentCount === 0}>
                  Pause active
                </button>
                <button className="btn" onClick={handleResumeAll} disabled={!online || pausedTorrentCount === 0}>
                  Resume paused
                </button>
                <button className="btn" onClick={handleOpenAddModal}>
                  Add torrent
                </button>
              </div>
              <p className="settingsSummaryNote">
                Default save-path configuration is still daemon-managed, so this tab focuses on the download workflow
                controls the desktop app already owns.
              </p>
            </div>

            <div className="settingsSectionCard settingsSummaryCard">
              <h2 className="settingsSectionCardTitle">Bandwidth profile</h2>
              <div className="settingsSummaryRows">
                <div className="settingsSummaryRow">
                  <span>Session speed limits</span>
                  <span className={`settingsSummaryBadge ${speedLimitEnabled ? "ok" : "muted"}`}>
                    {speedLimitEnabled ? "On" : "Unlimited"}
                  </span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Download cap</span>
                  <span className="settingsSummaryValue">
                    {downloadLimitInput.trim() ? `${downloadLimitInput} KB/s` : "Unlimited"}
                  </span>
                </div>
                <div className="settingsSummaryRow">
                  <span>Upload cap</span>
                  <span className="settingsSummaryValue">
                    {uploadLimitInput.trim() ? `${uploadLimitInput} KB/s` : "Unlimited"}
                  </span>
                </div>
              </div>
              <p className="settingsSummaryNote">
                These limits apply to the current desktop session and are remembered locally so the dashboard toggle can
                reuse them.
              </p>
            </div>

            <div className="settingsSectionCard settingsSectionCardWide">
              <h2 className="settingsSectionCardTitle">Upload and download limits</h2>
              <div className="settingsRateLimitPanel">
                <div className="settingsRateLimitToggleRow">
                  <div>
                    <div className="settingsRateLimitLabel">Enable session speed limits</div>
                    <p className="settingsSummaryNote">
                      Leave a field blank for unlimited on that direction, or set both if you want a fully capped
                      session.
                    </p>
                  </div>
                  <label className="toggle small" aria-label="Enable session speed limits">
                    <input
                      type="checkbox"
                      checked={speedLimitEnabled}
                      onChange={(e) => setSpeedLimitEnabled(e.target.checked)}
                    />
                    <span className="slider" />
                  </label>
                </div>

                <div className="settingsRateLimitGrid">
                  <label className="settingsRateLimitField">
                    <span className="settingsRateLimitLabel">Download limit (KB/s)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      className="settingsNumberInput"
                      placeholder="Unlimited"
                      value={downloadLimitInput}
                      onChange={(e) => setDownloadLimitInput(e.target.value)}
                    />
                  </label>
                  <label className="settingsRateLimitField">
                    <span className="settingsRateLimitLabel">Upload limit (KB/s)</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      inputMode="numeric"
                      className="settingsNumberInput"
                      placeholder="Unlimited"
                      value={uploadLimitInput}
                      onChange={(e) => setUploadLimitInput(e.target.value)}
                    />
                  </label>
                </div>

                <div className="settingsQuickActions">
                  <button
                    className="btn primary"
                    onClick={() => void applySessionSpeedLimits(speedLimitEnabled)}
                    disabled={isApplyingSpeedLimits}
                  >
                    {isApplyingSpeedLimits ? "Applying..." : "Apply limits"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setSpeedLimitEnabled(false);
                      void applySessionSpeedLimits(false);
                    }}
                    disabled={isApplyingSpeedLimits}
                  >
                    Turn limits off
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setDownloadLimitInput("");
                      setUploadLimitInput("");
                    }}
                    disabled={isApplyingSpeedLimits}
                  >
                    Clear values
                  </button>
                </div>
              </div>
            </div>
          </>
        )}

        {settingsTab === "watch" && (
          <WatchFoldersSettings
            online={online}
            onError={(msg) => pushToast("error", msg)}
            onSuccess={(msg) => pushToast("info", msg)}
          />
        )}

        {settingsTab === "seeding" && (
          <SeedingSettingsPanel
            online={online}
            onError={(msg) => pushToast("error", msg)}
            onSuccess={(msg) => pushToast("info", msg)}
          />
        )}

        {settingsTab === "bandwidth" && (
          <BandwidthSettingsPanel
            online={online}
            onError={(msg) => pushToast("error", msg)}
            onSuccess={(msg) => pushToast("info", msg)}
            onProfileChange={setBandwidthProfile}
          />
        )}

        {settingsTab === "search" && (
          <div className="settingsSectionCard settingsSectionCardWide">
            <h2 className="settingsSectionCardTitle">Search</h2>
            <div className="settingsSection">
              <SearchSettingsPanel
                online={online}
                settings={searchSettings}
                onError={(msg) => pushToast("error", msg)}
                onSuccess={(msg) => pushToast("info", msg)}
                onSettingsChanged={setSearchSettings}
              />
            </div>
          </div>
        )}

        {settingsTab === "privacy" && (
          <div className="settingsSectionCard settingsSectionCardWide">
            <h2 className="settingsSectionCardTitle">Privacy</h2>
            <div className="settingsSection">
              <SecuritySettings
                online={online}
                onError={(msg) => pushToast("error", msg)}
                onSuccess={(msg) => pushToast("info", msg)}
              />
            </div>
          </div>
        )}

        {settingsTab === "network" && (
          <div className="settingsSectionCard settingsSectionCardWide">
            <h2 className="settingsSectionCardTitle">Network & VPN</h2>
            <div className="settingsSection">
              <NetworkPostureCenter
                netPosture={netPosture}
                netifs={netifs}
                vpnStatus={vpnStatus}
                online={online}
                onUpdate={refreshAll}
                onRefreshVpn={refreshVpnStatus}
                onError={(msg) => pushToast("error", msg)}
                onSuccess={(msg) => pushToast("info", msg)}
              />
            </div>
          </div>
        )}

        {settingsTab === "interface" && (
          <div className="settingsSectionCard">
            <h2 className="settingsSectionCardTitle">Appearance</h2>
            <div className="settingsSection settingsSectionSpacious">
              {!isAnimusEdition ? (
                <div className="settingsSummaryField">
                  <label className="notificationThemeLabel" htmlFor="app-theme-select-interface">
                    App color mode
                  </label>
                  <select
                    id="app-theme-select-interface"
                    className="notificationSoundSelect"
                    value={appThemeSource}
                    onChange={handleAppThemeSourceChange}
                    aria-label="App color mode"
                  >
                    <option value="auto">Auto</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                  <p className="settingsSummaryNote">
                    Auto follows your system appearance. The active theme right now is {resolvedAppTheme}.
                  </p>
                </div>
              ) : (
                <p className="settingsSummaryNote">
                  AnimUS Edition keeps its fixed dark graffiti shell. Notification visuals can still be previewed below.
                </p>
              )}
              <div className="notificationThemeControls notificationThemeControlsSticky">
                <label className="notificationThemeLabel" htmlFor="notification-theme-select-interface">
                  Banner and toast theme:
                </label>
                <select
                  id="notification-theme-select-interface"
                  className="notificationSoundSelect"
                  value={notificationVisualTheme}
                  onChange={handleNotificationVisualThemeChange}
                  aria-label="Notification banner and toast theme"
                >
                  {NOTIFICATION_VISUAL_THEME_REGISTRY.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleNotificationThemePreview}
                  title="Show a sample in-app popup with the selected theme"
                >
                  Test popup theme
                </button>
              </div>
              <div className="settingsQuickActions">
                <button type="button" className="btn" onClick={handleActionNotificationPreview}>
                  Preview action
                </button>
                <button type="button" className="btn" onClick={handleStatusNotificationPreview}>
                  Preview status
                </button>
              </div>
              <p className="settingsSummaryNote">
                Notification sounds now live on the General tab so they are easier to find during setup.
              </p>
            </div>
          </div>
        )}

        {settingsTab === "advanced" && (
          <>
            <div className="settingsSectionCard settingsSectionCardWide">
              <EngineSettings
                online={online}
                onError={(msg) => pushToast("error", msg)}
                onSuccess={(msg) => pushToast("info", msg)}
              />
            </div>
            <div className="settingsSectionCard settingsSectionCardWide">
              <h2 className="settingsSectionCardTitle">Daemon</h2>
              <div className="settingsSection">
                <DaemonControl
                  online={online}
                  onError={(msg) => pushToast("error", msg)}
                  onSuccess={(msg) => pushToast("info", msg)}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  const searchPageContent = (
    <SearchPage
      online={online}
      isActive={currentPage === "search"}
      settings={searchSettings}
      query={searchQuery}
      onQueryChange={setSearchQuery}
      onBack={handleReturnToTorrents}
      backLabel={settingsReturnLabel}
      requireQuery={isAnimusEdition}
      onTorrentAdded={handleTorrentAdded}
      onError={(msg) => pushToast("error", msg)}
      onSuccess={(msg) => pushToast("info", msg)}
      variant={isAnimusEdition ? "animus" : "standard"}
    />
  );

  const eventsPageContent = (
    <EventsPage events={events} online={online} onBack={handleReturnToTorrents} onClearEvents={clearEvents} />
  );

  const networkPageContent = (
    <div className="networkPageLayout">
      <NetworkPostureCenter
        netPosture={netPosture}
        netifs={netifs}
        vpnStatus={vpnStatus}
        online={online}
        onUpdate={refreshAll}
        onRefreshVpn={refreshVpnStatus}
        onError={(msg) => pushToast("error", msg)}
        onSuccess={(msg) => pushToast("info", msg)}
      />
      <NetworkPage
        online={online}
        vpnStatus={vpnStatus}
        killSwitch={killSwitch}
        netifs={netifs}
        onBack={handleReturnToTorrents}
        onError={(msg) => pushToast("error", msg)}
        onSuccess={(msg) => pushToast("info", msg)}
      />
    </div>
  );

  const standardTorrentsPage = (
    <div className="dashboardPage">
      <div className="dashboardMetrics">
        <div className="dashboardMetricCard">
          <div className="dashboardMetricLabel">Download</div>
          <div className="dashboardMetricValue">{fmtBytesPerSec(globalStats.down)}</div>
        </div>
        <div className="dashboardMetricCard">
          <div className="dashboardMetricLabel">Upload</div>
          <div className="dashboardMetricValue">{fmtBytesPerSec(globalStats.up)}</div>
        </div>
        <div className="dashboardMetricCard">
          <div className="dashboardMetricLabel">Active</div>
          <div className="dashboardMetricValue">
            {activeTorrentCount} torrent{activeTorrentCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="dashboardMetricCard">
          <div className="dashboardMetricLabel">Protection</div>
          <div className="dashboardMetricValue">
            {netPosture?.state === "protected"
              ? "Protected"
              : netPosture?.state === "leak_risk"
                ? "At risk"
                : "Checking"}
          </div>
          <div className="dashboardMetricSubtle">{online ? "Daemon OK" : "Daemon reconnecting"}</div>
        </div>
      </div>
      <PrivacyStatusCard
        online={online}
        onStatusChange={setPrivacyStatus}
        onSuccess={(msg) => pushToast("info", msg)}
        onError={(msg) => pushToast("error", msg)}
      />
      <div className="dashboardWorkspace">
        <div className="dashboardQueuePanel">
          <TorrentPortfolio
            torrents={torrents}
            statuses={torrentStatuses}
            selectedIds={selectedIds}
            onSelect={handleTorrentSelect}
            onStart={handleBulkStart}
            onPause={handleBulkPause}
            onStop={handleBulkStop}
            onRemove={handleBulkRemove}
            onSetPriority={(ids, priority) =>
              pushToast("info", `Setting priority ${priority} for ${ids.length} torrent(s)`)
            }
            onMoveData={(ids) => pushToast("info", `Moving data for ${ids.length} torrent(s)`)}
            onExportTorrent={(ids) => pushToast("info", `Exporting ${ids.length} torrent(s)`)}
            onSetLimits={(ids) => pushToast("info", `Setting limits for ${ids.length} torrent(s)`)}
            onApplyLabel={(ids, label) => pushToast("info", `Applying label ${label} to ${ids.length} torrent(s)`)}
            onSetVpnPolicy={(ids, policy) =>
              pushToast("info", `Setting VPN policy ${policy} for ${ids.length} torrent(s)`)
            }
            availableLabels={labels}
            online={online}
            filter={downloadsFilter}
            onFilterChange={setDownloadsFilter}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onAddMagnet={() => setShowAddTorrentModal(true)}
            onAddTorrent={() => setShowAddTorrentModal(true)}
            onPauseAll={handlePauseAll}
            onResumeAll={handleResumeAll}
            speedLimitEnabled={speedLimitEnabled}
            onSpeedLimitToggle={() => void handleSpeedLimitToggle()}
            rowSnapshotPollMs={intervals.rowSnapshot}
          />
        </div>
        <div className="dashboardInspectorPanel">
          <TorrentInspector
            torrent={selectedTorrent}
            status={status}
            overlay={overlay}
            events={events}
            online={online}
            onUpdate={refreshAll}
            onError={(msg) => pushToast("error", msg)}
            onSuccess={(msg) => pushToast("info", msg)}
          />
        </div>
      </div>
    </div>
  );

  const animusDownloadsPage = (
    <div className="animusDownloadsPage">
      <div className="animusPageHeader">
        <div>
          <div className="animusSectionEyebrow">Downloads</div>
          <h1 className="animusPageTitle">Queue and inspector</h1>
          <p className="animusPageDescription">
            Filter the live queue, inspect torrent internals, and adjust swarm operations without leaving the AnimUS
            shell.
          </p>
        </div>
        <div className="animusPageActions">
          <button type="button" className="btn" onClick={handleOpenSearch}>
            Open Search
          </button>
          <button type="button" className="btn ghost" onClick={handleOpenSettings}>
            Settings
          </button>
        </div>
      </div>
      <div className="dashboardWorkspace animusDashboardWorkspace">
        <div className="dashboardQueuePanel">
          <TorrentPortfolio
            torrents={torrents}
            statuses={torrentStatuses}
            selectedIds={selectedIds}
            onSelect={handleTorrentSelect}
            onStart={handleBulkStart}
            onPause={handleBulkPause}
            onStop={handleBulkStop}
            onRemove={handleBulkRemove}
            onSetPriority={(ids, priority) =>
              pushToast("info", `Setting priority ${priority} for ${ids.length} torrent(s)`)
            }
            onMoveData={(ids) => pushToast("info", `Moving data for ${ids.length} torrent(s)`)}
            onExportTorrent={(ids) => pushToast("info", `Exporting ${ids.length} torrent(s)`)}
            onSetLimits={(ids) => pushToast("info", `Setting limits for ${ids.length} torrent(s)`)}
            onApplyLabel={(ids, label) => pushToast("info", `Applying label ${label} to ${ids.length} torrent(s)`)}
            onSetVpnPolicy={(ids, policy) =>
              pushToast("info", `Setting VPN policy ${policy} for ${ids.length} torrent(s)`)
            }
            availableLabels={labels}
            online={online}
            filter={downloadsFilter}
            onFilterChange={setDownloadsFilter}
            searchQuery={downloadsSearchQuery}
            onSearchChange={setDownloadsSearchQuery}
            onAddMagnet={() => setShowAddTorrentModal(true)}
            onAddTorrent={() => setShowAddTorrentModal(true)}
            onPauseAll={handlePauseAll}
            onResumeAll={handleResumeAll}
            speedLimitEnabled={speedLimitEnabled}
            onSpeedLimitToggle={() => void handleSpeedLimitToggle()}
            rowSnapshotPollMs={intervals.rowSnapshot}
          />
        </div>
        <div className="dashboardInspectorPanel">
          <TorrentInspector
            torrent={selectedTorrent}
            status={status}
            overlay={overlay}
            events={events}
            online={online}
            onUpdate={refreshAll}
            onError={(msg) => pushToast("error", msg)}
            onSuccess={(msg) => pushToast("info", msg)}
          />
        </div>
      </div>
    </div>
  );

  const dashboardPageContent = (
    <AnimusDashboardPage
      online={online}
      downloadingCount={downloadingCount}
      seedingCount={seedingCount}
      globalDownSpeed={globalStats.down}
      globalUpSpeed={globalStats.up}
      netPosture={netPosture}
      dashboardTorrents={dashboardTorrents}
      panelWatermarkUrl={editionBranding.surfaceWatermarkUrl}
      onOpenDownloads={handleOpenDownloads}
      onAddTorrent={handleOpenAddModal}
      onSelectTorrent={handleOpenTorrentInDownloads}
    />
  );

  const mainPageContent =
    currentPage === "settings"
      ? settingsPageContent
      : currentPage === "search"
        ? searchPageContent
        : currentPage === "events"
          ? eventsPageContent
          : currentPage === "network"
            ? networkPageContent
            : currentPage === "dashboard"
              ? dashboardPageContent
              : isAnimusEdition
                ? animusDownloadsPage
                : standardTorrentsPage;

  return (
    <BootGate>
      <ErrorBoundary fallback={null}>
        <DropZone onFileDrop={handleDroppedFile} onMagnetDrop={addMagnetLink} disabled={!online}>
          {isShuttingDown && (
            <div className="shutdown-overlay">
              <div className="shutdown-overlay-content">
                <Spinner size={72} />
                <div className="shutdown-title">
                  <span className="shutdown-title-orc">ORC</span> TORRENT
                </div>
                <div className="shutdown-subtitle">Shutting down</div>
                <div className="shutdown-dots">
                  <div className="shutdown-dot"></div>
                  <div className="shutdown-dot"></div>
                  <div className="shutdown-dot"></div>
                </div>
                <div className="shutdown-progress">
                  <div className="shutdown-progress-bar"></div>
                </div>
              </div>
            </div>
          )}
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <div className="app">
            {isAnimusEdition ? (
              <AnimusShell
                online={online}
                currentPage={currentPage}
                onNavigate={(page) => {
                  if (page === "settings") {
                    handleOpenSettings();
                    return;
                  }
                  if (page === "search") {
                    handleOpenSearch();
                    return;
                  }
                  if (page === "events") {
                    handleEventsPageClick();
                    return;
                  }
                  if (page === "network") {
                    handleNetworkPageClick();
                    return;
                  }
                  if (page === "torrents") {
                    handleOpenDownloads();
                    return;
                  }
                  setCurrentPage(page);
                }}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                searchSettings={searchSettings}
                onTorrentAdded={handleTorrentAdded}
                onSearchError={(msg) => pushToast("error", msg)}
                onSearchSuccess={(msg) => pushToast("info", msg)}
                sidebarLogoUrl={editionBranding.sidebarLogoUrl}
                logoUrl={editionBranding.logoUrl}
                sidebarEmblemUrl={editionBranding.sidebarEmblemUrl}
                globalDownSpeed={globalStats.down}
                globalUpSpeed={globalStats.up}
                vpnStatus={vpnStatus}
                killSwitchState={killSwitch?.enforcement_state ?? "disarmed"}
                daemonHealthState={daemonHealthState}
                daemonHealthDetails={daemonHealthDetails}
                onVpnStatusClick={handleOpenVpnDrawer}
                onDaemonHealthClick={handleHealthClick}
                onAddTorrent={handleOpenAddModal}
                onOpenEvents={handleEventsPageClick}
                onOpenWebsite={handleOpenOfficialWebsite}
                version={version}
              >
                {daemonBanner}
                <div className="animusMainContent" id="main-content" role="main">
                  {mainPageContent}
                </div>
              </AnimusShell>
            ) : (
              <>
                <AppShell
                  online={online}
                  version={version}
                  health={health}
                  daemonHealthState={daemonHealthState}
                  daemonHealthDetails={daemonHealthDetails}
                  vpnStatus={vpnStatus}
                  killSwitchState={killSwitch?.enforcement_state ?? "disarmed"}
                  onVpnLedClick={handleOpenVpnDrawer}
                  onHealthClick={handleHealthClick}
                  onRefresh={refreshAll}
                  onAddMagnet={handleOpenAddModal}
                  onAddTorrent={handleOpenAddModal}
                  onStart={handleToolbarStart}
                  onPause={handleToolbarPause}
                  onStop={handleToolbarStop}
                  onRemove={handleToolbarRemove}
                  loadingOperations={loadingOperations}
                  onForceRecheck={handleForceRecheck}
                  onForceAnnounce={handleForceAnnounce}
                  onSettings={handleSettingsToolbarAction}
                  settingsButtonLabel={currentPage === "settings" ? "Downloads" : "Settings"}
                  settingsButtonTitle={currentPage === "settings" ? "Return to Downloads" : "Open Settings (Ctrl+,)"}
                  settingsButtonAriaLabel={currentPage === "settings" ? "Return to Downloads" : "Open Settings"}
                  searchSettings={searchSettings}
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  onTorrentAdded={handleTorrentAdded}
                  onSearchError={(msg) => pushToast("error", msg)}
                  onSearchSuccess={(msg) => pushToast("info", msg)}
                  editionBadge={editionBranding.badgeLabel}
                  tagline={editionBranding.tagline}
                  accentColor={editionBranding.accentColor}
                  logoUrl={editionBranding.logoUrl}
                  isAnimusEdition={false}
                />

                {daemonBanner}

                <MainLayout>
                  <div
                    className={`mainContent mainContentDashboard ${
                      currentPage === "settings" || currentPage === "events" || currentPage === "network"
                        ? "mainContentNoScroll"
                        : ""
                    }`}
                    id="main-content"
                    role="main"
                  >
                    {mainPageContent}
                  </div>
                </MainLayout>

                <StatusBar
                  globalUpSpeed={globalStats.up}
                  globalDownSpeed={globalStats.down}
                  dhtStatus={privacyStatus?.dht_enabled ? "enabled" : "disabled"}
                  pexStatus={privacyStatus?.pex_enabled ? "enabled" : "disabled"}
                  lsdStatus={privacyStatus?.lsd_enabled ? "enabled" : "disabled"}
                  vpnStatus={
                    !vpnStatus
                      ? "unknown"
                      : vpnStatus.posture === "connected" && vpnStatus.connection_type === "vpn"
                        ? "active"
                        : vpnStatus.posture === "disconnected"
                          ? "inactive"
                          : "unknown"
                  }
                  bindInterface={netPosture?.bind_interface ?? null}
                  diskFree={null}
                  encryptionMode="preferred"
                  netPosture={netPosture}
                  onOpenWebsite={handleOpenOfficialWebsite}
                  version={version}
                />
              </>
            )}

            <PrivacyKillSwitchDrawer
              isOpen={showKillSwitchDrawer}
              onClose={() => setShowKillSwitchDrawer(false)}
              vpnStatus={vpnStatus}
              killSwitch={killSwitch}
              online={online}
              onUpdate={refreshAll}
              onRefreshVpn={refreshVpnStatus}
              onError={(msg) => pushToast("error", msg)}
              onSuccess={(msg) => pushToast("info", msg)}
            />

            <Toast toast={toast} onClose={() => setToast(null)} theme={notificationVisualTheme} />
            <ActionToast toast={actionToast} onClose={() => setActionToast(null)} theme={notificationVisualTheme} />
            <StatusToast toast={statusToast} onClose={() => setStatusToast(null)} theme={notificationVisualTheme} />

            <Modal isOpen={showAddTorrentModal} onClose={() => setShowAddTorrentModal(false)} title="Add Torrent">
              <AddTorrent
                online={online}
                wallet={wallet}
                torrents={torrents}
                onTorrentAdded={async (id, showFileDialog) => {
                  // Don't await - handleTorrentAdded is now non-blocking
                  handleTorrentAdded(id, showFileDialog).catch((err) => {
                    logger.errorWithPrefix("App", "Error handling torrent added:", err);
                  });
                  setShowAddTorrentModal(false);
                  if (!showFileDialog) {
                    pushToast("info", "Torrent added and starting automatically...");
                  }
                }}
                onSelectTorrent={(id) => {
                  handleTorrentSelect(id, false);
                  setShowAddTorrentModal(false);
                }}
                onExistingTorrentFound={(id) => {
                  setShowAddTorrentModal(false);
                  setSelectedIds(new Set([id]));
                  setFileFoundTorrentId(id);
                  setShowFileFoundModal(true);
                }}
                onError={(msg) => pushToast("error", msg)}
                onSuccess={(msg) => pushToast("info", msg)}
              />
            </Modal>

            <Modal
              isOpen={showFileFoundModal}
              onClose={() => {
                setShowFileFoundModal(false);
                setFileFoundTorrentId(null);
              }}
              title="Torrent already present"
            >
              <div className="stack" style={{ gap: "var(--space-4)" }}>
                <p style={{ margin: 0 }}>File found — continuing seeding or downloading.</p>
                <div className="fieldRow" style={{ justifyContent: "flex-end" }}>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setShowFileFoundModal(false);
                      setFileFoundTorrentId(null);
                    }}
                  >
                    OK
                  </button>
                </div>
              </div>
            </Modal>

            <Modal
              isOpen={showKeyboardShortcuts}
              onClose={() => setShowKeyboardShortcuts(false)}
              title="Keyboard Shortcuts"
            >
              <div className="keyboardShortcuts">
                <div className="keyboardShortcutsGroup">
                  <h3 className="keyboardShortcutsGroupTitle">General</h3>
                  <div className="keyboardShortcutsList">
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="keyboardShortcutKey">M</kbd>
                      <span className="keyboardShortcutDescription">Add Magnet Link</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="keyboardShortcutKey">T</kbd>
                      <span className="keyboardShortcutDescription">Add Torrent File</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="keyboardShortcutKey">F</kbd>
                      <span className="keyboardShortcutDescription">Focus Search</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Ctrl</kbd>
                      <span>+</span>
                      <kbd className="keyboardShortcutKey">?</kbd>
                      <span className="keyboardShortcutDescription">Show This Help</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Esc</kbd>
                      <span className="keyboardShortcutDescription">Close Modal/Drawer</span>
                    </div>
                  </div>
                </div>
                <div className="keyboardShortcutsGroup">
                  <h3 className="keyboardShortcutsGroupTitle">Navigation</h3>
                  <div className="keyboardShortcutsList">
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Tab</kbd>
                      <span className="keyboardShortcutDescription">Navigate Between Elements</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Enter</kbd>
                      <span className="keyboardShortcutDescription">Select/Activate</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">Space</kbd>
                      <span className="keyboardShortcutDescription">Select Torrent Row</span>
                    </div>
                    <div className="keyboardShortcutItem">
                      <kbd className="keyboardShortcutKey">↑</kbd>
                      <kbd className="keyboardShortcutKey">↓</kbd>
                      <span className="keyboardShortcutDescription">Navigate Torrent List</span>
                    </div>
                  </div>
                </div>
              </div>
            </Modal>

            <FileSelectionDialog
              isOpen={showFileSelectionDialog}
              onClose={() => {
                // If user closes dialog, torrent is still added but not started
                // User can manually start it later from the torrent list
                setShowFileSelectionDialog(false);
                // Clear pending ref to allow reopening
                pendingDialogOpenRef.current = null;
                if (dialogOpenTimeoutRef.current) {
                  clearTimeout(dialogOpenTimeoutRef.current);
                  dialogOpenTimeoutRef.current = null;
                }
                // Only clear pending state when user explicitly closes, not during confirm
                setPendingTorrentId(null);
                setPendingTorrentName("");
              }}
              torrentId={pendingTorrentId}
              torrentName={pendingTorrentName}
              torrentSize={pendingTorrentId ? torrentStatuses.get(pendingTorrentId)?.total_bytes : undefined}
              onConfirm={async (selectedFiles, startImmediately) => {
                if (!pendingTorrentId) return;

                const torrentIdToStart = pendingTorrentId; // Capture for cleanup
                const idToRefresh = torrentIdToStart;

                try {
                  // Close dialog first to prevent further interactions
                  setShowFileSelectionDialog(false);
                  // Clear pending ref
                  pendingDialogOpenRef.current = null;
                  if (dialogOpenTimeoutRef.current) {
                    clearTimeout(dialogOpenTimeoutRef.current);
                    dialogOpenTimeoutRef.current = null;
                  }
                  // Clear pending state after capturing values
                  setPendingTorrentId(null);
                  setPendingTorrentName("");

                  // Small delay to ensure file priorities are fully persisted before starting
                  // This is important for the daemon to apply priorities correctly
                  if (startImmediately && selectedFiles.length > 0) {
                    await new Promise((resolve) => setTimeout(resolve, 200));
                  }

                  if (startImmediately) {
                    // Start the torrent after file selection and priority setting
                    try {
                      await postJson(`/torrents/${torrentIdToStart}/start`, {});

                      // Wait a moment for the torrent to initialize and begin downloading
                      await new Promise((resolve) => setTimeout(resolve, 500));

                      pushToast(
                        "info",
                        selectedFiles.length > 0
                          ? `Torrent started with ${selectedFiles.length} selected file(s)`
                          : "Torrent started"
                      );

                      // Refresh the specific torrent status immediately to show progress
                      try {
                        await refreshStatus(idToRefresh);
                      } catch {
                        // Ignore status refresh errors - not critical
                      }
                    } catch (startError) {
                      const startMessage = startError instanceof Error ? startError.message : "Failed to start torrent";
                      pushToast("error", startMessage);

                      // Check if it's a disk space error and show specific message
                      const errorLower = startMessage.toLowerCase();
                      if (
                        errorLower.includes("disk space") ||
                        errorLower.includes("insufficient") ||
                        errorLower.includes("not enough space")
                      ) {
                        pushToast("error", "Insufficient disk space. Please free up space and try again.");
                      }
                      throw startError; // Re-throw to prevent showing success message
                    }
                  } else {
                    pushToast(
                      "info",
                      selectedFiles.length > 0
                        ? `Torrent added with ${selectedFiles.length} selected file(s). Click Start to begin downloading.`
                        : "Torrent added. Click Start to begin downloading."
                    );
                  }

                  // Refresh torrent list and status
                  refreshAll();
                } catch (e: unknown) {
                  // Error toast already shown above for start errors
                  if (!startImmediately) {
                    pushToast("error", getErrorMessage(e, "Failed to process torrent"));
                  }
                }
              }}
              onError={(msg) => pushToast("error", msg)}
              enforceMediaPolicy={isAnimusEdition}
            />
          </div>
        </DropZone>
      </ErrorBoundary>
    </BootGate>
  );
}
