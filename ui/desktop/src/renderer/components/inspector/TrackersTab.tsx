import React, { memo, useCallback, useState, useEffect, useMemo } from "react";
import type { Torrent } from "../../types";
import { getJson, postJson } from "../../utils/api";
import { logger } from "../../utils/logger";

interface Tracker {
  url: string;
  tier?: number;
  status: "unknown" | "working" | "updating" | "error" | "not_working" | "disabled";
  seeders: number | null;
  leechers: number | null;
  downloaded?: number | null;
  last_announce_ms: number | null;
  next_announce_ms: number | null;
  error: string | null;
  announce_count?: number;
  scrape_count?: number;
}

interface TrackersTabProps {
  torrent: Torrent;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type SortField = "url" | "status" | "seeders" | "leechers" | "lastAnnounce";
type SortDirection = "asc" | "desc";

export const TrackersTab = memo<TrackersTabProps>(({
  torrent,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Fetch trackers from API
  const fetchTrackers = useCallback(async () => {
    if (!online) return;
    
    setLoading(true);
    try {
      const data = await getJson<{ trackers: Tracker[] }>(`/torrents/${torrent.id}/trackers`);
      const trackerList = data.trackers || [];
      logger.logWithPrefix("TrackersTab", `Received ${trackerList.length} trackers for torrent ${torrent.id}:`, 
        trackerList.map(t => t.url));
      setTrackers(trackerList);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch trackers";
      logger.warn("Failed to fetch trackers:", message);
      setTrackers([]);
    } finally {
      setLoading(false);
    }
  }, [torrent.id, online]);

  // Initial fetch and refresh on update
  useEffect(() => {
    fetchTrackers();
  }, [fetchTrackers]);

  // Auto-refresh trackers every 10 seconds when online
  useEffect(() => {
    if (!online) return;
    const interval = setInterval(fetchTrackers, 10000);
    return () => clearInterval(interval);
  }, [online, fetchTrackers]);

  // Force announce to all trackers
  const handleForceAnnounce = useCallback(async () => {
    if (!online) return;
    try {
      await postJson(`/torrents/${torrent.id}/announce`, {});
      onUpdate();
      onSuccess("Force announce sent to all trackers");
      // Refresh tracker list after announce
      setTimeout(fetchTrackers, 1000);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to force announce";
      onError(message);
    }
  }, [torrent.id, online, onUpdate, onError, onSuccess, fetchTrackers]);

  // Copy tracker URL to clipboard
  const handleCopyUrl = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      onError("Failed to copy URL to clipboard");
    }
  }, [onError]);

  // Get tracker type from URL
  const getTrackerType = useCallback((url: string): "http" | "udp" | "wss" | "dht" => {
    if (url.startsWith("udp://")) return "udp";
    if (url.startsWith("wss://") || url.startsWith("ws://")) return "wss";
    if (url === "** DHT **" || url.includes("dht")) return "dht";
    return "http";
  }, []);

  // Get tracker type icon
  const getTrackerTypeIcon = useCallback((type: "http" | "udp" | "wss" | "dht"): string => {
    switch (type) {
      case "udp": return "◈"; // Diamond for UDP
      case "wss": return "◎"; // Circle for WebSocket
      case "dht": return "◉"; // Filled circle for DHT
      default: return "●"; // Bullet for HTTP
    }
  }, []);

  // Summary statistics (backend uses "not_working" for tracker errors)
  const stats = useMemo(() => {
    const working = trackers.filter(t => t.status === "working").length;
    const error = trackers.filter(t => t.status === "error" || t.status === "not_working").length;
    const totalSeeders = trackers.reduce((sum, t) => sum + (t.seeders ?? 0), 0);
    const totalLeechers = trackers.reduce((sum, t) => sum + (t.leechers ?? 0), 0);
    return { working, error, totalSeeders, totalLeechers, total: trackers.length };
  }, [trackers]);

