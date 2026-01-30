import React, { memo, useCallback } from "react";
import type { Torrent, TorrentStatus } from "../types";
import { fmtSizeProgress, fmtTimeElapsed, fmtBytesPerSec, fmtPct } from "../utils/format";

interface TorrentListProps {
  torrents: Torrent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statuses?: Map<string, TorrentStatus>;
}

export const TorrentList = memo<TorrentListProps>(({ torrents, selectedId, onSelect, statuses }) => {
  const handleClick = useCallback((id: string) => {
    onSelect(id);
  }, [onSelect]);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">Torrents</div>
        <div className="panelMeta">{torrents.length} tracked</div>
      </div>

      <div className="list">
        {torrents.length === 0 && (
          <div className="empty">No torrents yet. Add one to get started.</div>
        )}
        {torrents.map((t) => {
          const status = statuses?.get(t.id);
          const sizeInfo = status ? fmtSizeProgress(status.downloaded_bytes, status.total_bytes) : null;
          const timeElapsed = fmtTimeElapsed(t.added_at_ms);
          const downloadSpeed = status && status.down_rate_bps > 0 ? fmtBytesPerSec(status.down_rate_bps) : null;
          const progress = status ? fmtPct(status.progress) : null;

          return (
            <div
              key={t.id}
              className={`row ${t.id === selectedId ? "active" : ""}`}
              onClick={() => handleClick(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleClick(t.id);
                }
              }}
              aria-label={`Select torrent ${t.name}`}
            >
              <div className="rowMain">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ 
                    width: '4px', 
                    height: '4px', 
                    borderRadius: '50%', 
                    background: t.running ? 'var(--success)' : 'var(--text-muted)',
                    flexShrink: 0
                  }} />
                  <div className="rowTitle">{t.name}</div>
                </div>
                <div className="rowSub">
                  <span className="pill">
                    {t.profile.mode.toUpperCase()}
                    {t.profile.mode === "anonymous" ? ` • ${t.profile.hops} HOPS` : ""}
                  </span>
                  <span className={`pill ${t.running ? "ok" : ""}`}>
                    {t.running ? "RUNNING" : "STOPPED"}
                  </span>
                  {sizeInfo && (
                    <span className="pill" style={{ fontSize: "0.85em" }}>
                      {sizeInfo}
                    </span>
                  )}
                  {progress && (
                    <span className="pill" style={{ fontSize: "0.85em" }}>
                      {progress}
                    </span>
                  )}
                  {downloadSpeed && (
                    <span className="pill" style={{ fontSize: "0.85em", color: "var(--success)" }}>
                      ↓ {downloadSpeed}
                    </span>
                  )}
                  <span className="pill" style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>
                    {timeElapsed}
                  </span>
                </div>
              </div>
              <div className="rowId">{t.id.slice(0, 8)}…</div>
            </div>
          );
        })}
      </div>
    </section>
  );
});

TorrentList.displayName = "TorrentList";
