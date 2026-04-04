import React, { memo, useState, useEffect, useCallback } from "react";
import type { Torrent, TorrentStatus, OverlayStatus } from "../../types";
import { fmtBytes, fmtBytesPerSec, fmtPct, fmtEta, fmtTimeElapsed, getEffectiveEta } from "../../utils/format";
import { getJson } from "../../utils/api";

interface OverviewTabProps {
  torrent: Torrent;
  status: TorrentStatus | null;
  overlay: OverlayStatus | null;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

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

export const OverviewTab = memo<OverviewTabProps>(({
  torrent,
  status,
  overlay,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [totalSeeders, setTotalSeeders] = useState<number | null>(null);
  const [totalLeechers, setTotalLeechers] = useState<number | null>(null);
  const [peerStats, setPeerStats] = useState<{
    total: number;
    active: number;
    seeds: number;
    downloading: number;
    uploading: number;
  }>({ total: 0, active: 0, seeds: 0, downloading: 0, uploading: 0 });

  // Fetch tracker data to get seeders/leechers
  const fetchTrackerStats = useCallback(async () => {
    if (!online) return;
    try {
      const data = await getJson<{ trackers: Array<{ seeders: number | null; leechers: number | null }> }>(`/torrents/${torrent.id}/trackers`);
      if (data.trackers && data.trackers.length > 0) {
        // Sum up seeders and leechers from all trackers
        let seeders = 0;
        let leechers = 0;
        let hasData = false;
        for (const tracker of data.trackers) {
          if (tracker.seeders !== null && tracker.seeders !== undefined) {
            seeders += tracker.seeders;
            hasData = true;
          }
          if (tracker.leechers !== null && tracker.leechers !== undefined) {
            leechers += tracker.leechers;
            hasData = true;
          }
        }
        if (hasData) {
          setTotalSeeders(seeders > 0 ? seeders : null);
          setTotalLeechers(leechers > 0 ? leechers : null);
        }
      }
    } catch (err) {
    }
  }, [torrent.id, online]);

  // Fetch connected peers data
  const fetchPeers = useCallback(async () => {
    if (!online) return;
    try {
      const data = await getJson<{ peers: Peer[] }>(`/torrents/${torrent.id}/peers`);
      const peers = data.peers || [];
      
      // Calculate peer statistics
      const stats = {
        total: peers.length,
        active: peers.filter(p => !p.snubbed && !p.choked && (p.down_rate > 0 || p.up_rate > 0)).length,
        seeds: peers.filter(p => (p.progress ?? 0) >= 1).length,
        downloading: peers.filter(p => p.down_rate > 0).length,
        uploading: peers.filter(p => p.up_rate > 0).length,
      };
      setPeerStats(stats);
    } catch (err) {
      setPeerStats({ total: 0, active: 0, seeds: 0, downloading: 0, uploading: 0 });
    }
  }, [torrent.id, online]);

  useEffect(() => {
    fetchTrackerStats();
    fetchPeers();
    // Refresh tracker stats every 10 seconds
    const trackerInterval = setInterval(fetchTrackerStats, 10000);
    // Refresh peer stats every 5 seconds (more frequent for real-time feel)
    const peerInterval = setInterval(fetchPeers, 5000);
    return () => {
      clearInterval(trackerInterval);
      clearInterval(peerInterval);
    };
  }, [fetchTrackerStats, fetchPeers]);

  const progress = status ? Math.max(0, Math.min(1, status.progress)) : 0;

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Torrent Information</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Torrent ID</div>
            <div className="inspectorFieldValue" style={{ fontFamily: "monospace", fontSize: "12px" }}>{torrent.id}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Infohash</div>
            <div className="inspectorFieldValue" style={{ fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all" }}>
              {torrent.info_hash_hex ?? "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Name</div>
            <div className="inspectorFieldValue">{torrent.name}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Save Path</div>
            <div className="inspectorFieldValue" style={{ wordBreak: "break-all" }}>
              {torrent.save_path ?? "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Added</div>
            <div className="inspectorFieldValue">{fmtTimeElapsed(torrent.added_at_ms)}</div>
          </div>
        </div>
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Status</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">State</div>
            <div className="inspectorFieldValue">
              <span className={`pill ${status?.state === "seeding" ? "ok" : ""}`}>
                {status?.state?.toUpperCase() ?? "STOPPED"}
              </span>
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Progress</div>
            <div className="inspectorFieldValue">{status ? fmtPct(progress) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Size</div>
            <div className="inspectorFieldValue">{status ? fmtBytes(status.total_bytes) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Downloaded</div>
            <div className="inspectorFieldValue">{status ? fmtBytes(status.downloaded_bytes) : "—"}</div>
          </div>
        </div>
        {status && (
          <div className="progress" style={{ marginTop: "16px" }}>
            <div className="bar">
              <div className="fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="pct">{fmtPct(progress)}</div>
          </div>
        )}
      </div>

      {/* Prominent Speed and ETA Section */}
      <div className="inspectorSection" style={{ 
        background: "var(--bg-secondary, rgba(0, 0, 0, 0.05))", 
        borderRadius: "8px", 
        padding: "20px",
        border: "1px solid var(--border, rgba(0, 0, 0, 0.1))"
      }}>
        <div className="inspectorSectionTitle" style={{ marginBottom: "16px", fontSize: "16px", fontWeight: "600" }}>
          Download Speed & ETA
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Download Speed
            </div>
            <div style={{ 
              fontSize: "24px", 
              fontWeight: "600", 
              color: status && status.down_rate_bps > 0 ? "var(--primary, #4CAF50)" : "var(--text)",
              fontFamily: "monospace"
            }}>
              {status ? fmtBytesPerSec(status.down_rate_bps) : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Upload Speed
            </div>
            <div style={{ 
              fontSize: "24px", 
              fontWeight: "600", 
              color: status && status.up_rate_bps > 0 ? "var(--primary, #4CAF50)" : "var(--text)",
              fontFamily: "monospace"
            }}>
              {status ? fmtBytesPerSec(status.up_rate_bps) : "—"}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Estimated Time Remaining
            </div>
            <div style={{ 
              fontSize: "24px", 
              fontWeight: "600", 
              color: status && status.state === "downloading" ? "var(--primary, #4CAF50)" : "var(--text)",
              fontFamily: "monospace"
            }}>
              {status
                ? fmtEta(
                    getEffectiveEta(
                      status.eta_sec,
                      status.state,
                      status.total_bytes,
                      status.downloaded_bytes,
                      status.down_rate_bps
                    ),
                    status.state
                  )
                : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Transfer Rates</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Download Speed</div>
            <div className="inspectorFieldValue">{status ? fmtBytesPerSec(status.down_rate_bps) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Upload Speed</div>
            <div className="inspectorFieldValue">{status ? fmtBytesPerSec(status.up_rate_bps) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">ETA</div>
            <div className="inspectorFieldValue">
              {status
                ? fmtEta(
                    getEffectiveEta(
                      status.eta_sec,
                      status.state,
                      status.total_bytes,
                      status.downloaded_bytes,
                      status.down_rate_bps
                    ),
                    status.state
                  )
                : "—"}
            </div>
          </div>
        </div>
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Swarm Information</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Peers Seen</div>
            <div className="inspectorFieldValue">{status ? status.peers_seen : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Connected Peers</div>
            <div className="inspectorFieldValue" style={{ 
              color: peerStats.total > 0 ? "var(--primary, #4CAF50)" : "var(--text)",
              fontWeight: peerStats.total > 0 ? "600" : "normal"
            }}>
              {online ? peerStats.total : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Active Peers</div>
            <div className="inspectorFieldValue" style={{ 
              color: peerStats.active > 0 ? "var(--primary, #4CAF50)" : "var(--text-muted)"
            }}>
              {online ? peerStats.active : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Seeders (Swarm)</div>
            <div className="inspectorFieldValue">
              {totalSeeders !== null ? totalSeeders : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Leechers (Swarm)</div>
            <div className="inspectorFieldValue">
              {totalLeechers !== null ? totalLeechers : "—"}
            </div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Connected Seeds</div>
            <div className="inspectorFieldValue" style={{ 
              color: peerStats.seeds > 0 ? "var(--primary, #4CAF50)" : "var(--text-muted)"
            }}>
              {online ? peerStats.seeds : "—"}
            </div>
          </div>
        </div>
        {online && peerStats.total > 0 && (
          <div style={{ 
            marginTop: "16px", 
            padding: "12px", 
            background: "var(--bg-secondary, rgba(0, 0, 0, 0.03))", 
            borderRadius: "6px",
            fontSize: "13px",
            color: "var(--text-muted)"
          }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "12px" }}>
              <div>
                <span style={{ fontWeight: "600", color: "var(--text)" }}>{peerStats.downloading}</span> downloading
              </div>
              <div>
                <span style={{ fontWeight: "600", color: "var(--text)" }}>{peerStats.uploading}</span> uploading
              </div>
              <div>
                <span style={{ fontWeight: "600", color: "var(--text)" }}>{peerStats.seeds}</span> seeds connected
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Privacy Posture</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Mode</div>
            <div className="inspectorFieldValue">
              <span className="pill">{(torrent.profile?.mode ?? "standard").toUpperCase()}</span>
              {(torrent.profile?.mode ?? "standard") === "anonymous" && (
                <span className="pill" style={{ marginLeft: "8px" }}>
                  {torrent.profile?.hops ?? 0} HOPS
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {overlay && overlay.circuits.length > 0 && (
        <div className="inspectorSection">
          <div className="inspectorSectionTitle">Overlay Circuits</div>
          <div className="circuits">
            {overlay.circuits.map((c) => (
              <div key={c.id} className="circuit">
                <div className="cName">{c.id}</div>
                <div className="cMeta">
                  {c.hops} HOPS • {c.healthy ? "HEALTHY" : "DEGRADED"} • {c.rtt_ms}MS
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Current Limits</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Download Limit</div>
            <div className="inspectorFieldValue">—</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Upload Limit</div>
            <div className="inspectorFieldValue">—</div>
          </div>
        </div>
      </div>

      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Last Errors</div>
        {status?.state === "error" ? (
          <div className="inspectorFieldValue" style={{ color: "var(--error)", fontSize: "13px" }}>
            Download error occurred. Check torrent status for details.
          </div>
        ) : (
          <div className="inspectorFieldValue" style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            No errors
          </div>
        )}
      </div>
    </div>
  );
});

OverviewTab.displayName = "OverviewTab";
