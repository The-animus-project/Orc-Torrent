import React, { memo, useCallback, useState } from "react";
import type { Torrent, TorrentStatus, OverlayStatus, TorrentMode } from "../types";
import { fmtBytesPerSec, fmtPct, fmtEta, fmtTimeElapsed, fmtSizeProgress, getEffectiveEta } from "../utils/format";
import { postJson, patchJson } from "../utils/api";

interface TorrentDetailsProps {
  torrent: Torrent | null;
  status: TorrentStatus | null;
  overlay: OverlayStatus | null;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

const Stat = memo<{ label: string; value: string | React.ReactNode }>(({ label, value }) => (
  <div className="stat">
    <div className="sLabel">{label}</div>
    <div className="sValue">{value}</div>
  </div>
));

Stat.displayName = "Stat";

export const TorrentDetails = memo<TorrentDetailsProps>(({ 
  torrent, 
  status, 
  overlay, 
  online,
  onUpdate,
  onError,
  onSuccess
}) => {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const startStop = useCallback(async (action: "start" | "stop") => {
    if (!torrent || loadingAction) return;
    const actionKey = `${action}-${torrent.id}`;
    if (loadingAction === actionKey) return; // Prevent double-click
    
    try {
      setLoadingAction(actionKey);
      await postJson(`/torrents/${torrent.id}/${action}`);
      onUpdate();
      onSuccess(`Torrent ${action}ed`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : `Failed to ${action}`;
      onError(message);
    } finally {
      setLoadingAction(null);
    }
  }, [torrent, loadingAction, onUpdate, onError, onSuccess]);

  const setProfile = useCallback(async (mode: TorrentMode, hops?: number) => {
    if (!torrent || loadingAction) return;
    const profileKey = `${mode}-${hops ?? 0}-${torrent.id}`;
    if (loadingAction === profileKey) return; // Prevent double-click
    
    try {
      setLoadingAction(profileKey);
      await patchJson(`/torrents/${torrent.id}/profile`, { mode, hops });
      onUpdate();
      onSuccess(`Profile set: ${mode}${mode === "anonymous" ? ` (${hops ?? 1} hops)` : ""}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to set profile";
      onError(message);
    } finally {
      setLoadingAction(null);
    }
  }, [torrent, loadingAction, onUpdate, onError, onSuccess]);

  if (!torrent) {
    return (
      <section className="panel wide">
        <div className="panelHeader">
          <div className="panelTitle">Operations</div>
          <div className="panelMeta">Select a torrent to manage it</div>
        </div>
        <div className="empty">Select a torrent to manage it.</div>
      </section>
    );
  }

  const progress = status ? Math.max(0, Math.min(1, status.progress)) : 0;

  return (
    <section className="panel wide">
      <div className="panelHeader">
        <div className="panelTitle">Operations</div>
        <div className="panelMeta">Live status and controls</div>
      </div>

      <div className="ops">
        <div className="opsTop">
          <div>
            <div className="opsName">{torrent.name}</div>
            <div className="opsId">{torrent.id}</div>
          </div>

          <div className="actions">
            <button 
              className="btn primary" 
              onClick={() => startStop("start")} 
              disabled={!online || torrent.running || loadingAction !== null}
              aria-busy={loadingAction?.startsWith("start-")}
            >
              {loadingAction?.startsWith("start-") ? "STARTING..." : "START"}
            </button>
            <button 
              className="btn" 
              onClick={() => startStop("stop")} 
              disabled={!online || !torrent.running || loadingAction !== null}
              aria-busy={loadingAction?.startsWith("stop-")}
            >
              {loadingAction?.startsWith("stop-") ? "STOPPING..." : "STOP"}
            </button>
            <div className="divider" />
            <button 
              className={`btn ${torrent.profile.mode === "standard" ? "primary" : ""}`}
              onClick={() => setProfile("standard", 0)} 
              disabled={!online || loadingAction !== null}
              aria-busy={loadingAction?.includes("standard-0-")}
            >
              {loadingAction?.includes("standard-0-") ? "..." : "STANDARD"}
            </button>
            <button 
              className={`btn ${torrent.profile.mode === "private" ? "primary" : ""}`}
              onClick={() => setProfile("private", 0)} 
              disabled={!online || loadingAction !== null}
              aria-busy={loadingAction?.includes("private-0-")}
            >
              {loadingAction?.includes("private-0-") ? "..." : "PRIVATE"}
            </button>
            <button 
              className={`btn ${torrent.profile.mode === "anonymous" && torrent.profile.hops === 1 ? "primary" : ""}`}
              onClick={() => setProfile("anonymous", 1)} 
              disabled={!online || loadingAction !== null}
              aria-busy={loadingAction?.includes("anonymous-1-")}
            >
              {loadingAction?.includes("anonymous-1-") ? "..." : "ANON 1"}
            </button>
            <button 
              className={`btn ${torrent.profile.mode === "anonymous" && torrent.profile.hops === 2 ? "primary" : ""}`}
              onClick={() => setProfile("anonymous", 2)} 
              disabled={!online || loadingAction !== null}
              aria-busy={loadingAction?.includes("anonymous-2-")}
            >
              {loadingAction?.includes("anonymous-2-") ? "..." : "ANON 2"}
            </button>
            <button 
              className={`btn ${torrent.profile.mode === "anonymous" && torrent.profile.hops === 3 ? "primary" : ""}`}
              onClick={() => setProfile("anonymous", 3)} 
              disabled={!online || loadingAction !== null}
              aria-busy={loadingAction?.includes("anonymous-3-")}
            >
              {loadingAction?.includes("anonymous-3-") ? "..." : "ANON 3"}
            </button>
          </div>
        </div>

        <div className="grid2">
          <div className="card">
            <div className="cardTitle">Live status</div>
            {!status ? (
              <div className="muted">No status available.</div>
            ) : (
              <>
                <div className="progress">
                  <div className="bar">
                    <div 
                      className="fill" 
                      style={{ width: `${progress * 100}%` }}
                    />
                  </div>
                  <div className="pct">{fmtPct(progress)}</div>
                </div>

                <div style={{ marginTop: "8px", marginBottom: "12px", fontSize: "0.9em", color: "var(--text-muted)" }}>
                  {fmtSizeProgress(status.downloaded_bytes, status.total_bytes)}
                  {status.total_bytes > 0 && (
                    <span style={{ marginLeft: "8px" }}>
                      ({fmtPct(progress)})
                    </span>
                  )}
                </div>

                <div className="stats">
                  <Stat 
                    label="State" 
                    value={
                      <span style={{ 
                        textTransform: 'uppercase',
                        color: 'var(--text)'
                      }}>
                        {status.state}
                      </span>
                    } 
                  />
                  <Stat label="Download" value={fmtBytesPerSec(status.down_rate_bps)} />
                  <Stat label="Upload" value={fmtBytesPerSec(status.up_rate_bps)} />
                  <Stat label="Time elapsed" value={fmtTimeElapsed(torrent.added_at_ms)} />
                  <Stat label="ETA" value={fmtEta(getEffectiveEta(status.eta_sec, status.state, status.total_bytes, status.downloaded_bytes, status.down_rate_bps), status.state)} />
                </div>
              </>
            )}
          </div>

          <div className="card">
            <div className="cardTitle">Overlay health</div>
            {!overlay ? (
              <div className="muted">No overlay data.</div>
            ) : overlay.circuits.length === 0 ? (
              <div className="muted">No circuits active (expected until overlay is enabled via anonymous mode).</div>
            ) : (
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
            )}
          </div>
        </div>
      </div>
    </section>
  );
});

TorrentDetails.displayName = "TorrentDetails";
