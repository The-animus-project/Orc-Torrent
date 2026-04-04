import React, { memo, useCallback, useState } from "react";
import type { Health, VpnStatus, KillSwitchState } from "../../types";
import { VpnStatusLed } from "../../components/VpnStatusLed";
import { DaemonHealthLed, type DaemonHealthState } from "../../components/DaemonHealthLed";

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
  searchQuery: string;
  onSearchChange: (query: string) => void;
  loadingOperations?: Set<string>;
}

export const AppShell = memo<AppShellProps>(({
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
  searchQuery,
  onSearchChange,
  loadingOperations = new Set(),
}) => {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const handleMenuClick = useCallback((menu: string) => {
    setMenuOpen(menuOpen === menu ? null : menu);
  }, [menuOpen]);

  return (
    <div className="appShell">
      {/* Menu Bar */}
      <div className="menuBar">
        <div className="menuBarLeft">
          <div className="brand">
            <div className="logo" aria-hidden>
              <img src="./images/orctorrent-logo.png" alt="" />
            </div>
            <div className="titles">
              <div className="name">ORC TORRENT</div>
              <div className="tag">The Apex Downloader</div>
            </div>
          </div>
        </div>
        <div className="menuBarRight">
          <VpnStatusLed
            vpnStatus={vpnStatus}
            killSwitchState={killSwitchState}
            onClick={onVpnLedClick}
          />
          <DaemonHealthLed
            state={daemonHealthState}
            onClick={onHealthClick}
            details={daemonHealthDetails}
          />
          <div className="chip neutral">
            <span style={{ opacity: 0.7 }}>v</span>{version}
          </div>
        </div>
      </div>

      {/* Primary Toolbar */}
      <div className="toolbar">
        <div className="toolbarLeft">
          <button 
            className="btn primary" 
            onClick={onAddMagnet}
            disabled={!online}
            title="Add Magnet Link (Ctrl+M)"
            aria-label="Add Magnet Link"
            aria-disabled={!online}
          >
            ADD MAGNET
          </button>
          <button 
            className="btn" 
            onClick={onAddTorrent}
            disabled={!online}
            title="Add Torrent File (Ctrl+T)"
            aria-label="Add Torrent File"
            aria-disabled={!online}
          >
            ADD TORRENT
          </button>
          <div className="divider" role="separator" aria-orientation="vertical" />
          <button 
            className="btn" 
            onClick={onStart}
            disabled={!online || loadingOperations.has("start")}
            title="Start Selected Torrents"
            aria-label="Start Selected Torrents"
            aria-busy={loadingOperations.has("start")}
            aria-disabled={!online || loadingOperations.has("start")}
          >
            {loadingOperations.has("start") ? "STARTING..." : "START"}
          </button>
          <button 
            className="btn" 
            onClick={onPause}
            disabled={!online || loadingOperations.has("stop")}
            title="Pause Selected Torrents"
            aria-label="Pause Selected Torrents"
            aria-busy={loadingOperations.has("stop")}
            aria-disabled={!online || loadingOperations.has("stop")}
          >
            {loadingOperations.has("stop") ? "PAUSING..." : "PAUSE"}
          </button>
          <button 
            className="btn" 
            onClick={onStop}
            disabled={!online || loadingOperations.has("stop")}
            title="Stop Selected Torrents"
            aria-label="Stop Selected Torrents"
            aria-busy={loadingOperations.has("stop")}
            aria-disabled={!online || loadingOperations.has("stop")}
          >
            {loadingOperations.has("stop") ? "STOPPING..." : "STOP"}
          </button>
          <button 
            className="btn" 
            onClick={onRemove}
            disabled={!online || loadingOperations.has("remove")}
            title="Remove Selected Torrents"
            aria-label="Remove Selected Torrents"
            aria-busy={loadingOperations.has("remove")}
            aria-disabled={!online || loadingOperations.has("remove")}
          >
            {loadingOperations.has("remove") ? "REMOVING..." : "REMOVE"}
          </button>
          <div className="divider" role="separator" aria-orientation="vertical" />
          <button 
            className="btn ghost" 
            onClick={onForceRecheck}
            disabled={!online || loadingOperations.has("recheck")}
            title="Force Recheck Selected Torrents"
            aria-label="Force Recheck Selected Torrents"
            aria-busy={loadingOperations.has("recheck")}
            aria-disabled={!online || loadingOperations.has("recheck")}
          >
            {loadingOperations.has("recheck") ? "RECHECKING..." : "FORCE RECHECK"}
          </button>
          <button 
            className="btn ghost" 
            onClick={onForceAnnounce}
            disabled={!online || loadingOperations.has("announce")}
            title="Force Announce to Trackers"
            aria-label="Force Announce to Trackers"
            aria-busy={loadingOperations.has("announce")}
            aria-disabled={!online || loadingOperations.has("announce")}
          >
            {loadingOperations.has("announce") ? "ANNOUNCING..." : "FORCE ANNOUNCE"}
          </button>
        </div>
        <div className="toolbarRight">
          <button 
            className="btn ghost" 
            onClick={onSettings}
            title="Open Settings (Ctrl+,)"
            aria-label="Open Settings"
          >
            SETTINGS
          </button>
          <button 
            className="btn ghost" 
            onClick={onRefresh}
            title="Refresh Data (F5)"
            aria-label="Refresh Data"
          >
            REFRESH
          </button>
        </div>
      </div>

      {/* Global Search */}
      <div className="searchBar">
        <input
          className="input searchInput"
          type="text"
          placeholder="Search torrents, files, trackers, peers..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          spellCheck={false}
          aria-label="Search torrents"
          aria-describedby="search-description"
          role="searchbox"
        />
        <span id="search-description" className="sr-only">
          Search through torrents by name, ID, files, trackers, or peers
        </span>
      </div>
    </div>
  );
});

AppShell.displayName = "AppShell";
