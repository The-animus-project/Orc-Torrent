import React, { memo } from "react";
import type { NetPosture, Torrent, TorrentStatus } from "../types";
import { fmtBytesPerSec } from "../utils/format";

interface DashboardTorrent {
  torrent: Torrent;
  status: TorrentStatus | null;
}

interface AnimusDashboardPageProps {
  online: boolean;
  downloadingCount: number;
  seedingCount: number;
  globalDownSpeed: number;
  globalUpSpeed: number;
  netPosture: NetPosture | null;
  dashboardTorrents: DashboardTorrent[];
  panelWatermarkUrl?: string;
  onOpenDownloads: () => void;
  onAddTorrent: () => void;
  onSelectTorrent: (torrentId: string) => void;
}

function formatProgress(status: TorrentStatus | null): string {
  if (!status) {
    return "Queued";
  }
  return `${Math.round(status.progress * 100)}%`;
}

function formatAddedAt(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs;
  const diffMinutes = Math.max(1, Math.round(diffMs / 60_000));
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return new Date(timestampMs).toLocaleDateString();
}

export const AnimusDashboardPage = memo<AnimusDashboardPageProps>(
  ({
    online,
    downloadingCount,
    seedingCount,
    globalDownSpeed,
    globalUpSpeed,
    netPosture,
    dashboardTorrents,
    panelWatermarkUrl,
    onOpenDownloads,
    onAddTorrent,
    onSelectTorrent,
  }) => {
    const protectionLabel = !online
      ? "Reconnecting"
      : netPosture?.state === "protected"
        ? "Protected"
        : netPosture?.state === "leak_risk"
          ? "At Risk"
          : "Checking";

    const protectionDetail = !online
      ? "Daemon offline, waiting for the local swarm services."
      : netPosture?.bind_interface
        ? `Bound to ${netPosture.bind_interface}`
        : "VPN and bind posture are being refreshed.";

    return (
      <div className="animusDashboardPage">
        <h1 className="animusDashboardHeading">Dashboard</h1>

        <section className="animusDashboardMetrics">
          <article className="animusMetricCard">
            <div className="animusMetricLabel">Downloading</div>
            <div className="animusMetricValue">{downloadingCount}</div>
            <div className="animusMetricSubtle">Active transfer lanes</div>
          </article>
          <article className="animusMetricCard">
            <div className="animusMetricLabel">Seeding</div>
            <div className="animusMetricValue">{seedingCount}</div>
            <div className="animusMetricSubtle">Uploads contributing to the swarm</div>
          </article>
          <article className="animusMetricCard">
            <div className="animusMetricLabel">Down Speed</div>
            <div className="animusMetricValue">{fmtBytesPerSec(globalDownSpeed)}</div>
            <div className="animusMetricSubtle">Current aggregate receive rate</div>
          </article>
          <article className="animusMetricCard">
            <div className="animusMetricLabel">Up Speed</div>
            <div className="animusMetricValue">{fmtBytesPerSec(globalUpSpeed)}</div>
            <div className="animusMetricSubtle">Current aggregate send rate</div>
          </article>
          <article className="animusMetricCard">
            <div className="animusMetricLabel">Protection</div>
            <div className={`animusMetricValue animusMetricValueStatus ${netPosture?.state ?? "unconfigured"}`}>
              {protectionLabel}
            </div>
            <div className="animusMetricSubtle">{protectionDetail}</div>
          </article>
        </section>

        <section className="animusDashboardPanel">
          {panelWatermarkUrl ? (
            <img src={panelWatermarkUrl} alt="" aria-hidden="true" className="animusDashboardPanelWatermark" />
          ) : null}
          <div className="animusPanelHeader">
            <div>
              <div className="animusPanelEyebrow">Active Torrents</div>
              <h2 className="animusPanelTitle">Live queue</h2>
            </div>
            <button type="button" className="btn" onClick={onOpenDownloads}>
              Open full Downloads view
            </button>
          </div>

          {dashboardTorrents.length === 0 ? (
            <div className="animusDashboardEmpty">
              <div className="animusDashboardEmptyTitle">No torrents yet</div>
              <p className="animusDashboardEmptyBody">
                Add a torrent to start filling the queue and light up the AnimUS dashboard.
              </p>
              <button type="button" className="btn primary" onClick={onAddTorrent}>
                Add your first torrent
              </button>
            </div>
          ) : (
            <div className="animusTorrentTable">
              <div className="animusTorrentTableHeader">
                <span>Name</span>
                <span>Status</span>
                <span>Progress</span>
                <span>Down</span>
                <span>Up</span>
                <span>Added</span>
              </div>

              {dashboardTorrents.map(({ torrent, status }) => (
                <button
                  key={torrent.id}
                  type="button"
                  className="animusTorrentRow"
                  onClick={() => onSelectTorrent(torrent.id)}
                >
                  <span className="animusTorrentName">{torrent.name}</span>
                  <span className={`animusTorrentState ${status?.state ?? "stopped"}`}>
                    {status?.state ?? "queued"}
                  </span>
                  <span className="animusTorrentProgress">
                    <span className="animusTorrentProgressText">{formatProgress(status)}</span>
                    <span className="animusTorrentProgressBar">
                      <span
                        className="animusTorrentProgressFill"
                        style={{ width: `${Math.round((status?.progress ?? 0) * 100)}%` }}
                      />
                    </span>
                  </span>
                  <span>{fmtBytesPerSec(status?.down_rate_bps ?? 0)}</span>
                  <span>{fmtBytesPerSec(status?.up_rate_bps ?? 0)}</span>
                  <span>{formatAddedAt(torrent.added_at_ms)}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }
);

AnimusDashboardPage.displayName = "AnimusDashboardPage";
