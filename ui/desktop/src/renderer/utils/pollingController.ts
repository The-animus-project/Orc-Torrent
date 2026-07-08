export type PollingTier = "focused" | "blurred" | "background";

export interface WindowVisibilityState {
  focused: boolean;
  minimized: boolean;
  visible: boolean;
}

export interface TierIntervals {
  mainRefresh: number;
  offlineDaemonPing: number;
  vpnStatus: number;
  killSwitchConfig: number;
  selectedTorrentStatus: number;
  peers: number;
  trackers: number;
  rowSnapshot: number;
}

export const POLLING_INTERVALS: Record<PollingTier, TierIntervals> = {
  focused: {
    mainRefresh: 2000,
    offlineDaemonPing: 2000,
    vpnStatus: 2000,
    killSwitchConfig: 30_000,
    selectedTorrentStatus: 2000,
    peers: 5000,
    trackers: 10_000,
    rowSnapshot: 2000,
  },
  blurred: {
    mainRefresh: 5000,
    offlineDaemonPing: 2000,
    vpnStatus: 10_000,
    killSwitchConfig: 30_000,
    selectedTorrentStatus: 5000,
    peers: 15_000,
    trackers: 30_000,
    rowSnapshot: 5000,
  },
  background: {
    mainRefresh: 15_000,
    offlineDaemonPing: 2000,
    vpnStatus: 30_000,
    killSwitchConfig: 30_000,
    selectedTorrentStatus: 15_000,
    peers: 0,
    trackers: 0,
    rowSnapshot: 15_000,
  },
};

export const MIN_REFRESH_INTERVAL_MS = 1000;

export function resolvePollingTier(visibility: WindowVisibilityState): PollingTier {
  if (visibility.minimized || !visibility.visible || document.hidden) {
    return "background";
  }
  if (!visibility.focused) {
    return "blurred";
  }
  return "focused";
}

export function getIntervalsForTier(tier: PollingTier): TierIntervals {
  return POLLING_INTERVALS[tier];
}
