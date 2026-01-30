/// <reference types="../vite-env.d.ts" />
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./styles.css";
import {
  Toast,
  ErrorBoundary,
  Modal,
  AddTorrent,
  FileSelectionDialog,
  BootGate,
  Spinner,
  DropZone,
  type DaemonHealthState,
} from "../components";
import {
  AppShell,
  NavigationRail,
  MainLayout,
  StatusBar,
  type StatusFilter,
  type SmartView,
} from "./layout";
import { TorrentPortfolio } from "../components/torrents";
import { TorrentInspector } from "../components/inspector";
import { NetworkPostureCenter } from "../components/network";
import { PrivacyKillSwitchDrawer, NetworkPage, EventsPage, SecuritySettings, DaemonControl, NotificationSoundSettings } from "../components";
import type {
  Torrent,
  TorrentStatus,
  WalletStatus,
  OverlayStatus,
  NetPosture,
  Health,
  Version,
  Toast as ToastType,
  VpnStatus,
  KillSwitchConfig,
  TorrentEvent,
} from "../types";
import { getJson, postJson } from "../utils/api";
import { getVpnStatusBestEffort } from "../lib/net/vpn";
import { showTorrentCompleteNotification, showKillSwitchNotification, showKillSwitchReleasedNotification, setNotificationSoundUrl } from "../utils/notifications";
import { useDebounce } from "../utils/useDebounce";
import { useKeyboardShortcuts, type KeyboardShortcut } from "../utils/keyboard";
import { getErrorMessage, isApiError } from "../utils/errorHandling";
import { logger } from "../utils/logger";
import { createEvent, addEvent } from "../utils/eventService";

