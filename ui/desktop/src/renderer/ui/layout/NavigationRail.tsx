import React, { memo } from "react";

export type StatusFilter = "all" | "downloading" | "seeding" | "completed" | "checking" | "paused" | "error";

export type SmartView = "high-risk" | "private-mode" | "vpn-required" | "low-health" | "stalled";

interface NavigationRailProps {
  activeStatusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  activeSmartView: SmartView | null;
  onSmartViewChange: (view: SmartView | null) => void;
  labels: string[];
  onLabelClick: (label: string) => void;
  watchFoldersCount: number;
  onWatchFoldersClick: () => void;
  currentPage?: "torrents" | "network" | "settings" | "events";
  onNetworkPageClick?: () => void;
  onSettingsPageClick?: () => void;
  onEventsPageClick?: () => void;
}

export const NavigationRail = memo<NavigationRailProps>(({
  activeStatusFilter,
  onStatusFilterChange,
  activeSmartView,
  onSmartViewChange,
  labels,
  onLabelClick,
  watchFoldersCount,
  onWatchFoldersClick,
  currentPage = "torrents",
  onNetworkPageClick,
  onSettingsPageClick,
  onEventsPageClick,
}) => {
  const statusFilters: { id: StatusFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "downloading", label: "Downloading" },
    { id: "seeding", label: "Seeding" },
    { id: "completed", label: "Completed" },
    { id: "checking", label: "Checking" },
    { id: "paused", label: "Paused" },
    { id: "error", label: "Error" },
  ];

  const smartViews: { id: SmartView; label: string }[] = [
    { id: "high-risk", label: "High Risk" },
    { id: "private-mode", label: "Private Mode" },
    { id: "vpn-required", label: "VPN Required" },
    { id: "low-health", label: "Low Health" },
    { id: "stalled", label: "Stalled" },
  ];

  return (
    <div className="navigationRail">
      {/* Status Filters */}
      <div className="navSection">
        <div className="navSectionTitle">Status</div>
        <div className="navFilters">
          {statusFilters.map((filter) => (
            <button
              key={filter.id}
              className={`navFilter ${activeStatusFilter === filter.id ? "active" : ""}`}
              onClick={() => onStatusFilterChange(filter.id)}
              aria-pressed={activeStatusFilter === filter.id}
              aria-label={`Filter torrents by status: ${filter.label}`}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {/* Smart Views */}
      <div className="navSection">
        <div className="navSectionTitle">Smart Views</div>
        <div className="navFilters">
          {smartViews.map((view) => (
            <button
              key={view.id}
              className={`navFilter ${activeSmartView === view.id ? "active" : ""}`}
              onClick={() => onSmartViewChange(activeSmartView === view.id ? null : view.id)}
              aria-pressed={activeSmartView === view.id}
              aria-label={`Switch to smart view: ${view.label}`}
            >
              {view.label}
            </button>
          ))}
        </div>
      </div>

      {/* Labels/Tags */}
      {labels.length > 0 && (
        <div className="navSection">
          <div className="navSectionTitle">Labels</div>
          <div className="navLabels">
            {labels.map((label) => (
              <button
                key={label}
                className="navLabel"
                onClick={() => onLabelClick(label)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Watch Folders */}
      <div className="navSection">
        <button
          className="navWatchFolder"
          onClick={onWatchFoldersClick}
        >
          <span>Watch Folders</span>
          {watchFoldersCount > 0 && (
            <span className="navBadge">{watchFoldersCount}</span>
          )}
        </button>
      </div>

      {/* Pages */}
      <div className="navSection">
        <div className="navSectionTitle">Pages</div>
        <button
          className={`navFilter ${currentPage === "network" ? "active" : ""}`}
          onClick={onNetworkPageClick || (() => {})}
          aria-pressed={currentPage === "network"}
          aria-label="Navigate to Network page"
        >
          Network
        </button>
        <button
          className={`navFilter ${currentPage === "events" ? "active" : ""}`}
          onClick={onEventsPageClick || (() => {})}
          aria-pressed={currentPage === "events"}
          aria-label="Navigate to Events page"
        >
          Events
        </button>
        <button
          className={`navFilter ${currentPage === "settings" ? "active" : ""}`}
          onClick={onSettingsPageClick || (() => {})}
          aria-pressed={currentPage === "settings"}
          aria-label="Navigate to Settings page"
        >
          Settings
        </button>
      </div>
    </div>
  );
});

NavigationRail.displayName = "NavigationRail";
