import React, { memo, useCallback, useState, useMemo, useEffect } from "react";
import { useDebounce } from "../../utils/useDebounce";
import type { Torrent, TorrentStatus } from "../../types";
import type { SortColumn, SortDirection } from "./TorrentTable";
import { TorrentTable } from "./TorrentTable";
import { ColumnChooser } from "./ColumnChooser";
import { BulkActionPanel } from "./BulkActionPanel";
import { DownloadsToolbar, type FilterType } from "./DownloadsToolbar";

interface TorrentPortfolioProps {
  torrents: Torrent[];
  statuses: Map<string, TorrentStatus>;
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onStart: (ids: string[]) => void;
  onPause: (ids: string[]) => void;
  onStop: (ids: string[]) => void;
  onRemove: (ids: string[]) => void;
  onSetPriority: (ids: string[], priority: "low" | "normal" | "high") => void;
  onMoveData: (ids: string[]) => void;
  onExportTorrent: (ids: string[]) => void;
  onSetLimits: (ids: string[]) => void;
  onApplyLabel: (ids: string[], label: string) => void;
  onSetVpnPolicy: (ids: string[], policy: "standard" | "private" | "anonymous") => void;
  availableLabels: string[];
  online: boolean;
  filter: FilterType;
  onFilterChange: (filter: FilterType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onAddMagnet: () => void;
  onAddTorrent: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  speedLimitEnabled: boolean;
  onSpeedLimitToggle: () => void;
}

const DEFAULT_VISIBLE_COLUMNS: Set<SortColumn> = new Set([
  "name",
  "progress",
  "downloaded",
  "eta",
  "speed",
  "peers",
  "status",
]);

export const TorrentPortfolio = memo<TorrentPortfolioProps>(({
  torrents,
  statuses,
  selectedIds,
  onSelect,
  onStart,
  onPause,
  onStop,
  onRemove,
  onSetPriority,
  onMoveData,
  onExportTorrent,
  onSetLimits,
  onApplyLabel,
  onSetVpnPolicy,
  availableLabels,
  online,
  filter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onAddMagnet,
  onAddTorrent,
  onPauseAll,
  onResumeAll,
  speedLimitEnabled,
  onSpeedLimitToggle,
}) => {
  const [sortColumn, setSortColumn] = useState<SortColumn>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [visibleColumns, setVisibleColumns] = useState<Set<SortColumn>>(DEFAULT_VISIBLE_COLUMNS);
  const [savedLayouts, setSavedLayouts] = useState<string[]>([]);

  // Load saved layouts from localStorage on mount
  useEffect(() => {
    try {
      const layouts = JSON.parse(localStorage.getItem("orc-torrent-column-layouts") || "[]");
      setSavedLayouts(layouts.map((l: any) => l.name));
    } catch (e) {
      // Failed to load saved layouts - non-critical, continue with defaults
    }
  }, []);

  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  }, [sortColumn]);

  const handleSelectAll = useCallback((selected: boolean) => {
    if (selected) {
      torrents.forEach(t => {
        if (!selectedIds.has(t.id)) {
          onSelect(t.id, true);
        }
      });
    } else {
      selectedIds.forEach(id => {
        onSelect(id, false);
      });
    }
  }, [torrents, selectedIds, onSelect]);

  const handleSaveLayout = useCallback((name: string) => {
    try {
      const layouts = JSON.parse(localStorage.getItem("orc-torrent-column-layouts") || "[]");
      const layoutData = {
        name,
        visibleColumns: Array.from(visibleColumns),
        savedAt: Date.now(),
      };
      // Check if layout with same name exists
      const existingIndex = layouts.findIndex((l: any) => l.name === name);
      if (existingIndex >= 0) {
        layouts[existingIndex] = layoutData;
      } else {
        layouts.push(layoutData);
      }
      localStorage.setItem("orc-torrent-column-layouts", JSON.stringify(layouts));
      setSavedLayouts(layouts.map((l: any) => l.name));
    } catch (e) {
      // Failed to save layout - non-critical, user can try again
    }
  }, [visibleColumns]);

  const handleLoadLayout = useCallback((name: string) => {
    try {
      const layouts = JSON.parse(localStorage.getItem("orc-torrent-column-layouts") || "[]");
      const layout = layouts.find((l: any) => l.name === name);
      if (layout && layout.visibleColumns) {
        setVisibleColumns(new Set(layout.visibleColumns));
      }
    } catch (e) {
      // Failed to load layout - non-critical, continue with current layout
    }
  }, []);

  const selectedArray = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // Calculate active torrent count (downloading or seeding)
  const activeCount = useMemo(() => {
    return torrents.filter(t => {
      const status = statuses.get(t.id);
      return status && (status.state === "downloading" || status.state === "seeding");
    }).length;
  }, [torrents, statuses]);

  // Debounce search query for better performance
  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Filter torrents based on filter type
  const filteredTorrents = useMemo(() => {
    let filtered = torrents;

    // Apply search (use debounced query)
    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase();
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.id.toLowerCase().includes(query)
      );
    }

    // Apply filter
    if (filter !== "all") {
      filtered = filtered.filter(t => {
        const status = statuses.get(t.id);
        if (!status) return filter === "error";
        switch (filter) {
          case "downloading":
            return status.state === "downloading";
          case "seeding":
            return status.state === "seeding";
          case "completed":
            return status.state === "seeding" && status.progress >= 1;
          case "error":
            return status.state === "error";
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [torrents, debouncedSearchQuery, filter, statuses]);

  return (
    <div className="torrentPortfolio">
      <div className="torrentPortfolioHeader">
        <div className="torrentPortfolioTitle">Downloads</div>
        <ColumnChooser
          visibleColumns={visibleColumns}
          onColumnsChange={setVisibleColumns}
          savedLayouts={savedLayouts}
          onSaveLayout={handleSaveLayout}
          onLoadLayout={handleLoadLayout}
        />
      </div>
      <DownloadsToolbar
        onAddMagnet={onAddMagnet}
        onAddTorrent={onAddTorrent}
        onPauseAll={onPauseAll}
        onResumeAll={onResumeAll}
        onSpeedLimitToggle={onSpeedLimitToggle}
        speedLimitEnabled={speedLimitEnabled}
        filter={filter}
        onFilterChange={onFilterChange}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        activeCount={activeCount}
        online={online}
      />
      <BulkActionPanel
        selectedCount={selectedIds.size}
        onStart={() => onStart(selectedArray)}
        onPause={() => onPause(selectedArray)}
        onStop={() => onStop(selectedArray)}
        onRemove={() => onRemove(selectedArray)}
        onSetPriority={(priority) => onSetPriority(selectedArray, priority)}
        onMoveData={() => onMoveData(selectedArray)}
        onExportTorrent={() => onExportTorrent(selectedArray)}
        onSetLimits={() => onSetLimits(selectedArray)}
        onApplyLabel={(label) => onApplyLabel(selectedArray, label)}
        onSetVpnPolicy={(policy) => onSetVpnPolicy(selectedArray, policy)}
        availableLabels={availableLabels}
        online={online}
      />
      <TorrentTable
        torrents={filteredTorrents}
        statuses={statuses}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onSelectAll={handleSelectAll}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={handleSort}
        visibleColumns={visibleColumns}
      />
    </div>
  );
});

TorrentPortfolio.displayName = "TorrentPortfolio";
