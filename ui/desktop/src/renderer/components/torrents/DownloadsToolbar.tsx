import React, { memo, useCallback, useState } from "react";

export type FilterType = "all" | "downloading" | "seeding" | "completed" | "error";

interface DownloadsToolbarProps {
  onAddMagnet: () => void;
  onAddTorrent: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onSpeedLimitToggle: () => void;
  speedLimitEnabled: boolean;
  filter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  activeCount: number;
  online: boolean;
}

export const DownloadsToolbar = memo<DownloadsToolbarProps>(({
  onAddMagnet,
  onAddTorrent,
  onPauseAll,
  onResumeAll,
  onSpeedLimitToggle,
  speedLimitEnabled,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  activeCount,
  online,
}) => {
  return (
    <div className="downloadsToolbar">
      <div className="downloadsToolbarLeft">
        <button
          className="btn primary"
          onClick={onAddMagnet}
          disabled={!online}
          title="Add Magnet Link"
        >
          + Magnet
        </button>
        <button
          className="btn primary"
          onClick={onAddTorrent}
          disabled={!online}
          title="Add Torrent File"
        >
          + Torrent
        </button>
        <div className="toolbarDivider" />
        <button
          className="btn"
          onClick={onPauseAll}
          disabled={!online || activeCount === 0}
          title="Pause All Active Torrents"
        >
          Pause All
        </button>
        <button
          className="btn"
          onClick={onResumeAll}
          disabled={!online}
          title="Resume All Paused Torrents"
        >
          Resume All
        </button>
      </div>
      
      <div className="downloadsToolbarCenter">
        <select
          className="filterSelect"
          value={filter}
          onChange={(e) => onFilterChange(e.target.value as FilterType)}
          disabled={!online}
        >
          <option value="all">All</option>
          <option value="downloading">Downloading</option>
          <option value="seeding">Seeding</option>
          <option value="completed">Completed</option>
          <option value="error">Error</option>
        </select>
        <input
          type="text"
          className="searchInput"
          placeholder="Search torrents..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          disabled={!online}
        />
      </div>

      <div className="downloadsToolbarRight">
        {/* Speed limit feature - hidden until backend API is implemented
        <button
          className={`btn ${speedLimitEnabled ? "active" : ""}`}
          onClick={onSpeedLimitToggle}
          disabled={!online}
          title="Toggle Speed Limits"
        >
          Limit
        </button>
        */}
      </div>
    </div>
  );
});

DownloadsToolbar.displayName = "DownloadsToolbar";
