import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Torrent, TorrentStatus } from "../../types";
import {
  fmtBytes,
  fmtBytesPerSec,
  fmtPct,
  fmtEta,
  fmtTimeElapsed,
  fmtSizeProgress,
  fmtSpeedDownUp,
  fmtPeersSeeds,
  getEffectiveEta,
} from "../../utils/format";
import { useEmaEta } from "../../utils/useEmaEta";
import { Modal } from "../Modal";
import { TorrentRowSignal } from "./TorrentRowSignal";

export type SortColumn =
  | "name"
  | "progress"
  | "downloaded"
  | "status"
  | "size"
  | "eta"
  | "speed"
  | "seeds"
  | "peers"
  | "downSpeed"
  | "upSpeed"
  | "ratio"
  | "queue"
  | "added"
  | "availability"
  | "health";
export type SortDirection = "asc" | "desc";

interface TorrentTableProps {
  torrents: Torrent[];
  statuses: Map<string, TorrentStatus>;
  selectedIds: Set<string>;
  onSelect: (id: string, multi: boolean) => void;
  onSelectAll: (selected: boolean) => void;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSort: (column: SortColumn) => void;
  visibleColumns: Set<SortColumn>;
  rowSnapshotPollMs?: number;
}

interface Column {
  id: SortColumn;
  label: string;
  width: number;
  sortable: boolean;
}

const COLUMNS: Column[] = [
  { id: "name", label: "Name", width: 300, sortable: true },
  { id: "progress", label: "Progress", width: 140, sortable: true },
  { id: "downloaded", label: "Downloaded / Size", width: 140, sortable: true },
  { id: "eta", label: "ETA", width: 100, sortable: true },
  { id: "speed", label: "Down / Up", width: 120, sortable: true },
  { id: "peers", label: "Peers / Seeds", width: 120, sortable: true },
  { id: "status", label: "Status", width: 110, sortable: true },
  { id: "size", label: "Size", width: 100, sortable: true },
  { id: "downSpeed", label: "Down", width: 90, sortable: true },
  { id: "upSpeed", label: "Up", width: 90, sortable: true },
  { id: "seeds", label: "Seeds", width: 70, sortable: true },
  { id: "ratio", label: "Ratio", width: 80, sortable: true },
  { id: "queue", label: "Queue", width: 70, sortable: true },
  { id: "added", label: "Added", width: 100, sortable: true },
  { id: "availability", label: "Availability", width: 100, sortable: true },
  { id: "health", label: "Health", width: 80, sortable: true },
];

const ROW_ESTIMATE_HEIGHT = 56;

