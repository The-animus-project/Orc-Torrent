import React, { memo, useCallback, useState, useEffect, useMemo } from "react";
import type { Torrent, TorrentStatus } from "../../types";
import { getJson } from "../../utils/api";

interface Peer {
  id: string;
  ip: string;
  port: number;
  down_rate: number;
  up_rate: number;
  progress?: number;
  snubbed: boolean;
  choked: boolean;
}

interface TrackerRow {
  url: string;
  tier?: number;
  status: string;
  seeders: number | null;
  leechers: number | null;
  last_announce_ms: number | null;
  next_announce_ms: number | null;
  error?: string | null;
}

interface SwarmTabProps {
  torrent: Torrent;
  status: TorrentStatus | null;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

function trackerStatusLabel(status: string): string {
  switch (status) {
    case "working": return "Working";
    case "not_working": return "Error";
    case "updating": return "Updating";
    case "disabled": return "Disabled";
    default: return status;
  }
}

export const SwarmTab = memo<SwarmTabProps>(({
  torrent,
  status,
  online,
  onError,
}) => {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [trackers, setTrackers] = useState<TrackerRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPeers = useCallback(async (reportError = false) => {
    if (!online) return;
    try {
      const data = await getJson<{ peers: Peer[] }>(`/torrents/${torrent.id}/peers`);
      setPeers(data.peers || []);
    } catch (e) {
      setPeers([]);
      if (reportError) {
        const msg = e instanceof Error ? e.message : "Failed to load peers";
        onError(msg);
      }
    }
  }, [torrent.id, online, onError]);

  const fetchTrackers = useCallback(async (reportError = false) => {
    if (!online) return;
    try {
      const data = await getJson<{ trackers: TrackerRow[] }>(`/torrents/${torrent.id}/trackers`);
      setTrackers(data.trackers || []);
    } catch (e) {
      setTrackers([]);
      if (reportError) {
        const msg = e instanceof Error ? e.message : "Failed to load trackers";
        onError(msg);
      }
    }
  }, [torrent.id, online, onError]);

  useEffect(() => {
    if (!online) return;
    setLoading(true);
    Promise.all([fetchPeers(true), fetchTrackers(true)]).finally(() => setLoading(false));
  }, [online, fetchPeers, fetchTrackers]);

  useEffect(() => {
    if (!online) return;
    const peerInterval = setInterval(() => fetchPeers(false), 5000);
    const trackerInterval = setInterval(() => fetchTrackers(false), 10000);
    return () => {
      clearInterval(peerInterval);
      clearInterval(trackerInterval);
    };
  }, [online, fetchPeers, fetchTrackers]);

  const swarmStats = useMemo(() => {
    const connected = peers.length;
    const seeds = peers.filter(p => (p.progress ?? 0) >= 1).length;
    const leechers = connected - seeds;
    const downloading = peers.filter(p => p.down_rate > 0).length;
    const uploading = peers.filter(p => p.up_rate > 0).length;
    const active = peers.filter(p => !p.snubbed && !p.choked && (p.down_rate > 0 || p.up_rate > 0)).length;
    const trackerSeeders = trackers.reduce((sum, t) => sum + (t.seeders ?? 0), 0);
    const trackerLeechers = trackers.reduce((sum, t) => sum + (t.leechers ?? 0), 0);
    const hasTrackerSwarm = trackerSeeders > 0 || trackerLeechers > 0;
    return {
      connected,
      peersSeen: status?.peers_seen ?? 0,
      seeds,
      leechers,
      downloading,
      uploading,
      active,
      trackerSeeders,
      trackerLeechers,
      hasTrackerSwarm,
    };
  }, [peers, trackers, status?.peers_seen]);

  const discoverySources = useMemo(() => {
    const dht = trackers.find(t => t.url === "** DHT **");
    const pex = trackers.find(t => t.url === "** PeX **");
    const lsd = trackers.find(t => t.url === "** LSD **");
    const httpTrackers = trackers.filter(t =>
      t.url !== "** DHT **" && t.url !== "** PeX **" && t.url !== "** LSD **"
    );
    return { dht, pex, lsd, httpTrackers };
  }, [trackers]);

  if (!online) {
    return (
      <div className="inspectorTabContent">
        <div className="inspectorSection">
          <div className="inspectorSectionTitle">Swarm</div>
          <div className="empty" style={{ padding: "24px", textAlign: "center" }}>
            <div className="emptyIcon" style={{ fontSize: "32px", marginBottom: "8px" }}>📡</div>
            <div className="emptyTitle">Not connected</div>
            <div className="emptySubtitle">
              Connect to the daemon to see swarm data (peers, seeds, leechers, and discovery sources).
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionTitle">
          Swarm summary
          {loading && <span className="loadingIndicator" style={{ marginLeft: "8px" }}>(updating…)</span>}
        </div>

        <div className="trackerSummary" style={{ marginBottom: "16px" }}>
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue">{status?.peers_seen ?? "—"}</span>
            <span className="trackerSummaryLabel">Peers seen</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue">{swarmStats.connected}</span>
            <span className="trackerSummaryLabel">Connected</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue seeders">{swarmStats.seeds}</span>
            <span className="trackerSummaryLabel">Seeds</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue leechers">{swarmStats.leechers}</span>
            <span className="trackerSummaryLabel">Leechers</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue">{swarmStats.downloading}</span>
            <span className="trackerSummaryLabel">Downloading</span>
          </div>
          <div className="trackerSummaryDivider" />
          <div className="trackerSummaryItem">
            <span className="trackerSummaryValue">{swarmStats.uploading}</span>
            <span className="trackerSummaryLabel">Uploading</span>
          </div>
        </div>

        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Peers seen (runtime)</div>
            <div className="inspectorFieldValue">{status != null ? status.peers_seen : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Connected peers</div>
            <div className="inspectorFieldValue" style={{
              color: swarmStats.connected > 0 ? "var(--primary, #4CAF50)" : "var(--text)",
              fontWeight: swarmStats.connected > 0 ? 600 : "normal",
            }}>
              {online ? swarmStats.connected : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Active (transferring)</div>
            <div className="inspectorFieldValue">{online ? swarmStats.active : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Seeds connected</div>
            <div className="inspectorFieldValue" style={{
              color: swarmStats.seeds > 0 ? "var(--success, #4CAF50)" : "var(--text-muted)",
            }}>
              {online ? swarmStats.seeds : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Leechers connected</div>
            <div className="inspectorFieldValue">{online ? swarmStats.leechers : "—"}</div>
          </div>
        </div>

        {swarmStats.hasTrackerSwarm && (
          <div style={{
            marginTop: "16px",
            padding: "12px",
            background: "var(--bg-secondary, rgba(0,0,0,0.03))",
            borderRadius: "8px",
            border: "1px solid var(--border, rgba(0,0,0,0.1))",
          }}>
            <div className="inspectorSectionTitle" style={{ marginBottom: "8px", fontSize: "12px" }}>
              From trackers (scrape)
            </div>
            <div style={{ display: "flex", gap: "24px", flexWrap: "wrap" }}>
              <div>
                <span className="trackerSummaryValue seeders">{swarmStats.trackerSeeders}</span>
                <span className="trackerSummaryLabel" style={{ marginLeft: "6px" }}>seeders</span>
              </div>
              <div>
                <span className="trackerSummaryValue leechers">{swarmStats.trackerLeechers}</span>
                <span className="trackerSummaryLabel" style={{ marginLeft: "6px" }}>leechers</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Discovery sources</div>
        <div className="inspectorGrid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
          {discoverySources.dht && (
            <div className="inspectorField">
              <div className="inspectorFieldLabel">DHT</div>
              <div className="inspectorFieldValue">
                <span className={`pill ${discoverySources.dht.status === "working" ? "ok" : ""}`}>
                  {trackerStatusLabel(discoverySources.dht.status)}
                </span>
              </div>
            </div>
          )}
          {discoverySources.pex && (
            <div className="inspectorField">
              <div className="inspectorFieldLabel">PeX</div>
              <div className="inspectorFieldValue">
                <span className={`pill ${discoverySources.pex.status === "working" ? "ok" : ""}`}>
                  {trackerStatusLabel(discoverySources.pex.status)}
                </span>
              </div>
            </div>
          )}
          {discoverySources.lsd && (
            <div className="inspectorField">
              <div className="inspectorFieldLabel">LSD</div>
              <div className="inspectorFieldValue">
                <span className={`pill ${discoverySources.lsd.status === "working" ? "ok" : ""}`}>
                  {trackerStatusLabel(discoverySources.lsd.status)}
                </span>
              </div>
            </div>
          )}
        </div>
        {discoverySources.httpTrackers.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <div className="inspectorFieldLabel" style={{ marginBottom: "6px" }}>Trackers</div>
            <ul style={{
              margin: 0,
              paddingLeft: "20px",
              fontSize: "13px",
              color: "var(--text-muted)",
            }}>
              {discoverySources.httpTrackers.slice(0, 10).map((t, i) => (
                <li key={`${t.url}-${i}`} style={{ marginBottom: "4px", wordBreak: "break-all" }}>
                  <span className={`pill ${t.status === "working" ? "ok" : t.status === "not_working" ? "error" : ""}`} style={{ marginRight: "8px", fontSize: "10px" }}>
                    {trackerStatusLabel(t.status)}
                  </span>
                  {t.url}
                  {(t.seeders != null || t.leechers != null) && (
                    <span style={{ marginLeft: "8px", color: "var(--text)" }}>
                      ({t.seeders ?? 0} / {t.leechers ?? 0})
                    </span>
                  )}
                </li>
              ))}
              {discoverySources.httpTrackers.length > 10 && (
                <li style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                  +{discoverySources.httpTrackers.length - 10} more
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
});

SwarmTab.displayName = "SwarmTab";
