// Custom hook for VPN monitoring and kill switch logic
import { useCallback, useEffect, useRef, useState } from "react";
import type { VpnStatus, KillSwitchConfig, Torrent, TorrentStatus } from "../types";
import { getJson } from "./api";
import { getVpnStatusBestEffort } from "../lib/net/vpn";
import { showKillSwitchNotification, showKillSwitchReleasedNotification } from "./notifications";
import { logger } from "./logger";

interface UseVpnMonitoringOptions {
  online: boolean;
  torrents: Torrent[];
  torrentStatuses: Map<string, TorrentStatus>;
  onStopTorrents: (ids: string[]) => Promise<void>;
  onError: (msg: string) => void;
  onInfo: (msg: string) => void;
}

interface UseVpnMonitoringResult {
  vpnStatus: VpnStatus | null;
  killSwitch: KillSwitchConfig | null;
  refreshVpnStatus: () => Promise<void>;
}

export function useVpnMonitoring({
  online,
  torrents,
  torrentStatuses,
  onStopTorrents,
  onError,
  onInfo,
}: UseVpnMonitoringOptions): UseVpnMonitoringResult {
  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);
  const [killSwitch, setKillSwitch] = useState<KillSwitchConfig | null>(null);
  
  // Track VPN status for kill switch
  const prevVpnStatus = useRef<VpnStatus | null>(null);
  const vpnKillSwitchActive = useRef<boolean>(false);

  const refreshVpnStatus = useCallback(async () => {
    if (!online) return;
    try {
      const vpn = await getVpnStatusBestEffort();
      setVpnStatus(vpn);
    } catch (e) {
    }
  }, [online]);

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
        logger.errorWithPrefix("VPNMonitoring", "Failed to fetch VPN/kill switch status:", err);
      }
    };

    // Fetch immediately
    fetchVpnAndKillSwitch();

    // Poll every 500ms for instant detection of VPN connection drops
    const interval = setInterval(fetchVpnAndKillSwitch, 500);
    return () => clearInterval(interval);
  }, [online]);

  // Monitor VPN disconnection for kill switch
  useEffect(() => {
    const killSwitchEnabled = killSwitch?.enabled ?? false;
    
    if (!killSwitchEnabled) {
      vpnKillSwitchActive.current = false;
      prevVpnStatus.current = vpnStatus;
      return;
    }

    // Check VPN connection status
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
        onStopTorrents(runningIds).catch((err) => {
          logger.errorWithPrefix("VPNMonitoring", "Failed to stop torrents on VPN disconnect:", err);
        });
        onError(`VPN disconnected: ${runningIds.length} torrent(s) stopped (kill switch active)`);
        const detail = `VPN disconnected — ${runningIds.length} torrent(s) stopped.`;
        showKillSwitchNotification(detail).catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
      } else {
        onError("VPN disconnected (kill switch active)");
        showKillSwitchNotification().catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
      }
    }

    // VPN reconnected
    if (!wasConnected && isConnected && vpnKillSwitchActive.current) {
      vpnKillSwitchActive.current = false;
      onInfo("VPN reconnected: You can now resume torrents");
      showKillSwitchReleasedNotification().catch((err) => {
        logger.warn("Failed to show kill switch released notification:", err);
      });
    }

    prevVpnStatus.current = vpnStatus;
  }, [vpnStatus, killSwitch?.enabled, torrents, torrentStatuses, onStopTorrents, onError, onInfo]);

  // Refresh VPN status when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      if (online) {
        refreshVpnStatus();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [refreshVpnStatus, online]);

  return {
    vpnStatus,
    killSwitch,
    refreshVpnStatus,
  };
}
