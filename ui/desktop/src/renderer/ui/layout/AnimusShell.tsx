import React, { memo } from "react";
import { DaemonHealthLed, type DaemonHealthState } from "../../components/DaemonHealthLed";
import { VpnStatusLed } from "../../components/VpnStatusLed";
import { ToolbarSearch } from "../../components/ToolbarSearch";
import type { KillSwitchState, SearchFeatureSettings, VpnStatus } from "../../types";
import { fmtBytesPerSec } from "../../utils/format";

export type AnimusPageId = "dashboard" | "torrents" | "search" | "network" | "events" | "settings";

interface AnimusShellProps {
  online: boolean;
  currentPage: AnimusPageId;
  onNavigate: (page: AnimusPageId) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchSettings: SearchFeatureSettings | null;
  onTorrentAdded: (id: string, showFileDialog?: boolean, torrentName?: string) => void | Promise<void>;
  onSearchError: (message: string) => void;
  onSearchSuccess: (message: string) => void;
  sidebarLogoUrl: string;
  logoUrl: string;
  sidebarEmblemUrl: string;
  globalDownSpeed: number;
  globalUpSpeed: number;
  vpnStatus: VpnStatus | null;
  killSwitchState: KillSwitchState;
  daemonHealthState: DaemonHealthState;
  daemonHealthDetails?: string;
  onVpnStatusClick: () => void;
  onDaemonHealthClick?: () => void;
  onAddTorrent: () => void;
  onOpenEvents: () => void;
  onOpenWebsite: () => void;
  version: string;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{ id: AnimusPageId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "torrents", label: "Downloads" },
  { id: "search", label: "Search" },
  { id: "network", label: "Network" },
  { id: "events", label: "Events" },
  { id: "settings", label: "Settings" },
];

function NavIcon({ page }: { page: AnimusPageId }) {
  switch (page) {
    case "dashboard":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      );
    case "torrents":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11" />
          <path d="M8 10.5 12 14.5l4-4" />
          <path d="M4 19h16" />
        </svg>
      );
    case "search":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" />
        </svg>
      );
    case "network":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4.5 9.5a12 12 0 0 1 15 0" />
          <path d="M7.5 13a8 8 0 0 1 9 0" />
          <path d="M10.5 16.5a4 4 0 0 1 3 0" />
          <circle cx="12" cy="19" r="1.2" />
        </svg>
      );
    case "events":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4a5 5 0 0 0-5 5v2.6L5.6 14a1 1 0 0 0 .85 1.5h11.1a1 1 0 0 0 .85-1.5L17 11.6V9a5 5 0 0 0-5-5Z" />
          <path d="M10 18a2 2 0 0 0 4 0" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 2.5v2.2" />
          <path d="M12 19.3v2.2" />
          <path d="m4.7 4.7 1.6 1.6" />
          <path d="m17.7 17.7 1.6 1.6" />
          <path d="M2.5 12h2.2" />
          <path d="M19.3 12h2.2" />
          <path d="m4.7 19.3 1.6-1.6" />
          <path d="m17.7 6.3 1.6-1.6" />
        </svg>
      );
    default:
      return null;
  }
}

export const AnimusShell = memo<AnimusShellProps>(
  ({
    online,
    currentPage,
    onNavigate,
    searchQuery,
    onSearchChange,
    searchSettings,
    onTorrentAdded,
    onSearchError,
    onSearchSuccess,
    sidebarLogoUrl,
    logoUrl,
    sidebarEmblemUrl,
    globalDownSpeed,
    globalUpSpeed,
    vpnStatus,
    killSwitchState,
    daemonHealthState,
    daemonHealthDetails,
    onVpnStatusClick,
    onDaemonHealthClick,
    onAddTorrent,
    onOpenEvents,
    onOpenWebsite,
    version,
    children,
  }) => {
    return (
      <div className="animusShell">
        <aside className="animusRail">
          <div className="animusRailBrand">
            <img src={sidebarLogoUrl || logoUrl} alt="ORC TORRENT AnimUS Edition" className="animusRailLogo" />
          </div>

          <nav className="animusRailNav" aria-label="AnimUS navigation">
            {NAV_ITEMS.map((item) => {
              const active = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`animusRailButton ${active ? "active" : ""}`}
                  onClick={() => onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="animusRailIcon">
                    <NavIcon page={item.id} />
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="animusRailArtwork">
            {sidebarEmblemUrl ? <img src={sidebarEmblemUrl} alt="" className="animusRailEmblem" /> : null}
          </div>
          <button
            type="button"
            className="officialWebsiteLink animusRailWebsite"
            onClick={onOpenWebsite}
            title="Open the official ORC Torrent website"
          >
            Orclabs.io ↗
          </button>
        </aside>

        <section className="animusSurface">
          <div className="animusTopBar">
            <ToolbarSearch
              online={online}
              settings={searchSettings}
              query={searchQuery}
              onQueryChange={onSearchChange}
              onTorrentAdded={onTorrentAdded}
              onError={onSearchError}
              onSuccess={onSearchSuccess}
              onOpenSearch={() => onNavigate("search")}
              variant="animus"
            />

            <div className="animusTopBarActions">
              <div className="animusSpeedChip down">
                <span className="animusSpeedIcon">↓</span>
                <span>{fmtBytesPerSec(globalDownSpeed)}</span>
              </div>
              <div className="animusSpeedChip up">
                <span className="animusSpeedIcon">↑</span>
                <span>{fmtBytesPerSec(globalUpSpeed)}</span>
              </div>

              <VpnStatusLed vpnStatus={vpnStatus} killSwitchState={killSwitchState} onClick={onVpnStatusClick} />
              <DaemonHealthLed state={daemonHealthState} onClick={onDaemonHealthClick} details={daemonHealthDetails} />

              <button type="button" className="btn animusTopBarButton" onClick={onOpenEvents}>
                Events
              </button>
              <button type="button" className="btn primary animusTopBarButton" onClick={onAddTorrent}>
                Add Torrent
              </button>
              <div className="animusVersionLabel">v{version}</div>
            </div>
          </div>

          <div className="animusContent">{children}</div>
        </section>
      </div>
    );
  }
);

AnimusShell.displayName = "AnimusShell";
