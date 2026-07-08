import React, { memo } from "react";

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

export const DownloadsToolbar = memo<DownloadsToolbarProps>(
  ({
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
    const filters: Array<{ id: FilterType; label: string }> = [
      { id: "all", label: "All" },
      { id: "downloading", label: "Downloading" },
      { id: "seeding", label: "Seeding" },
      { id: "completed", label: "Completed" },
      { id: "error", label: "Error" },
    ];

    return (
      <div className="downloadsToolbar">
        <div className="downloadsToolbarSearchRow">
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
            placeholder="Search torrents, files, trackers, peers..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            disabled={!online}
          />
        </div>
        <div className="downloadsToolbarFilters">
          {filters.map((item) => (
            <button
              key={item.id}
              className={`filterChip ${filter === item.id ? "active" : ""}`}
              onClick={() => onFilterChange(item.id)}
              disabled={!online}
              aria-pressed={filter === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
);

DownloadsToolbar.displayName = "DownloadsToolbar";
