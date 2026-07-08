import { useCallback, useEffect, useRef, useState } from "react";
import type { Torrent, TorrentStatus, WalletStatus, OverlayStatus } from "../types";
import { getJson } from "../utils/api";
import { getSearchSettings } from "../utils/searchApi";
import { searchSettingsEqual } from "../utils/searchUtils";
import { getErrorMessage, isApiError } from "../utils/errorHandling";
import { logger } from "../utils/logger";
import { MIN_REFRESH_INTERVAL_MS } from "../utils/pollingController";
import type { TierIntervals } from "../utils/pollingController";
import type { SearchFeatureSettings } from "../types";

export interface UseTorrentDataOptions {
  online: boolean;
  ping: () => Promise<boolean>;
  intervals: TierIntervals;
  pushToast: (kind: "error" | "info", msg: string) => void;
  processStatusUpdates: (
    statusResults: Array<{ id: string; status: TorrentStatus; name: string }>,
    currentTorrentIds: Set<string>
  ) => void;
  selectedTorrentId: string | null;
  onNetPosture: (np: import("../types").NetPosture) => void;
  onVpnFromPosture: (vpn: import("../types").VpnStatus) => void;
  onKillSwitchFromPosture: (ks: import("../types").KillSwitchConfig) => void;
}

export function useTorrentData({
  online,
  ping,
  intervals,
  pushToast,
  processStatusUpdates,
  selectedTorrentId,
  onNetPosture,
  onVpnFromPosture,
  onKillSwitchFromPosture,
}: UseTorrentDataOptions) {
  const [torrents, setTorrents] = useState<Torrent[]>([]);
  const [torrentStatuses, setTorrentStatuses] = useState<Map<string, TorrentStatus>>(new Map());
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [overlay, setOverlay] = useState<OverlayStatus | null>(null);
  const [searchSettings, setSearchSettings] = useState<SearchFeatureSettings | null>(null);

  const isRefreshing = useRef(false);
  const debouncedRefreshAll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshTime = useRef(0);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const refreshSearchSettings = useCallback(async () => {
    const nextSettings = await getSearchSettings();
    setSearchSettings((prev) => (searchSettingsEqual(prev, nextSettings) ? prev : nextSettings));
    return nextSettings;
  }, []);

  const refreshAll = useCallback(async () => {
    const ok = await ping();
    if (!ok) {
      setSearchSettings(null);
      return;
    }

    if (isRefreshing.current) return;
    isRefreshing.current = true;

    try {
      const { fetchTorrents, fetchTorrentStatuses } = await import("../utils/torrentFetcher");
      const nextTorrents = await fetchTorrents({ retries: 2 });
      setTorrents(nextTorrents);

      const torrentIds = nextTorrents.map((t) => t.id);
      const statusMap = await fetchTorrentStatuses(torrentIds, { retries: 1, retryDelay: 200 });

      setTorrentStatuses((prev) => {
        const next = new Map(prev);
        statusMap.forEach((s, id) => {
          next.set(id, s);
        });
        return next;
      });

      const statusResults = Array.from(statusMap.entries())
        .map(([id, s]) => {
          const torrent = nextTorrents.find((t) => t.id === id);
          return torrent ? { id, status: s, name: torrent.name } : null;
        })
        .filter(Boolean) as Array<{ id: string; status: TorrentStatus; name: string }>;

      const w = await getJson<WalletStatus>("/wallet");
      setWallet(w);
      const o = await getJson<OverlayStatus>("/overlay/status");
      setOverlay(o);
      const np = await getJson<import("../types").NetPosture>("/net/posture");
      onNetPosture(np);
      if (np?.vpn_status) onVpnFromPosture(np.vpn_status);
      if (np?.kill_switch) onKillSwitchFromPosture(np.kill_switch);

      try {
        await refreshSearchSettings();
      } catch (e) {
        logger.warn("Failed to refresh search settings:", e);
      }

      processStatusUpdates(statusResults, new Set(nextTorrents.map((t) => t.id)));
    } catch (e: unknown) {
      pushToast("error", getErrorMessage(e, "Failed to refresh data"));
    } finally {
      isRefreshing.current = false;
    }
  }, [
    ping,
    pushToast,
    processStatusUpdates,
    refreshSearchSettings,
    onNetPosture,
    onVpnFromPosture,
    onKillSwitchFromPosture,
  ]);

  const refreshStatus = useCallback(async (id: string) => {
    try {
      const { fetchTorrentStatus } = await import("../utils/torrentFetcher");
      const s = await fetchTorrentStatus(id, { retries: 1, retryDelay: 200 });
      setStatus(s);
      setTorrentStatuses((prev) => {
        const next = new Map(prev);
        next.set(id, s);
        return next;
      });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (isApiError(error)) {
        if (error.status !== undefined && error.status >= 400 && error.status < 500) {
          setStatus(null);
        }
      } else {
        logger.warn(`Failed to refresh status for torrent ${id}:`, error.message);
      }
    }
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (isRefreshing.current) return;

    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshTime.current;

    if (debouncedRefreshAll.current) {
      clearTimeout(debouncedRefreshAll.current);
      debouncedRefreshAll.current = null;
    }

    const runRefresh = () => {
      lastRefreshTime.current = Date.now();
      isRefreshing.current = true;
      refreshAll().finally(() => {
        isRefreshing.current = false;
      });
    };

    if (timeSinceLastRefresh >= MIN_REFRESH_INTERVAL_MS) {
      runRefresh();
    } else {
      const delay = MIN_REFRESH_INTERVAL_MS - timeSinceLastRefresh;
      debouncedRefreshAll.current = setTimeout(() => {
        runRefresh();
        debouncedRefreshAll.current = null;
      }, delay);
    }
  }, [refreshAll]);

  // Adaptive main polling loop
  useEffect(() => {
    const pollInterval = online ? intervals.mainRefresh : intervals.offlineDaemonPing;

    const t = setInterval(() => {
      ping().then((isOnline) => {
        if (isOnline && !onlineRef.current) {
          lastRefreshTime.current = Date.now();
          void refreshAll();
        } else if (onlineRef.current) {
          scheduleRefresh();
        }
      });
    }, pollInterval);

    if (online) {
      lastRefreshTime.current = Date.now();
      void refreshAll();
    }

    return () => {
      clearInterval(t);
      if (debouncedRefreshAll.current) {
        clearTimeout(debouncedRefreshAll.current);
        debouncedRefreshAll.current = null;
      }
    };
  }, [ping, scheduleRefresh, refreshAll, online, intervals.mainRefresh, intervals.offlineDaemonPing]);

  // Selected torrent status polling
  useEffect(() => {
    if (!selectedTorrentId) {
      setStatus(null);
      return;
    }

    void refreshStatus(selectedTorrentId);
    const intervalMs = online ? intervals.selectedTorrentStatus : intervals.offlineDaemonPing;
    if (intervalMs <= 0) return;

    const t = setInterval(() => refreshStatus(selectedTorrentId), intervalMs);
    return () => clearInterval(t);
  }, [selectedTorrentId, refreshStatus, online, intervals.selectedTorrentStatus, intervals.offlineDaemonPing]);

  return {
    torrents,
    torrentStatuses,
    status,
    wallet,
    overlay,
    searchSettings,
    refreshAll,
    refreshStatus,
    refreshSearchSettings,
    setTorrents,
    setTorrentStatuses,
    setSearchSettings,
  };
}
