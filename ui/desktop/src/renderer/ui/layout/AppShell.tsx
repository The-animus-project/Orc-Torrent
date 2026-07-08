import React, { memo } from "react";
import type { Health, SearchFeatureSettings, VpnStatus, KillSwitchState } from "../../types";
import { VpnStatusLed } from "../../components/VpnStatusLed";
import { DaemonHealthLed, type DaemonHealthState } from "../../components/DaemonHealthLed";
import { ToolbarSearch } from "../../components/ToolbarSearch";

interface AppShellProps {
  online: boolean;
  version: string;
  health: Health | null;
  daemonHealthState: DaemonHealthState;
  daemonHealthDetails?: string;
  vpnStatus: VpnStatus | null;
  killSwitchState: KillSwitchState;
  onVpnLedClick: () => void;
  onHealthClick?: () => void;
  onRefresh: () => void;
  onAddMagnet: () => void;
  onAddTorrent: () => void;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  onRemove: () => void;
  onForceRecheck: () => void;
  onForceAnnounce: () => void;
  onSettings: () => void;
  settingsButtonLabel?: string;
  settingsButtonTitle?: string;
  settingsButtonAriaLabel?: string;
  searchSettings: SearchFeatureSettings | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onTorrentAdded: (id: string, showFileDialog?: boolean, torrentName?: string) => void | Promise<void>;
  onSearchError: (message: string) => void;
  onSearchSuccess: (message: string) => void;
  loadingOperations?: Set<string>;
  editionBadge?: string;
  tagline?: string;
  accentColor?: string;
  logoUrl?: string;
  isAnimusEdition?: boolean;
}

export const AppShell = memo<AppShellProps>(
  ({
    online,
    version,
    health,
    daemonHealthState,
    daemonHealthDetails,
    vpnStatus,
    killSwitchState,
    onVpnLedClick,
    onHealthClick,
    onRefresh,
    onAddMagnet,
    onAddTorrent,
    onStart,
    onPause,
    onStop,
    onRemove,
    onForceRecheck,
    onForceAnnounce,
    onSettings,
    settingsButtonLabel = "Settings",
    settingsButtonTitle = "Open Settings (Ctrl+,)",
    settingsButtonAriaLabel = "Open Settings",
    searchSettings,
    searchQuery,
    onSearchChange,
    onTorrentAdded,
    onSearchError,
    onSearchSuccess,
    loadingOperations = new Set(),
  editionBadge = "",
  tagline = "Private torrent client",
  accentColor = "",
  logoUrl = "./images/orctorrent-logo.png",
  isAnimusEdition = false,
}) => {
    const accentStyle = accentColor
      ? ({ ["--edition-accent" as string]: accentColor } as React.CSSProperties)
      : undefined;

    return (
      <div className="appShell" style={accentStyle}>
        <div className="menuBar">
        <div className="menuBarLeft">
          <div className={`brand${isAnimusEdition ? " brandAnimus" : ""}`}>
            <div className={`logo${isAnimusEdition ? "" : " brandLogo"}`}>
              <img src={logoUrl} alt={isAnimusEdition ? "" : "ORC TORRENT"} />
            </div>
            {!isAnimusEdition ? (
              <div className="titles">
                <div className="tag">{tagline}</div>
              </div>
            ) : (
              <div className="titles">
                <div className="tag animusTagOnly">{tagline}</div>
              </div>
            )}
          </div>
            {editionBadge ? (
              <div className="editionBrandBadge" aria-label={editionBadge}>
                {editionBadge}
              </div>
            ) : null}
          </div>
          <div className="menuBarRight">
            <VpnStatusLed vpnStatus={vpnStatus} killSwitchState={killSwitchState} onClick={onVpnLedClick} />
            <DaemonHealthLed state={daemonHealthState} onClick={onHealthClick} details={daemonHealthDetails} />
            <button
              className="btn topActionBtn"
              type="button"
              onClick={onAddMagnet}
              disabled={!online}
              title="Add Magnet Link (Ctrl+M)"
              aria-label="Add Magnet Link"
            >
              + Magnet
            </button>
            <button
              className="btn topActionBtn"
              type="button"
              onClick={onAddTorrent}
              disabled={!online}
              title="Add Torrent File (Ctrl+T)"
              aria-label="Add Torrent File"
            >
              + Torrent
            </button>
            <button
              className="btn topActionBtn"
              type="button"
              onClick={onSettings}
              title={settingsButtonTitle}
              aria-label={settingsButtonAriaLabel}
            >
              {settingsButtonLabel}
            </button>
            <ToolbarSearch
              online={online}
              settings={searchSettings}
              query={searchQuery}
              onQueryChange={onSearchChange}
              onTorrentAdded={onTorrentAdded}
              onError={onSearchError}
              onSuccess={onSearchSuccess}
            />
            <div className="topVersionChip">v{version}</div>
          </div>
        </div>
      </div>
    );
  }
);

AppShell.displayName = "AppShell";