  // Sorted trackers
  const sortedTrackers = useMemo(() => {
    const sorted = [...trackers];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "url":
          cmp = a.url.localeCompare(b.url);
          break;
        case "status": {
          const statusOrder: Record<string, number> = { working: 0, updating: 1, unknown: 2, error: 3, not_working: 3, disabled: 4 };
          cmp = (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2);
          break;
        }
        case "seeders":
          cmp = (a.seeders ?? -1) - (b.seeders ?? -1);
          break;
        case "leechers":
          cmp = (a.leechers ?? -1) - (b.leechers ?? -1);
          break;
        case "lastAnnounce":
          cmp = (a.last_announce_ms ?? 0) - (b.last_announce_ms ?? 0);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [trackers, sortField, sortDirection]);

  // Handle column sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  }, [sortField]);

  // Format timestamp to relative time
  const formatTimestamp = (ms: number | null): string => {
    if (ms === null) return "—";
    const now = Date.now();
    const diff = now - ms;
    if (diff < 0) {
      // Future time (next announce)
      const absDiff = Math.abs(diff);
      if (absDiff < 60000) return `in ${Math.ceil(absDiff / 1000)}s`;
      if (absDiff < 3600000) return `in ${Math.ceil(absDiff / 60000)}m`;
      return `in ${Math.floor(absDiff / 3600000)}h`;
    }
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // Get status display info (backend uses "not_working" for tracker errors)
  const getStatusInfo = useCallback((status: string): { class: string; icon: string; label: string } => {
    switch (status) {
      case "working": return { class: "ok", icon: "✓", label: "Working" };
      case "updating": return { class: "updating", icon: "↻", label: "Updating" };
      case "error":
      case "not_working": return { class: "error", icon: "✗", label: "Error" };
      case "disabled": return { class: "disabled", icon: "○", label: "Disabled" };
      default: return { class: "", icon: "?", label: "Unknown" };
    }
  }, []);

  // Sort indicator
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="sortIndicator">⇅</span>;
    return <span className="sortIndicator active">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  return (
    <div className="inspectorTabContent">
      {/* Summary Stats Card */}
      {online && trackers.length > 0 && (
        <div className="trackerSummary">
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue">{stats.total}</span>
            <span className="trackerSummaryLabel">Trackers</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue ok">{stats.working}</span>
            <span className="trackerSummaryLabel">Working</span>
          </div>
          {stats.error > 0 && (
            <>
              <div className="trackerSummaryDivider" />
              <div className="trackerSummaryItem">
                <span className="trackerSummaryValue error">{stats.error}</span>
                <span className="trackerSummaryLabel">Errors</span>
              </div>
            </>
          )}
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue seeders">{stats.totalSeeders}</span>
            <span className="trackerSummaryLabel">Seeders</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue leechers">{stats.totalLeechers}</span>
            <span className="trackerSummaryLabel">Leechers</span>
          </div>
        </div>
      )}

      <div className="inspectorSection">
        <div className="inspectorSectionHeader">
          <div className="inspectorSectionTitle">
            Trackers
            {loading && <span className="loadingIndicator">(updating...)</span>}
          </div>
          <button
            className="btn"
            onClick={handleForceAnnounce}
            disabled={!online || trackers.length === 0}
            title="Force announce to all trackers"
          >
            ANNOUNCE ALL
          </button>
        </div>
        
        <div className="trackerList">
          {!online ? (
            <div className="empty">
              <div className="emptyIcon">📡</div>
              <div className="emptyTitle">Not Connected</div>
              <div className="emptySubtitle">
                Connect to daemon to view tracker information
              </div>
            </div>
          ) : trackers.length === 0 && !loading ? (
            <div className="empty">
              <div className="emptyIcon">📋</div>
              <div className="emptyTitle">No Trackers</div>
              <div className="emptySubtitle">
                This torrent has no trackers configured.<br />
                Peer discovery relies on DHT and PEX.
              </div>
            </div>
          ) : trackers.length > 0 && (
            <table className="table trackerTable">
              <thead>
                <tr>
                  <th className="tableHeader sortable" onClick={() => handleSort("status")} style={{ width: "100px" }}>
                    <div className="tableHeaderContent">
                      Status <SortIndicator field="status" />
                    </div>
                  </th>
                  <th className="tableHeader sortable" onClick={() => handleSort("url")}>
                    <div className="tableHeaderContent">
                      Tracker URL <SortIndicator field="url" />
                    </div>
                  </th>
                  <th className="tableHeader sortable" onClick={() => handleSort("seeders")} style={{ width: "80px", textAlign: "right" }}>
                    <div className="tableHeaderContent" style={{ justifyContent: "flex-end" }}>
                      Seeds <SortIndicator field="seeders" />
                    </div>
                  </th>
                  <th className="tableHeader sortable" onClick={() => handleSort("leechers")} style={{ width: "80px", textAlign: "right" }}>
                    <div className="tableHeaderContent" style={{ justifyContent: "flex-end" }}>
                      Peers <SortIndicator field="leechers" />
                    </div>
                  </th>
                  <th className="tableHeader sortable" onClick={() => handleSort("lastAnnounce")} style={{ width: "120px" }}>
                    <div className="tableHeaderContent">
                      Last Update <SortIndicator field="lastAnnounce" />
                    </div>
                  </th>
                  <th className="tableHeader" style={{ width: "100px" }}>
                    Next Announce
                  </th>
                  <th className="tableHeader" style={{ width: "50px" }}></th>
                </tr>
              </thead>
              <tbody>
                {sortedTrackers.map((tracker, index) => {
                  const statusInfo = getStatusInfo(tracker.status);
                  const trackerType = getTrackerType(tracker.url);
                  return (
                    <tr key={`${tracker.url}-${index}`} className="tableRow">
                      <td className="tableCell">
                        <span className={`trackerStatus ${statusInfo.class}`}>
                          <span className="trackerStatusIcon">{statusInfo.icon}</span>
                          <span className="trackerStatusLabel">{statusInfo.label}</span>
                        </span>
                      </td>
                      <td className="tableCell">
                        <div className="trackerUrlCell">
                          <span className="trackerTypeIcon" title={trackerType.toUpperCase()}>
                            {getTrackerTypeIcon(trackerType)}
                          </span>
                          <span className="trackerUrl" title={tracker.url}>
                            {tracker.url}
                          </span>
                        </div>
                        {tracker.error && (
                          <div className="trackerError">{tracker.error}</div>
                        )}
                      </td>
                      <td className="tableCell trackerNumber">
                        {tracker.seeders !== null ? (
                          <span className="seedersCount">{tracker.seeders}</span>
                        ) : "—"}
                      </td>
                      <td className="tableCell trackerNumber">
                        {tracker.leechers !== null ? (
                          <span className="leechersCount">{tracker.leechers}</span>
                        ) : "—"}
                      </td>
                      <td className="tableCell trackerTime">
                        {formatTimestamp(tracker.last_announce_ms)}
                      </td>
                      <td className="tableCell trackerTime">
                        {formatTimestamp(tracker.next_announce_ms)}
                      </td>
                      <td className="tableCell">
                        <button
                          className="btn ghost small iconBtn"
                          onClick={() => handleCopyUrl(tracker.url)}
                          title="Copy tracker URL"
                        >
                          {copiedUrl === tracker.url ? "✓" : "📋"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});

TrackersTab.displayName = "TrackersTab";