export const TorrentTable = memo<TorrentTableProps>(
  ({
    torrents,
    statuses,
    selectedIds,
    onSelect,
    onSelectAll,
    sortColumn,
    sortDirection,
    onSort,
    visibleColumns,
    rowSnapshotPollMs = 2000,
  }) => {
    const [columnWidths, setColumnWidths] = useState<Map<SortColumn, number>>(
      new Map(COLUMNS.map((col) => [col.id, col.width]))
    );
    const scrollParentRef = useRef<HTMLDivElement>(null);

    const handleResizeStart = useCallback(
      (column: SortColumn, e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = columnWidths.get(column) ?? COLUMNS.find((c) => c.id === column)?.width ?? 100;

        const handleMouseMove = (moveEvent: MouseEvent) => {
          const diff = moveEvent.clientX - startX;
          const newWidth = Math.max(50, startWidth + diff);
          setColumnWidths((prev) => new Map(prev).set(column, newWidth));
        };

        const handleMouseUp = () => {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleMouseUp);
        };

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
      },
      [columnWidths]
    );

    const getCellValue = useCallback(
      (torrent: Torrent, column: SortColumn): string | number => {
        const status = statuses.get(torrent.id);

        switch (column) {
          case "name":
            return torrent.name;
          case "progress":
            return status?.progress ?? 0;
          case "status":
            return status?.state ?? "stopped";
          case "size":
            return status?.total_bytes ?? 0;
          case "eta":
            return status?.eta_sec ?? 0;
          case "downloaded":
            return status ? status.downloaded_bytes / Math.max(1, status.total_bytes) : 0;
          case "speed":
            return (status?.down_rate_bps ?? 0) + (status?.up_rate_bps ?? 0);
          case "seeds":
            return 0;
          case "peers":
            return status?.peers_seen ?? 0;
          case "downSpeed":
            return status?.down_rate_bps ?? 0;
          case "upSpeed":
            return status?.up_rate_bps ?? 0;
          case "ratio":
            return 0;
          case "queue":
            return 0;
          case "added":
            return torrent.added_at_ms;
          case "availability": {
            if (!status) return 0;
            const baseAvailability = status.progress;
            const peerBonus = Math.min(status.peers_seen / 10, 0.3);
            return Math.min(1, baseAvailability + peerBonus);
          }
          case "health": {
            if (!status) return 0;
            let health = status.progress * 0.5;
            if (status.peers_seen > 0) health += 0.3;
            if (status.state === "seeding") health += 0.2;
            else if (status.state === "downloading" && status.down_rate_bps > 0) health += 0.1;
            return Math.min(1, health);
          }
          default:
            return "";
        }
      },
      [statuses]
    );

    const sortedTorrents = useMemo(() => {
      return [...torrents].sort((a, b) => {
        const aVal = getCellValue(a, sortColumn);
        const bVal = getCellValue(b, sortColumn);

        if (typeof aVal === "string" && typeof bVal === "string") {
          const cmp = aVal.localeCompare(bVal);
          return sortDirection === "asc" ? cmp : -cmp;
        }

        const numA = typeof aVal === "number" ? aVal : parseFloat(String(aVal));
        const numB = typeof bVal === "number" ? bVal : parseFloat(String(bVal));
        return sortDirection === "asc" ? numA - numB : numB - numA;
      });
    }, [torrents, sortColumn, sortDirection, getCellValue]);

    const rowVirtualizer = useVirtualizer({
      count: sortedTorrents.length,
      getScrollElement: () => scrollParentRef.current,
      estimateSize: () => ROW_ESTIMATE_HEIGHT,
      overscan: 8,
    });

    const allSelected = torrents.length > 0 && torrents.every((t) => selectedIds.has(t.id));
    const someSelected = torrents.some((t) => selectedIds.has(t.id));

    const formatStatus = useCallback((state: string): string => {
      switch (state) {
        case "downloading":
          return "Downloading";
        case "seeding":
          return "Seeding";
        case "checking":
          return "Checking";
        case "stopped":
          return "Paused";
        case "error":
          return "Error";
        default:
          return state.charAt(0).toUpperCase() + state.slice(1);
      }
    }, []);

    const getStatusClass = useCallback((state: string): string => {
      switch (state) {
        case "seeding":
          return "ok";
        case "downloading":
          return "active";
        case "error":
          return "error";
        default:
          return "";
      }
    }, []);

    const visibleColumnList = COLUMNS.filter((col) => visibleColumns.has(col.id));

    return (
      <div className="torrentTable" ref={scrollParentRef}>
        <table className="table" role="table" aria-label="Torrent list">
          <thead>
            <tr>
              <th className="tableHeader checkboxHeader">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => onSelectAll(e.target.checked)}
                  className="tableCheckbox"
                  aria-label={allSelected ? "Deselect all torrents" : "Select all torrents"}
                  aria-describedby="select-all-description"
                />
                <span id="select-all-description" className="sr-only">
                  {allSelected
                    ? "All torrents are selected"
                    : someSelected
                      ? "Some torrents are selected"
                      : "No torrents are selected"}
                </span>
              </th>
              {visibleColumnList.map((column) => (
                <th
                  key={column.id}
                  className={`tableHeader ${column.sortable ? "sortable" : ""} ${sortColumn === column.id ? "sorted" : ""}`}
                  style={{ width: columnWidths.get(column.id) ?? column.width }}
                  onClick={() => column.sortable && onSort(column.id)}
                  aria-sort={
                    column.sortable && sortColumn === column.id
                      ? sortDirection === "asc"
                        ? "ascending"
                        : "descending"
                      : column.sortable
                        ? "none"
                        : undefined
                  }
                  scope="col"
                >
                  <div className="tableHeaderContent">
                    <span>{column.label}</span>
                    {column.sortable && (
                      <span className="sortIndicator" aria-hidden="true">
                        {sortColumn === column.id ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                      </span>
                    )}
                  </div>
                  {column.sortable && (
                    <div
                      className="columnResizer"
                      onMouseDown={(e) => handleResizeStart(column.id, e)}
                      aria-hidden="true"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTorrents.length > 0 && rowVirtualizer.getVirtualItems().length > 0 && (
              <tr style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0 }} aria-hidden="true">
                <td colSpan={visibleColumnList.length + 1} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const torrent = sortedTorrents[virtualRow.index];
              const status = statuses.get(torrent.id);
              const isSelected = selectedIds.has(torrent.id);

              return (
                <tr
                  key={torrent.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={`tableRow ${isSelected ? "selected" : ""}`}
                  onClick={(e) => onSelect(torrent.id, e.ctrlKey || e.metaKey)}
                  aria-selected={isSelected}
                  role="row"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(torrent.id, e.ctrlKey || e.metaKey);
                    }
                  }}
                >
                  <td className="tableCell checkboxCell">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onSelect(torrent.id, false)}
                      onClick={(e) => e.stopPropagation()}
                      className="tableCheckbox"
                      aria-label={`Select ${torrent.name}`}
                    />
                  </td>
                  {visibleColumnList.map((column) => {
                    const value = getCellValue(torrent, column.id);

                    return (
                      <td key={column.id} className="tableCell">
                        {column.id === "name" && (
                          <div className="tableCellName">
                            <div className="tableCellNameText">{torrent.name}</div>
                            <div className="tableCellNameMeta">
                              <span className="pill">{torrent.profile.mode.toUpperCase()}</span>
                              {torrent.profile.mode === "anonymous" && (
                                <span className="pill">{torrent.profile.hops} HOPS</span>
                              )}
                            </div>
                          </div>
                        )}
                        {column.id === "progress" && status && (
                          <div className="tableCellProgress">
                            <TorrentRowSignal
                              torrentId={torrent.id}
                              height={16}
                              piecesWidth={200}
                              heartbeatWidth={120}
                              pollIntervalMs={rowSnapshotPollMs}
                            />
                            <span className="tableCellProgressText" style={{ marginTop: "4px" }}>
                              {fmtPct(status.progress ?? 0)}
                            </span>
                          </div>
                        )}
                        {column.id === "downloaded" && status && (
                          <span className="tableCellDownloaded">
                            {fmtSizeProgress(status.downloaded_bytes ?? 0, status.total_bytes ?? 0)}
                          </span>
                        )}
                        {column.id === "eta" && status && (
                          <TorrentEtaCell
                            status={status}
                            downloadedBytes={status.downloaded_bytes ?? 0}
                            totalBytes={status.total_bytes ?? 0}
                          />
                        )}
                        {column.id === "speed" && status && (
                          <span className="tableCellSpeed">
                            {fmtSpeedDownUp(status.down_rate_bps ?? 0, status.up_rate_bps ?? 0)}
                          </span>
                        )}
                        {column.id === "peers" && status && (
                          <span className="tableCellPeers" title={`${status.peers_seen} peer(s) seen`}>
                            {fmtPeersSeeds(status.peers_seen)}
                          </span>
                        )}
                        {column.id === "status" && status && (
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            <span
                              className={`pill ${getStatusClass(status.state)} ${status.error?.startsWith("Auto-recovery:") ? "recovering" : ""}`}
                            >
                              {status.error?.startsWith("Auto-recovery:") ? "Recovering" : formatStatus(status.state)}
                            </span>
                            {(status.state === "error" ||
                              status.error?.startsWith("Auto-recovery:") ||
                              status.error === "No peers available. Check trackers or try a different torrent.") && (
                              <ErrorDisplay error={status.error} torrentName={torrent.name} />
                            )}
                          </div>
                        )}
                        {column.id === "size" && status && <span>{fmtBytes(status.total_bytes ?? 0)}</span>}
                        {column.id === "downSpeed" && status && (
                          <span>{fmtBytesPerSec(status.down_rate_bps ?? 0)}</span>
                        )}
                        {column.id === "upSpeed" && status && <span>{fmtBytesPerSec(status.up_rate_bps ?? 0)}</span>}
                        {column.id === "added" && <span>{fmtTimeElapsed(torrent.added_at_ms)}</span>}
                        {![
                          "name",
                          "progress",
                          "downloaded",
                          "eta",
                          "speed",
                          "peers",
                          "status",
                          "size",
                          "downSpeed",
                          "upSpeed",
                          "added",
                        ].includes(column.id) && <span>{String(value)}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {sortedTorrents.length > 0 && (
              <tr
                style={{
                  height: rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
                }}
                aria-hidden="true"
              >
                <td colSpan={visibleColumnList.length + 1} style={{ padding: 0, border: "none" }} />
              </tr>
            )}
          </tbody>
        </table>
        {torrents.length === 0 && (
          <div className="empty" role="status" aria-live="polite">
            <div className="emptyTitle">No torrents found</div>
            <div className="emptyMessage">Add a torrent file or magnet link to get started</div>
            <div className="emptyHint">
              Use <kbd>Ctrl+M</kbd> to add a magnet link or <kbd>Ctrl+T</kbd> to add a torrent file
            </div>
          </div>
        )}
      </div>
    );
  }
);

const TorrentEtaCell = memo<{ status: TorrentStatus; downloadedBytes: number; totalBytes: number }>(
  ({ status, downloadedBytes, totalBytes }) => {
    const emaEta = useEmaEta(downloadedBytes, totalBytes, status.down_rate_bps ?? 0, status.state, 1000);

    let displayEta: number | null = null;

    if (status.state === "downloading") {
      if (emaEta !== null) {
        displayEta = emaEta;
      } else {
        displayEta = getEffectiveEta(
          status.eta_sec ?? null,
          status.state,
          totalBytes,
          downloadedBytes,
          status.down_rate_bps ?? 0
        );
      }
    } else {
      displayEta = getEffectiveEta(
        status.eta_sec ?? null,
        status.state,
        totalBytes,
        downloadedBytes,
        status.down_rate_bps ?? 0
      );
    }

    return (
      <span
        className="tableCellEta"
        title={displayEta !== null ? `Estimated time remaining: ${fmtEta(displayEta, status.state)}` : undefined}
      >
        {fmtEta(displayEta, status.state)}
      </span>
    );
  }
);

TorrentEtaCell.displayName = "TorrentEtaCell";

const ErrorDisplay = memo<{ error?: string; torrentName: string }>(({ error, torrentName }) => {
  const [showErrorModal, setShowErrorModal] = useState(false);

  const isRecovering = error?.startsWith("Auto-recovery:");
  const isNoPeers = error === "No peers available. Check trackers or try a different torrent.";

  if (!error) {
    return <span style={{ fontSize: "10px", color: "var(--error)", marginTop: "2px" }}>Error - check details</span>;
  }

  const displayColor = isRecovering ? "var(--warning, #ff9800)" : "var(--error)";
  const displayText = isRecovering ? "Reconnecting..." : isNoPeers ? "No peers found" : "Error - click for details";

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowErrorModal(true);
        }}
        style={{
          fontSize: "10px",
          color: displayColor,
          marginTop: "2px",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          textDecoration: isRecovering ? "none" : "underline",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}
        title={error}
      >
        {isRecovering && <span className="recoverySpinner">↻</span>}
        {displayText}
      </button>
      <Modal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title={isRecovering ? `Recovery: ${torrentName}` : `Error: ${torrentName}`}
      >
        <div style={{ padding: "16px 0" }}>
          <div
            style={{
              fontSize: "14px",
              color: "var(--text)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "monospace",
              background: "var(--bg-secondary)",
              padding: "12px",
              borderRadius: "4px",
              border: "1px solid var(--border)",
            }}
          >
            {error}
          </div>
        </div>
      </Modal>
    </>
  );
});

ErrorDisplay.displayName = "ErrorDisplay";
TorrentTable.displayName = "TorrentTable";