export default function App() {
  const [mounted, setMounted] = useState(false);
  const [online, setOnline] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [version, setVersion] = useState<string>("—");
  const [daemonLogPath, setDaemonLogPath] = useState<string | null>(null);

  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [torrentStatuses, setTorrentStatuses] = useState<Map<string, TorrentStatus>>(new Map());

  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [overlay, setOverlay] = useState<OverlayStatus | null>(null);

  const [netPosture, setNetPosture] = useState<NetPosture | null>(null);
  const [netifs, setNetifs] = useState<string[]>([]);
  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);
  const [killSwitch, setKillSwitch] = useState<KillSwitchConfig | null>(null);

  const [toast, setToast] = useState<ToastType | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [events, setEvents] = useState<TorrentEvent[]>([]);
  const pushEvent = useCallback((event: TorrentEvent) => {
    setEvents((prev) => addEvent(prev, event));
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebounce(searchQuery, 300);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [downloadsFilter, setDownloadsFilter] = useState<"all" | "downloading" | "seeding" | "completed" | "error">("all");
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [showAddTorrentModal, setShowAddTorrentModal] = useState(false);
  const [showKillSwitchDrawer, setShowKillSwitchDrawer] = useState(false);
  const [showFileSelectionDialog, setShowFileSelectionDialog] = useState(false);
  const [showFileFoundModal, setShowFileFoundModal] = useState(false);
  const [fileFoundTorrentId, setFileFoundTorrentId] = useState<string | null>(null);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const [pendingTorrentId, setPendingTorrentId] = useState<string | null>(null);
  const [pendingTorrentName, setPendingTorrentName] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<"torrents" | "network" | "settings" | "events">("torrents");
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState(false);
  const [loadingOperations, setLoadingOperations] = useState<Set<string>>(new Set());
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const isRefreshing = useRef<boolean>(false);
  const debouncedRefreshAll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshTime = useRef<number>(0);
  const [daemonHealthState, setDaemonHealthState] = useState<DaemonHealthState>("offline");
  const prevTorrentStates = useRef<Map<string, "stopped" | "downloading" | "seeding" | "checking" | "error">>(new Map());
  const prevNetPostureState = useRef<NetPosture["state"] | null>(null);
  const notifiedTorrents = useRef<Set<string>>(new Set());
  const killSwitchNotified = useRef<boolean>(false);
  const prevVpnStatus = useRef<VpnStatus | null>(null);
  const vpnKillSwitchActive = useRef<boolean>(false);
  const hasAutoResumed = useRef<boolean>(false);
  const wasOnline = useRef<boolean>(false);
  const pendingDialogOpenRef = useRef<string | null>(null);
  const dialogOpenTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedTorrent = useMemo(() => {
    if (selectedIds.size === 1) {
      const id = Array.from(selectedIds)[0];
      return torrents.find(t => t.id === id) ?? null;
    }
    return null;
  }, [torrents, selectedIds]);

  const pushToast = useCallback((kind: "error" | "info", msg: string) => {
    setToast({ kind, msg });
    if (toastTimer.current) {
      clearTimeout(toastTimer.current);
      toastTimer.current = null;
    }
    toastTimer.current = setTimeout(() => {
      setToast(null);
      toastTimer.current = null;
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
    };
  }, []);

  const ping = useCallback(async () => {
    try {
      const h = await getJson<Health>("/health");
      setOnline(Boolean(h?.ok));
      setHealth(h);
      const v = await getJson<Version>("/version");
      setVersion(v?.version ?? "—");
      return true;
    } catch (_) {
      setOnline(false);
      setHealth(null);
      setVersion("—");
      return false;
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const ok = await ping();
    if (!ok) return;

    // Prevent concurrent refreshes
    if (isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      // Use enhanced fetcher for torrent list
      const { fetchTorrents, fetchTorrentStatuses } = await import("../utils/torrentFetcher");
      const torrents = await fetchTorrents({ retries: 2 });
      setTorrents(torrents);

      // Fetch statuses in parallel with batching
      // Use retries: 1 to handle transient errors without flickering
      const torrentIds = torrents.map(t => t.id);
      const statusMap = await fetchTorrentStatuses(torrentIds, { retries: 1, retryDelay: 200 });
      
      // Merge with existing statuses to prevent flickering - only update if we got a valid status
      setTorrentStatuses(prev => {
        const next = new Map(prev);
        // Only update statuses we successfully fetched - preserve existing ones for failed fetches
        statusMap.forEach((status, id) => {
          const existing = prev.get(id);
          // Stabilize state transitions - don't immediately switch from downloading to error
          if (existing && status.state === "error" && 
              (existing.state === "downloading" || existing.state === "seeding")) {
            // If we had a good state recently, keep it for a moment to prevent flickering
            // Only update to error if it persists across multiple fetches
            // For now, we'll still update but the cache layer will help stabilize
            next.set(id, status);
          } else {
            next.set(id, status);
          }
        });
        return next;
      });

      // Build status results for notification logic
      const statusResults = Array.from(statusMap.entries()).map(([id, status]) => {
        const torrent = torrents.find(t => t.id === id);
        return torrent ? { id, status, name: torrent.name } : null;
      }).filter(Boolean) as Array<{ id: string; status: TorrentStatus; name: string }>;

      const w = await getJson<WalletStatus>("/wallet");
      setWallet(w);
      const o = await getJson<OverlayStatus>("/overlay/status");
      setOverlay(o);
      const np = await getJson<NetPosture>("/net/posture");
      setNetPosture(np);
      
      // Fetch VPN status and kill switch from new endpoints
      try {
        const vpn = await getVpnStatusBestEffort();
        setVpnStatus(vpn);
      } catch (e) {
        if (np?.vpn_status) {
          setVpnStatus(np.vpn_status);
        }
      }
      
      try {
        const ks = await getJson<KillSwitchConfig>("/net/kill-switch");
        setKillSwitch(ks);
      } catch (e) {
        if (np?.kill_switch) {
          setKillSwitch(np.kill_switch);
        }
      }

      // Check for torrent completion transitions
      for (const result of statusResults) {
        if (!result) continue;
        const { id, status, name } = result;
        const prevState = prevTorrentStates.current.get(id);
        const currentState = status.state;

        if (prevState === "downloading" && currentState === "seeding") {
          if (!notifiedTorrents.current.has(id)) {
            notifiedTorrents.current.add(id);
            showTorrentCompleteNotification(name, id).catch((err) => {
              logger.warn("Failed to show completion notification:", err);
            });
            // Generate torrent completed event
            pushEvent(createEvent("torrent_completed", "success", "Download completed", {
              torrentId: id,
              torrentName: name,
            }));
          }
        }
        // Track state changes for event history
        if (prevState && prevState !== currentState) {
          if (currentState === "error") {
            pushEvent(createEvent("torrent_error", "error", status.error || "Torrent encountered an error", {
              torrentId: id,
              torrentName: name,
              details: { previousState: prevState, error: status.error },
            }));
          } else if (currentState === "downloading" && prevState === "stopped") {
            pushEvent(createEvent("torrent_started", "info", "Torrent started downloading", {
              torrentId: id,
              torrentName: name,
            }));
          } else if (currentState === "seeding" && prevState === "stopped") {
            pushEvent(createEvent("torrent_started", "info", "Torrent started seeding", {
              torrentId: id,
              torrentName: name,
            }));
          } else if (currentState === "stopped" && (prevState === "downloading" || prevState === "seeding")) {
            pushEvent(createEvent("torrent_stopped", "info", "Torrent stopped", {
              torrentId: id,
              torrentName: name,
            }));
          } else if (currentState === "checking") {
            pushEvent(createEvent("piece_verified", "info", "Verifying torrent pieces", {
              torrentId: id,
              torrentName: name,
            }));
          }
        }
        prevTorrentStates.current.set(id, currentState);
      }

      const currentTorrentIds = new Set(torrents.map(t => t.id));
      for (const [id] of prevTorrentStates.current) {
        if (!currentTorrentIds.has(id)) {
          prevTorrentStates.current.delete(id);
          notifiedTorrents.current.delete(id);
        }
      }

      // Check for kill switch activation
      if (np) {
        const prevState = prevNetPostureState.current;
        const currentState = np.state;

        if (
          np.leak_proof_enabled &&
          prevState === "protected" &&
          (currentState === "leak_risk" || currentState === "unconfigured")
        ) {
          if (!killSwitchNotified.current) {
            killSwitchNotified.current = true;
            showKillSwitchNotification().catch((err) => {
              logger.warn("Failed to show kill switch notification:", err);
            });
            // Generate kill switch event
            pushEvent(createEvent("vpn_kill_switch", "warning", "Network posture changed to leak risk", {
              details: { previousState: prevState, currentState },
            }));
          }
        } else if (currentState === "protected") {
          killSwitchNotified.current = false;
        }
        prevNetPostureState.current = currentState;
      }
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to refresh data"));
    } finally {
      isRefreshing.current = false;
    }
  }, [ping, pushToast, pushEvent]);

  const refreshStatus = useCallback(async (id: string) => {
    try {
      // Use cached fetcher to prevent flickering from transient errors
      const { fetchTorrentStatus } = await import("../utils/torrentFetcher");
      const s = await fetchTorrentStatus(id, { retries: 1, retryDelay: 200 });
      setStatus(s);
      // Also update the status map
      setTorrentStatuses(prev => {
        const next = new Map(prev);
        next.set(id, s);
        return next;
      });
    } catch (e) {
      // Only clear status if it's a persistent error (4xx), not transient network issues
      const error = e instanceof Error ? e : new Error(String(e));
      if (isApiError(error)) {
        if (error.status !== undefined && error.status >= 400 && error.status < 500) {
          // Persistent error - clear status
          setStatus(null);
        }
        // For transient errors (network/timeout), keep previous status to prevent flickering
      } else {
        // Unknown error - keep previous status to prevent flickering
        logger.warn(`Failed to refresh status for torrent ${id}:`, error.message);
      }
    }
  }, []);

  const handleTorrentSelect = useCallback((id: string, multi: boolean) => {
    setSelectedIds(prev => {
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

  const handleTorrentAdded = useCallback(async (id: string, showFileDialog: boolean = false, torrentName?: string) => {
    setSelectedIds(new Set([id]));
    // Generate torrent added event
    pushEvent(createEvent("torrent_added", "info", "Torrent added to client", {
      torrentId: id,
      torrentName: torrentName || "Unknown",
    }));
    // Don't await refreshAll() - do it in background to avoid blocking UI
    refreshAll().catch(err => logger.errorWithPrefix("App", "Failed to refresh torrents:", err));
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
          const alreadyPresent = status && (status.state === "downloading" || status.state === "seeding") && status.downloaded_bytes > 0;
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
  }, [refreshAll, refreshStatus, pendingTorrentId, pushEvent]);

  const addMagnetLink = useCallback(async (magnetUrl: string) => {
    if (!online) {
      pushToast("error", "Cannot add torrent: daemon not connected");
      return;
    }
    try {
      // Use longer timeout for magnet links (30 seconds) as daemon may need to fetch metadata
      const res = await postJson<{ id: string }>("/torrents", {
        magnet: magnetUrl,
        name_hint: "magnet"
      }, 30000);
      if (!res?.id) {
        pushToast("error", "Daemon rejected torrent add request");
        return;
      }
      handleTorrentAdded(res.id);
      pushToast("info", "Torrent added from magnet link. File selection will be available after metadata is fetched.");
      // For magnet links, don't show file selection dialog immediately (files not available yet)
      // User can select files later once metadata is fetched
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to add torrent from magnet link"));
    }
  }, [online, handleTorrentAdded, pushToast]);

  // Handle dropped torrent file
  const handleDroppedFile = useCallback(async (file: File) => {
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
      const { infoHashFromTorrentBytes } = await import("../lib/infoHash");
      const hash = await infoHashFromTorrentBytes(bytes);
      if (hash) {
        const listRes = await getJson<{ items: Torrent[] }>("/torrents");
        const existing = listRes.items.find(t =>
          t.info_hash_hex?.toLowerCase() === hash.toLowerCase()
        );
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
      const res = await postJson<{ id: string }>("/torrents", {
        torrent_b64: b64,
        name_hint: file.name
      }, 60000);
      
      if (!res?.id) {
        pushToast("error", "Daemon rejected torrent add request");
        return;
      }
      
      handleTorrentAdded(res.id, true);
      pushToast("info", `Torrent added: ${file.name}`);
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to add dropped torrent file"));
    }
  }, [online, handleTorrentAdded, pushToast]);

  // Bulk action handlers
  const handleBulkStop = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) return;
    const opId = "stop";
    setLoadingOperations(prev => new Set(prev).add(opId));
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/stop`, {}));
      await Promise.all(promises);
      pushToast("info", `Stopped ${ids.length} torrent(s)`);
      refreshAll();
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to stop torrent(s)"));
    } finally {
      setLoadingOperations(prev => {
        const next = new Set(prev);
        next.delete(opId);
        return next;
      });
    }
  }, [online, pushToast, refreshAll]);

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

  // Fetch VPN status and kill switch periodically (every 500ms for instant detection)
  useEffect(() => {
    const fetchVpnAndKillSwitch = async () => {
      if (!online) return;
      try {
        const [vpn, ks] = await Promise.all([
          getVpnStatusBestEffort().catch(() => null),
          getJson<KillSwitchConfig>("/net/kill-switch").catch(() => null),
        ]);
        if (vpn) setVpnStatus(vpn);
        if (ks) setKillSwitch(ks);
      } catch (err) {
        logger.errorWithPrefix("App", "Failed to fetch VPN/kill switch status:", err);
      }
    };

    // Fetch immediately
    fetchVpnAndKillSwitch();

    // Poll every 2000ms for VPN status (reduced from 500ms to improve performance)
    // VPN status changes are typically not instantaneous, 2s is sufficient
    const interval = setInterval(fetchVpnAndKillSwitch, 2000);
    return () => clearInterval(interval);
  }, [online]);

  // Monitor VPN disconnection for kill switch
  useEffect(() => {
    // Use kill switch enabled from kill switch config if available, otherwise from netPosture
    const killSwitchEnabled = killSwitch?.enabled ?? netPosture?.leak_proof_enabled ?? false;
    
    if (!killSwitchEnabled) {
      vpnKillSwitchActive.current = false;
      prevVpnStatus.current = vpnStatus;
      return;
    }

    // Check VPN connection status - use posture and connection_type for accurate detection
    // Only consider it connected if it's actually a VPN (not Tor/I2P)
    // Initialize prevVpnStatus on first run to prevent false disconnection detection
    const wasConnected = prevVpnStatus.current 
      ? (prevVpnStatus.current.posture === "connected" 
         && (prevVpnStatus.current.connection_type === "vpn" || prevVpnStatus.current.detected === true))
      : false;
    const isConnected = vpnStatus?.posture === "connected" 
      && (vpnStatus?.connection_type === "vpn" || vpnStatus?.detected === true);

    // VPN disconnected while kill switch is on
    if (wasConnected && !isConnected && killSwitchEnabled) {
      vpnKillSwitchActive.current = true;
      // Stop all running torrents
      const runningIds = torrents
        .filter(t => {
          const status = torrentStatuses.get(t.id);
          return status && (status.state === "downloading" || status.state === "seeding");
        })
        .map(t => t.id);
      if (runningIds.length > 0) {
        handleBulkStop(runningIds).catch((err) => {
          logger.errorWithPrefix("App", "Failed to stop torrents on VPN disconnect:", err);
        });
        pushToast("error", `VPN disconnected: ${runningIds.length} torrent(s) stopped (kill switch active)`);
        const detail = `VPN disconnected — ${runningIds.length} torrent(s) stopped.`;
        showKillSwitchNotification(detail).catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
        pushEvent(createEvent("vpn_kill_switch", "error", `VPN disconnected - ${runningIds.length} torrent(s) stopped`, {
          details: { stoppedTorrents: runningIds.length },
        }));
      } else {
        pushToast("error", "VPN disconnected (kill switch active)");
        showKillSwitchNotification().catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
        pushEvent(createEvent("vpn_kill_switch", "error", "VPN disconnected - kill switch activated"));
      }
    }

    // VPN reconnected
    if (!wasConnected && isConnected && vpnKillSwitchActive.current) {
      vpnKillSwitchActive.current = false;
      pushToast("info", "VPN reconnected: You can now resume torrents");
      showKillSwitchReleasedNotification().catch((err) => {
        logger.warn("Failed to show kill switch released notification:", err);
      });
      pushEvent(createEvent("vpn_kill_switch", "success", "VPN reconnected - kill switch released"));
    }

    prevVpnStatus.current = vpnStatus;
  }, [vpnStatus, killSwitch?.enabled, netPosture?.leak_proof_enabled, torrents, torrentStatuses, handleBulkStop, pushToast, pushEvent]);

  // Mark as mounted once component loads
  useEffect(() => {
    setMounted(true);
    
    // Ensure body has js-loaded class
    if (document.body) {
      document.body.classList.add('js-loaded');
    }

    // Fetch daemon log path
    if (window.orc?.daemon?.getLogPath) {
      window.orc.daemon.getLogPath().then((path: string | null) => {
        setDaemonLogPath(path);
      }).catch(() => {
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

  // Load custom notification sound URL on app init so notifications use it
  useEffect(() => {
    if (typeof window.orc?.notificationSound?.getUrl !== "function") return;
    window.orc.notificationSound.getUrl().then((url) => {
      setNotificationSoundUrl(url);
    }).catch(() => {});
  }, []);

  // Compute overall daemon health state with detailed status
  const daemonHealthDetails = useMemo(() => {
    if (!online) {
      return "Daemon offline - Connecting...";
    }

    const errorCount = Array.from(torrentStatuses.values()).filter(
      status => status.state === "error"
    ).length;

    if (errorCount > 0) {
      return `${errorCount} torrent(s) with errors - Click for details`;
    }
    

    const uptime = health?.uptime_sec ? Math.floor(health.uptime_sec / 60) : 0;
    return `Daemon healthy - Uptime: ${uptime} minutes, ${torrents.length} torrent(s)`;
  }, [online, torrentStatuses, health, torrents.length]);

  // Update daemon health state when dependencies change
  useEffect(() => {
    if (!online) {
      setDaemonHealthState("offline");
      return;
    }

    // Check for torrent errors
    const hasErrors = Array.from(torrentStatuses.values()).some(
      status => status.state === "error"
    );

    // Determine health state
    if (hasErrors) {
      setDaemonHealthState("error");
    } else {
      setDaemonHealthState("healthy");
    }
  }, [online, torrentStatuses]);

  // Refresh VPN status more frequently for real-time updates
  const refreshVpnStatus = useCallback(async () => {
    if (!online) return;
    try {
      const vpn = await getVpnStatusBestEffort();
      setVpnStatus(vpn);
    } catch (e) {
    }
  }, [online]);

  // Debounced refresh function to prevent excessive API calls
  const MIN_REFRESH_INTERVAL_MS = 1000; // Minimum 1 second between refreshes

  const scheduleRefresh = useCallback(() => {
    // Prevent concurrent refreshes
    if (isRefreshing.current) return;
    
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime.current;
    
    // Clear any pending refresh
    if (debouncedRefreshAll.current) {
      clearTimeout(debouncedRefreshAll.current);
      debouncedRefreshAll.current = null;
    }
    
    // If enough time has passed, refresh immediately
    if (timeSinceLastRefresh >= MIN_REFRESH_INTERVAL_MS) {
      lastRefreshTime.current = now;
      isRefreshing.current = true;
      refreshAll().finally(() => {
        isRefreshing.current = false;
      });
    } else {
      // Otherwise, schedule a debounced refresh
      const delay = MIN_REFRESH_INTERVAL_MS - timeSinceLastRefresh;
      debouncedRefreshAll.current = setTimeout(() => {
        lastRefreshTime.current = Date.now();
        isRefreshing.current = true;
        refreshAll().finally(() => {
          isRefreshing.current = false;
        });
        debouncedRefreshAll.current = null;
      }, delay);
    }
  }, [refreshAll]);

  useEffect(() => {
    // When offline, check more frequently (every 500ms) to detect when daemon comes online quickly
    // When online, use normal refresh interval (2s) for smooth progress updates
    const interval = online ? 2000 : 500;
    
    const t = setInterval(() => {
      // Always ping to check connection status
      ping().then((isOnline) => {
        // If we just came online, refresh all data immediately
        if (isOnline && !online) {
          lastRefreshTime.current = Date.now();
          refreshAll();
        } else if (online) {
          // If already online, use debounced refresh to prevent excessive calls
          scheduleRefresh();
        }
      });
    }, interval);
    
    // Initial refresh if online
    if (online) {
      lastRefreshTime.current = Date.now();
      refreshAll();
    }
    
    return () => {
      clearInterval(t);
      if (debouncedRefreshAll.current) {
        clearTimeout(debouncedRefreshAll.current);
        debouncedRefreshAll.current = null;
      }
    };
  }, [ping, scheduleRefresh, refreshAll, online]);

  // VPN status is already polled by fetchVpnAndKillSwitch every 2s
  // Only need to refresh on window focus for immediate update when user switches VPNs
  useEffect(() => {
    const handleFocus = () => {
      if (online) {
        refreshVpnStatus();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshVpnStatus, online]);

  // Auto-resume torrents when GUI connects to daemon (unless kill switch is engaged)
  useEffect(() => {
    const justCameOnline = online && !wasOnline.current;
    wasOnline.current = online;
    
    // Only auto-resume once per session and when we just connected
    if (!justCameOnline || hasAutoResumed.current) {
      return;
    }
    
    // Wait for kill switch status to be fetched before deciding
    if (killSwitch === null) {
      return;
    }
    
    // Check if kill switch is engaged - if so, don't auto-resume
    const killSwitchEngaged = killSwitch?.enabled && 
      (killSwitch?.enforcement_state === "engaged" || killSwitch?.enforcement_state === "armed");
    
    const vpnRequired = killSwitch?.enabled && !vpnStatus?.detected;
    
    if (killSwitchEngaged || vpnRequired) {
      logger.logWithPrefix("Auto-Resume", "Kill switch is engaged or VPN required but not connected, skipping auto-resume");
      hasAutoResumed.current = true; // Mark as done even if we didn't resume
      if (vpnRequired) {
        pushToast("info", "Torrents paused: VPN required but not connected (kill switch active)");
      }
      return;
    }
    
    // Find all stopped torrents that could be resumed
    const stoppedIds = torrents
      .filter(t => {
        const status = torrentStatuses.get(t.id);
        return status && status.state === "stopped";
      })
      .map(t => t.id);
    
    if (stoppedIds.length > 0) {
      logger.logWithPrefix("Auto-Resume", `Auto-resuming ${stoppedIds.length} stopped torrent(s)`);
      hasAutoResumed.current = true;
      
      // Start all stopped torrents
      Promise.all(stoppedIds.map(id => postJson(`/torrents/${id}/start`, {})))
        .then(() => {
          if (stoppedIds.length === 1) {
            pushToast("info", "Resumed 1 torrent automatically");
          } else {
            pushToast("info", `Resumed ${stoppedIds.length} torrents automatically`);
          }
          refreshAll();
        })
        .catch((err) => {
          logger.errorWithPrefix("Auto-Resume", "Failed to auto-resume torrents:", err);
          // Don't show error toast - it's not critical
        });
    } else {
      hasAutoResumed.current = true;
    }
  }, [online, torrents, torrentStatuses, killSwitch, vpnStatus, pushToast, refreshAll]);

  // Keyboard shortcuts
  const keyboardShortcuts = useMemo<KeyboardShortcut[]>(() => [
    {
      key: 'm',
      ctrl: true,
      handler: () => setShowAddTorrentModal(true),
      description: 'Add Magnet Link',
    },
    {
      key: 't',
      ctrl: true,
      handler: () => setShowAddTorrentModal(true),
      description: 'Add Torrent File',
    },
    {
      key: 'f',
      ctrl: true,
      handler: () => {
        const searchInput = document.querySelector<HTMLInputElement>('.searchInput');
        searchInput?.focus();
      },
      description: 'Focus Search',
    },
    {
      key: '?',
      ctrl: true,
      handler: () => setShowKeyboardShortcuts(prev => !prev),
      description: 'Show Keyboard Shortcuts',
    },
    {
      key: 'Escape',
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
        // Navigate back to main torrents page if on another page
        if (currentPage !== "torrents") {
          setCurrentPage("torrents");
        }
      },
      description: 'Close Modal/Drawer or Navigate Back',
    },
  ], [showAddTorrentModal, showKillSwitchDrawer, showFileSelectionDialog, showKeyboardShortcuts, currentPage]);

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
      logger.logWithPrefix("Torrent File", `Received torrent file from OS: ${data.fileName} (${(data.base64.length / 1024).toFixed(2)}KB base64)`);
      
      if (!currentOnline) {
        logger.warn("[Torrent File] Daemon not connected, will retry when effect re-runs");
        // Just show error - effect will re-run when online changes
        pushToast("error", "Cannot add torrent: daemon not connected. Please wait for the daemon to start and try again.");
        return;
      }
      
      let hash: string | null = null;
      try {
        // Check for duplicates by info hash
        const { infoHashFromTorrentBytes } = await import("../lib/infoHash");
        const bytes = Uint8Array.from(atob(data.base64), c => c.charCodeAt(0));
        hash = await infoHashFromTorrentBytes(bytes);
        if (hash) {
          // Refresh torrent list to get latest
          const listRes = await getJson<{ items: Torrent[] }>("/torrents");
          const existing = listRes.items.find(t => 
            t.info_hash_hex?.toLowerCase() === hash!.toLowerCase()
          );
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
        const res = await postJson<{ id: string }>("/torrents", {
          torrent_b64: data.base64,
          name_hint: data.fileName
        }, 60000); // 60 second timeout for file uploads
        
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
        if (message.toLowerCase().includes("already exists") || 
            message.toLowerCase().includes("file exists") ||
            message.toLowerCase().includes("duplicate")) {
          // Try to find existing torrent by hash
          if (hash) {
            try {
              const listRes = await getJson<{ items: Torrent[] }>("/torrents");
              const existing = listRes.items.find(t => 
                t.info_hash_hex?.toLowerCase() === hash!.toLowerCase()
              );
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

  useEffect(() => {
    if (selectedTorrent) {
      refreshStatus(selectedTorrent.id);
      const interval = online ? 2000 : 5000;
      const t = setInterval(() => refreshStatus(selectedTorrent.id), interval);
      return () => clearInterval(t);
    } else {
      setStatus(null);
    }
  }, [selectedTorrent, refreshStatus, online]);

  // Filter torrents for NavigationRail (legacy, kept for compatibility)
  const filteredTorrents = useMemo(() => {
    let filtered = torrents;

    // Apply search (use debounced query for filtering)
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.id.toLowerCase().includes(query)
      );
    }

    // Apply status filter (from NavigationRail)
    if (statusFilter !== "all") {
      filtered = filtered.filter(t => {
        const status = torrentStatuses.get(t.id);
        if (!status) return statusFilter === "paused";
        switch (statusFilter) {
          case "downloading":
            return status.state === "downloading";
          case "seeding":
            return status.state === "seeding";
          case "completed":
            return status.state === "seeding" && status.progress >= 1;
          case "checking":
            return status.state === "checking";
          case "paused":
            return status.state === "stopped";
          case "error":
            return status.state === "error";
          default:
            return true;
        }
      });
    }

    // Apply smart views
    if (smartView) {
      filtered = filtered.filter(t => {
        const status = torrentStatuses.get(t.id);
        
        switch (smartView) {
          case "high-risk":
            // High risk: error state or low health
            if (status?.state === "error") return true;
            // Calculate health score (same logic as TorrentTable)
            if (status) {
              let health = status.progress * 0.5;
              if (status.peers_seen > 0) health += 0.3;
              if (status.state === "seeding") health += 0.2;
              else if (status.state === "downloading" && status.down_rate_bps > 0) health += 0.1;
              return health < 0.5;
            }
            return false;
            
          case "private-mode":
            // Private mode: torrents with private or anonymous mode
            return t.profile.mode === "private" || t.profile.mode === "anonymous";
            
          case "vpn-required":
            return t.profile.mode === "private" || t.profile.mode === "anonymous";
            
          case "low-health":
            // Low health: health score < 0.5
            if (!status) return false;
            let health = status.progress * 0.5;
            if (status.peers_seen > 0) health += 0.3;
            if (status.state === "seeding") health += 0.2;
            else if (status.state === "downloading" && status.down_rate_bps > 0) health += 0.1;
            return health < 0.5;
            
          case "stalled":
            // Stalled: no progress, no peers, and not completed
            if (!status) return false;
            return status.progress === 0 && 
                   status.peers_seen === 0 && 
                   status.state !== "seeding" &&
                   status.down_rate_bps === 0;
            
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [torrents, debouncedSearchQuery, statusFilter, smartView, torrentStatuses]);

  // Calculate active torrent count for pause all
  const activeTorrentCount = useMemo(() => {
    return torrents.filter(t => {
      const status = torrentStatuses.get(t.id);
      return status && (status.state === "downloading" || status.state === "seeding");
    }).length;
  }, [torrents, torrentStatuses]);

  // Calculate paused torrent count for resume all
  const pausedTorrentCount = useMemo(() => {
    return torrents.filter(t => {
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

  const handleBulkStart = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) return;
    const opId = "start";
    setLoadingOperations(prev => new Set(prev).add(opId));
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/start`, {}));
      await Promise.all(promises);
      pushToast("info", `Started ${ids.length} torrent(s)`);
      refreshAll();
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to start torrent(s)"));
    } finally {
      setLoadingOperations(prev => {
        const next = new Set(prev);
        next.delete(opId);
        return next;
      });
    }
  }, [online, pushToast, refreshAll]);

  const handleBulkPause = useCallback(async (ids: string[]) => {
    // Pause is the same as stop
    await handleBulkStop(ids);
  }, [handleBulkStop]);

  // Pause all active torrents
  const handlePauseAll = useCallback(async () => {
    if (!online || activeTorrentCount === 0) return;
    const activeIds = torrents
      .filter(t => {
        const status = torrentStatuses.get(t.id);
        return status && (status.state === "downloading" || status.state === "seeding");
      })
      .map(t => t.id);
    if (activeIds.length > 0) {
      await handleBulkStop(activeIds);
      pushToast("info", `Paused all ${activeIds.length} active torrent(s)`);
    }
  }, [online, activeTorrentCount, torrents, torrentStatuses, handleBulkStop, pushToast]);

  // Resume all paused torrents
  const handleResumeAll = useCallback(async () => {
    if (!online || pausedTorrentCount === 0) return;
    const pausedIds = torrents
      .filter(t => {
        const status = torrentStatuses.get(t.id);
        return status && status.state === "stopped";
      })
      .map(t => t.id);
    if (pausedIds.length > 0) {
      await handleBulkStart(pausedIds);
      pushToast("info", `Resumed all ${pausedIds.length} paused torrent(s)`);
    }
  }, [online, pausedTorrentCount, torrents, torrentStatuses, handleBulkStart, pushToast]);

  const handleBulkRemove = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) return;
    const opId = "remove";
    setLoadingOperations(prev => new Set(prev).add(opId));
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/remove`, {}));
      await Promise.all(promises);
      pushToast("info", `Removed ${ids.length} torrent(s)`);
      refreshAll();
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to remove torrent(s)"));
    } finally {
      setLoadingOperations(prev => {
        const next = new Set(prev);
        next.delete(opId);
        return next;
      });
    }
  }, [online, pushToast, refreshAll]);

  // Firewall prompt handlers

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
        pushToast("info", `Daemon healthy - Uptime: ${health?.uptime_sec ? Math.floor(health.uptime_sec / 60) : 0} minutes`);
        break;
    }
  }, [daemonHealthState, health, pushToast]);


  return (
    <BootGate>
      <ErrorBoundary fallback={null}>
        <DropZone
        onFileDrop={handleDroppedFile}
        onMagnetDrop={addMagnetLink}
        disabled={!online}
      >
      {isShuttingDown && (
        <div className="shutdown-overlay">
          <div className="shutdown-overlay-content">
            <Spinner size={72} />
            <div className="shutdown-title"><span className="shutdown-title-orc">ORC</span> TORRENT</div>
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
        <AppShell
          online={online}
          version={version}
          health={health}
          daemonHealthState={daemonHealthState}
          daemonHealthDetails={daemonHealthDetails}
          vpnStatus={vpnStatus}
          killSwitchState={killSwitch?.enforcement_state ?? "disarmed"}
          onVpnLedClick={() => setShowKillSwitchDrawer(true)}
          onHealthClick={handleHealthClick}
          onRefresh={refreshAll}
          onAddMagnet={() => setShowAddTorrentModal(true)}
          onAddTorrent={() => setShowAddTorrentModal(true)}
          onStart={() => {
            const opId = "start";
            setLoadingOperations(prev => new Set(prev).add(opId));
            handleBulkStart(Array.from(selectedIds)).finally(() => {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            });
          }}
          onPause={() => {
            const opId = "stop";
            setLoadingOperations(prev => new Set(prev).add(opId));
            handleBulkPause(Array.from(selectedIds)).finally(() => {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            });
          }}
          onStop={() => {
            const opId = "stop";
            setLoadingOperations(prev => new Set(prev).add(opId));
            handleBulkStop(Array.from(selectedIds)).finally(() => {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            });
          }}
          onRemove={() => {
            const opId = "remove";
            setLoadingOperations(prev => new Set(prev).add(opId));
            handleBulkRemove(Array.from(selectedIds)).finally(() => {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            });
          }}
          loadingOperations={loadingOperations}
          onForceRecheck={async () => {
            if (!online || selectedIds.size === 0) {
              pushToast("info", "Select torrent(s) to force recheck");
              return;
            }
            const opId = "recheck";
            setLoadingOperations(prev => new Set(prev).add(opId));
            try {
              const promises = Array.from(selectedIds).map(id => postJson(`/torrents/${id}/recheck`, {}));
              await Promise.all(promises);
              pushToast("info", `Force recheck initiated for ${selectedIds.size} torrent(s)`);
              refreshAll();
            } catch (e: unknown) {
              pushToast("error", getErrorMessage(e, "Failed to force recheck"));
            } finally {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            }
          }}
          onForceAnnounce={async () => {
            if (!online || selectedIds.size === 0) {
              pushToast("info", "Select torrent(s) to force announce");
              return;
            }
            const opId = "announce";
            setLoadingOperations(prev => new Set(prev).add(opId));
            try {
              const promises = Array.from(selectedIds).map(id => postJson(`/torrents/${id}/announce`, {}));
              await Promise.all(promises);
              pushToast("info", `Force announce initiated for ${selectedIds.size} torrent(s)`);
              refreshAll();
            } catch (e: unknown) {
              pushToast("error", getErrorMessage(e, "Failed to force announce"));
            } finally {
              setLoadingOperations(prev => {
                const next = new Set(prev);
                next.delete(opId);
                return next;
              });
            }
          }}
          onSettings={() => setCurrentPage("settings")}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
        />

        {!online && (
          <div className="banner" style={{ 
            padding: "16px 24px", 
            background: "rgba(255, 255, 255, 0.05)", 
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            color: "var(--text)"
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "16px" }}>
              <Spinner size={40} />
              <div style={{ flex: 1 }}>
                <div className="bannerTitle" style={{ fontWeight: 600, marginBottom: "8px" }}>
                  Connecting to daemon...
                </div>
                <div className="bannerBody" style={{ fontSize: "13px", opacity: 0.8, marginBottom: "12px" }}>
                  The application is starting the daemon process. If this message persists, please check the log file for errors.
                </div>
                {daemonLogPath && (
                  <div style={{ fontSize: "12px", opacity: 0.7, marginBottom: "8px", fontFamily: "monospace", wordBreak: "break-all" }}>
                    Log: {daemonLogPath}
                  </div>
                )}
                {window.orc?.daemon?.openLog && (
                  <button
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
                    style={{
                      padding: "6px 12px",
                      fontSize: "12px",
                      background: "rgba(255, 255, 255, 0.1)",
                      border: "1px solid rgba(255, 255, 255, 0.2)",
                      borderRadius: "4px",
                      color: "var(--text)",
                      cursor: "pointer",
                      transition: "background 0.2s"
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.15)";
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
                    }}
                  >
                    Open Log File Location
                  </button>
                )}
              </div>
            </div>
          </div>
        )}


        <MainLayout>
          <NavigationRail
            activeStatusFilter={statusFilter}
            onStatusFilterChange={(filter) => {
              setStatusFilter(filter);
              // Always ensure we're on torrents page when filtering
              if (currentPage !== "torrents") {
                setCurrentPage("torrents");
              }
            }}
            activeSmartView={smartView}
            onSmartViewChange={(view) => {
              setSmartView(view);
              // Always ensure we're on torrents page when using smart views
              if (currentPage !== "torrents") {
                setCurrentPage("torrents");
              }
            }}
            labels={labels}
            onLabelClick={(label) => {
              pushToast("info", `Filtering by label: ${label}`);
              // Always ensure we're on torrents page when filtering by label
              if (currentPage !== "torrents") {
                setCurrentPage("torrents");
              }
            }}
            watchFoldersCount={0}
            onWatchFoldersClick={() => pushToast("info", "Watch folders feature will be available in a future update")}
            currentPage={currentPage}
            onNetworkPageClick={() => {
              setCurrentPage(currentPage === "network" ? "torrents" : "network");
            }}
            onEventsPageClick={() => {
              setCurrentPage(currentPage === "events" ? "torrents" : "events");
            }}
            onSettingsPageClick={() => {
              setCurrentPage(currentPage === "settings" ? "torrents" : "settings");
            }}
          />
          <div className="mainContent" id="main-content" role="main">
            {currentPage === "settings" ? (
              <div className="settingsPage">
                <div className="settingsPageHeader">
                  <button
                    className="btn ghost"
                    onClick={() => setCurrentPage("torrents")}
                    title="Back to Main Menu"
                  >
                    ← Back to Main Menu
                  </button>
                </div>
                <div className="settingsPageContent">
                  <div className="settingsSectionCard">
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
                  <div className="settingsSectionCard">
                    <h2 className="settingsSectionCardTitle">Security</h2>
                    <div className="settingsSection">
                      <SecuritySettings
                        online={online}
                        onError={(msg) => pushToast("error", msg)}
                        onSuccess={(msg) => pushToast("info", msg)}
                      />
                    </div>
                  </div>
                  <div className="settingsSectionCard">
                    <h2 className="settingsSectionCardTitle">Notifications</h2>
                    <div className="settingsSection">
                      <NotificationSoundSettings
                        onError={(msg) => pushToast("error", msg)}
                        onSuccess={(msg) => pushToast("info", msg)}
                      />
                    </div>
                  </div>
                  <div className="settingsSectionCard">
                    <h2 className="settingsSectionCardTitle">Daemon</h2>
                    <div className="settingsSection">
                      <DaemonControl
                        online={online}
                        onError={(msg) => pushToast("error", msg)}
                        onSuccess={(msg) => pushToast("info", msg)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ) : currentPage === "events" ? (
              <EventsPage
                events={events}
                online={online}
                onBack={() => setCurrentPage("torrents")}
                onClearEvents={clearEvents}
              />
            ) : currentPage === "torrents" ? (
              <>
                <TorrentPortfolio
                  torrents={torrents}
                  statuses={torrentStatuses}
                  selectedIds={selectedIds}
                  onSelect={handleTorrentSelect}
                  onStart={handleBulkStart}
                  onPause={handleBulkPause}
                  onStop={handleBulkStop}
                  onRemove={handleBulkRemove}
                  onSetPriority={(ids, priority) => pushToast("info", `Setting priority ${priority} for ${ids.length} torrent(s)`)}
                  onMoveData={(ids) => pushToast("info", `Moving data for ${ids.length} torrent(s)`)}
                  onExportTorrent={(ids) => pushToast("info", `Exporting ${ids.length} torrent(s)`)}
                  onSetLimits={(ids) => pushToast("info", `Setting limits for ${ids.length} torrent(s)`)}
                  onApplyLabel={(ids, label) => pushToast("info", `Applying label ${label} to ${ids.length} torrent(s)`)}
                  onSetVpnPolicy={(ids, policy) => pushToast("info", `Setting VPN policy ${policy} for ${ids.length} torrent(s)`)}
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
                  onSpeedLimitToggle={() => {
                    setSpeedLimitEnabled(prev => {
                      const newValue = !prev;
                      pushToast("info", `Speed limits ${newValue ? "enabled" : "disabled"}. API endpoint will be available in a future update.`);
                      return newValue;
                    });
                  }}
                />
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
              </>
            ) : (
              <NetworkPage
                online={online}
                vpnStatus={vpnStatus}
                killSwitch={killSwitch}
                onError={(msg) => pushToast("error", msg)}
                onBack={() => setCurrentPage("torrents")}
              />
            )}
          </div>
        </MainLayout>


        <StatusBar
          globalUpSpeed={globalStats.up}
          globalDownSpeed={globalStats.down}
          dhtStatus="enabled"
          pexStatus="enabled"
          lsdStatus="enabled"
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
          version={version}
        />

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

        <Toast toast={toast} onClose={() => setToast(null)} />

        <Modal
          isOpen={showAddTorrentModal}
          onClose={() => setShowAddTorrentModal(false)}
          title="Add Torrent"
        >
          <AddTorrent
            online={online}
            wallet={wallet}
            torrents={torrents}
            onTorrentAdded={async (id, showFileDialog) => {
              // Don't await - handleTorrentAdded is now non-blocking
              handleTorrentAdded(id, showFileDialog).catch(err => {
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
                await new Promise(resolve => setTimeout(resolve, 200));
              }
              
              if (startImmediately) {
                // Start the torrent after file selection and priority setting
                try {
                  await postJson(`/torrents/${torrentIdToStart}/start`, {});
                  
                  // Wait a moment for the torrent to initialize and begin downloading
                  await new Promise(resolve => setTimeout(resolve, 500));
                  
                  pushToast("info", selectedFiles.length > 0 
                    ? `Torrent started with ${selectedFiles.length} selected file(s)` 
                    : "Torrent started");
                  
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
                  if (errorLower.includes("disk space") || errorLower.includes("insufficient") || errorLower.includes("not enough space")) {
                    pushToast("error", "Insufficient disk space. Please free up space and try again.");
                  }
                  throw startError; // Re-throw to prevent showing success message
                }
              } else {
                pushToast("info", selectedFiles.length > 0
                  ? `Torrent added with ${selectedFiles.length} selected file(s). Click Start to begin downloading.`
                  : "Torrent added. Click Start to begin downloading.");
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
        />
      </div>
      </DropZone>
    </ErrorBoundary>
    </BootGate>
  );
}
