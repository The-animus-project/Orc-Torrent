import { useCallback, useEffect, useRef, useState } from "react";
import type { KillSwitchConfig, NetPosture, Torrent, TorrentStatus, VpnStatus } from "../types";
import { getJson, postJson } from "../utils/api";
import { getVpnStatusBestEffort } from "../lib/net/vpn";
import { showKillSwitchNotification, showKillSwitchReleasedNotification } from "../utils/notifications";
import { createEvent } from "../utils/eventService";
import { logger } from "../utils/logger";
import { useAdaptiveInterval } from "./usePollingController";
import type { TierIntervals } from "../utils/pollingController";

export interface UsePrivacyStatusOptions {
  online: boolean;
  intervals: TierIntervals;
  pushToast: (kind: "error" | "info", msg: string) => void;
  pushEvent: (event: ReturnType<typeof createEvent>) => void;
  torrents: Torrent[];
  torrentStatuses: Map<string, TorrentStatus>;
  refreshAll: () => Promise<void>;
}

export function usePrivacyStatus({
  online,
  intervals,
  pushToast,
  pushEvent,
  torrents,
  torrentStatuses,
  refreshAll,
}: UsePrivacyStatusOptions) {
  const [netPosture, setNetPosture] = useState<NetPosture | null>(null);
  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);
  const [killSwitch, setKillSwitch] = useState<KillSwitchConfig | null>(null);

  const prevNetPostureState = useRef<NetPosture["state"] | null>(null);
  const killSwitchNotified = useRef(false);
  const prevVpnStatus = useRef<VpnStatus | null>(null);
  const prevEnforcementState = useRef<KillSwitchConfig["enforcement_state"] | null>(null);
  const vpnKillSwitchActive = useRef(false);
  const wasOnline = useRef(false);
  const hasAutoResumed = useRef(false);

  const fetchNetPosture = useCallback(async () => {
    if (!online) return;
    try {
      const np = await getJson<NetPosture>("/net/posture");
      setNetPosture(np);
    } catch {
      // Non-critical
    }
  }, [online]);

  const fetchVpn = useCallback(async () => {
    if (!online) return;
    try {
      const vpn = await getVpnStatusBestEffort().catch(() => null);
      if (vpn) setVpnStatus(vpn);
    } catch (err) {
      logger.errorWithPrefix("Privacy", "Failed to fetch VPN status:", err);
    }
  }, [online]);

  const fetchKillSwitch = useCallback(async () => {
    if (!online) return;
    try {
      const ks = await getJson<KillSwitchConfig>("/net/kill-switch").catch(() => null);
      if (ks) setKillSwitch(ks);
    } catch (err) {
      logger.errorWithPrefix("Privacy", "Failed to fetch kill switch config:", err);
    }
  }, [online]);

  useAdaptiveInterval(fetchNetPosture, intervals.mainRefresh, online);
  useAdaptiveInterval(fetchVpn, intervals.vpnStatus, online);
  useAdaptiveInterval(fetchKillSwitch, intervals.killSwitchConfig, online);

  useEffect(() => {
    if (online) {
      void fetchNetPosture();
      void fetchVpn();
      void fetchKillSwitch();
    }
  }, [online, fetchNetPosture, fetchVpn, fetchKillSwitch]);

  useEffect(() => {
    const handleFocus = () => {
      if (online) void fetchVpn();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchVpn, online]);

  // Notification-only kill-switch transitions (enforcement is in the Rust daemon)
  useEffect(() => {
    if (netPosture) {
      const prevState = prevNetPostureState.current;
      const currentState = netPosture.state;

      if (
        netPosture.leak_proof_enabled &&
        prevState === "protected" &&
        (currentState === "leak_risk" || currentState === "unconfigured")
      ) {
        if (!killSwitchNotified.current) {
          killSwitchNotified.current = true;
          showKillSwitchNotification().catch((err) => {
            logger.warn("Failed to show kill switch notification:", err);
          });
          pushEvent(
            createEvent("vpn_kill_switch", "warning", "Network posture changed to leak risk", {
              details: { previousState: prevState, currentState },
            })
          );
        }
      } else if (currentState === "protected") {
        killSwitchNotified.current = false;
      }
      prevNetPostureState.current = currentState;
    }
  }, [netPosture, pushEvent]);

  useEffect(() => {
    const killSwitchEnabled = killSwitch?.enabled ?? netPosture?.leak_proof_enabled ?? false;
    if (!killSwitchEnabled) {
      vpnKillSwitchActive.current = false;
      prevVpnStatus.current = vpnStatus;
      return;
    }

    const wasConnected = prevVpnStatus.current
      ? prevVpnStatus.current.posture === "connected" &&
        (prevVpnStatus.current.connection_type === "vpn" || prevVpnStatus.current.detected === true)
      : false;
    const isConnected =
      vpnStatus?.posture === "connected" && (vpnStatus?.connection_type === "vpn" || vpnStatus?.detected === true);

    if (wasConnected && !isConnected) {
      vpnKillSwitchActive.current = true;
      const runningCount = torrents.filter((t) => {
        const status = torrentStatuses.get(t.id);
        return status && (status.state === "downloading" || status.state === "seeding");
      }).length;

      if (runningCount > 0) {
        pushToast("error", `VPN disconnected: kill switch active (${runningCount} torrent(s) stopping via daemon)`);
        showKillSwitchNotification(`VPN disconnected — daemon is stopping ${runningCount} torrent(s).`).catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
        pushEvent(
          createEvent("vpn_kill_switch", "error", `VPN disconnected - ${runningCount} torrent(s) stopping`, {
            details: { stoppingTorrents: runningCount },
          })
        );
      } else {
        pushToast("error", "VPN disconnected (kill switch active)");
        showKillSwitchNotification().catch((err) => {
          logger.warn("Failed to show kill switch notification:", err);
        });
        pushEvent(createEvent("vpn_kill_switch", "error", "VPN disconnected - kill switch activated"));
      }
    }

    if (!wasConnected && isConnected && vpnKillSwitchActive.current) {
      vpnKillSwitchActive.current = false;
      pushToast("info", "VPN reconnected: You can now resume torrents");
      showKillSwitchReleasedNotification().catch((err) => {
        logger.warn("Failed to show kill switch released notification:", err);
      });
      pushEvent(createEvent("vpn_kill_switch", "success", "VPN reconnected - kill switch released"));
    }

    prevVpnStatus.current = vpnStatus;
  }, [vpnStatus, killSwitch?.enabled, netPosture?.leak_proof_enabled, torrents, torrentStatuses, pushToast, pushEvent]);

  useEffect(() => {
    const enforcement = killSwitch?.enforcement_state ?? null;
    const prev = prevEnforcementState.current;
    if (prev === "armed" && enforcement === "engaged") {
      pushToast("error", "Kill switch engaged — torrents stopped by daemon");
    }
    if (prev === "engaged" && enforcement === "armed") {
      pushToast("info", "Kill switch released — VPN reconnected");
    }
    prevEnforcementState.current = enforcement;
  }, [killSwitch?.enforcement_state, pushToast]);

  // Auto-resume when GUI connects (unless kill switch is engaged)
  useEffect(() => {
    const justCameOnline = online && !wasOnline.current;
    wasOnline.current = online;

    if (!justCameOnline || hasAutoResumed.current) {
      return;
    }

    if (killSwitch === null) {
      return;
    }

    const killSwitchEngaged =
      killSwitch?.enabled && (killSwitch?.enforcement_state === "engaged" || killSwitch?.enforcement_state === "armed");

    const vpnRequired = killSwitch?.enabled && !vpnStatus?.detected;

    if (killSwitchEngaged || vpnRequired) {
      logger.logWithPrefix(
        "Auto-Resume",
        "Kill switch is engaged or VPN required but not connected, skipping auto-resume"
      );
      hasAutoResumed.current = true;
      if (vpnRequired) {
        pushToast("info", "Torrents paused: VPN required but not connected (kill switch active)");
      }
      return;
    }

    const stoppedIds = torrents
      .filter((t) => {
        const status = torrentStatuses.get(t.id);
        return status && status.state === "stopped";
      })
      .map((t) => t.id);

    if (stoppedIds.length > 0) {
      logger.logWithPrefix("Auto-Resume", `Auto-resuming ${stoppedIds.length} stopped torrent(s)`);
      hasAutoResumed.current = true;

      Promise.all(stoppedIds.map((id) => postJson(`/torrents/${id}/start`, {})))
        .then(() => {
          pushToast(
            "info",
            stoppedIds.length === 1
              ? "Resumed 1 torrent automatically"
              : `Resumed ${stoppedIds.length} torrents automatically`
          );
          void refreshAll();
        })
        .catch((err) => {
          logger.errorWithPrefix("Auto-Resume", "Failed to auto-resume torrents:", err);
        });
    } else {
      hasAutoResumed.current = true;
    }
  }, [online, torrents, torrentStatuses, killSwitch, vpnStatus, pushToast, refreshAll]);

  const syncFromNetPosture = useCallback((np: NetPosture | null) => {
    if (!np) return;
    setNetPosture(np);
    if (np.vpn_status) setVpnStatus(np.vpn_status);
    if (np.kill_switch) setKillSwitch(np.kill_switch);
  }, []);

  return {
    netPosture,
    vpnStatus,
    killSwitch,
    syncFromNetPosture,
    setNetPosture,
    setVpnStatus,
    setKillSwitch,
    refreshVpnStatus: fetchVpn,
  };
}
