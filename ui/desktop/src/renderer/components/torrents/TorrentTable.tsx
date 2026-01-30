import React, { memo, useCallback, useState } from "react";
import type { Torrent, TorrentStatus } from "../../types";
import { fmtBytes, fmtBytesPerSec, fmtPct, fmtEta, fmtTimeElapsed, fmtSizeProgress, fmtSpeedDownUp, fmtPeersSeeds, getEffectiveEta } from "../../utils/format";
import { useEmaEta } from "../../utils/useEmaEta";
import { Modal } from "../Modal";
import { TorrentRowSignal } from "./TorrentRowSignal";

export type SortColumn = "name" | "progress" | "downloaded" | "status" | "size" | "eta" | "speed" | "seeds" | "peers" | "downSpeed" | "upSpeed" | "ratio" | "queue" | "added" | "availability" | "health";
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
  // Hidden columns for sorting/filtering
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

export const TorrentTable = memo<TorrentTableProps>(({
  torrents,
  statuses,
  selectedIds,
  onSelect,
  onSelectAll,
  sortColumn,
  sortDirection,
  onSort,
  visibleColumns,
}) => {
  const [columnWidths, setColumnWidths] = useState<Map<SortColumn, number>>(
    new Map(COLUMNS.map(col => [col.id, col.width]))
  );

  const handleResizeStart = useCallback((column: SortColumn, e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths.get(column) ?? COLUMNS.find(c => c.id === column)?.width ?? 100;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      setColumnWidths(prev => new Map(prev).set(column, newWidth));
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [columnWidths]);

  const getCellValue = useCallback((torrent: Torrent, column: SortColumn): string | number => {
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
        return status ? (status.downloaded_bytes / Math.max(1, status.total_bytes)) : 0;
      case "speed":
        return (status?.down_rate_bps ?? 0) + (status?.up_rate_bps ?? 0); // Combined for sorting
      case "seeds":
        // Seeds not available in API yet, return 0 for sorting
        return 0;
      case "peers":
        return status?.peers_seen ?? 0;
      case "downSpeed":
        return status?.down_rate_bps ?? 0;
      case "upSpeed":
        return status?.up_rate_bps ?? 0;
      case "ratio":
        // Ratio calculation: uploaded_bytes / downloaded_bytes
        // For now return 0 (will show as "—" in display)
        return 0;
      case "queue":
        // Queue position not available in API yet
        return 0;
      case "added":
        return torrent.added_at_ms;
      case "availability":
        // Availability: estimate based on peers_seen and progress
        // More peers = higher availability estimate
        if (!status) return 0;
        const baseAvailability = status.progress;
        const peerBonus = Math.min(status.peers_seen / 10, 0.3); // Up to 30% bonus from peers
        return Math.min(1, baseAvailability + peerBonus);
      case "health":
        // Health score: combination of progress, peers, and state
        if (!status) return 0;
        let health = status.progress * 0.5; // 50% from progress
        if (status.peers_seen > 0) health += 0.3; // 30% from having peers
        if (status.state === "seeding") health += 0.2; // 20% from seeding
        else if (status.state === "downloading" && status.down_rate_bps > 0) health += 0.1; // 10% from active download
        return Math.min(1, health);
      default:
        return "";
    }
  }, [statuses]);

  const sortedTorrents = [...torrents].sort((a, b) => {
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

  const allSelected = torrents.length > 0 && torrents.every(t => selectedIds.has(t.id));
  const someSelected = torrents.some(t => selectedIds.has(t.id));

  // Helper function for status formatting
  const formatStatus = useCallback((state: string): string => {
    switch (state) {
      case "downloading": return "Downloading";
      case "seeding": return "Seeding";
      case "checking": return "Checking";
      case "stopped": return "Paused";
      case "error": return "Error";
      default: return state.charAt(0).toUpperCase() + state.slice(1);
    }
  }, []);

  const getStatusClass = useCallback((state: string): string => {
    switch (state) {
      case "seeding": return "ok";
      case "downloading": return "active";
      case "error": return "error";
      default: return "";
    }
  }, []);

  return (
    <div className="torrentTable">
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
                {allSelected ? "All torrents are selected" : someSelected ? "Some torrents are selected" : "No torrents are selected"}
              </span>
            </th>
            {COLUMNS.filter(col => visibleColumns.has(col.id)).map(column => (
              <th
                key={column.id}
                className={`tableHeader ${column.sortable ? "sortable" : ""} ${sortColumn === column.id ? "sorted" : ""}`}
                style={{ width: columnWidths.get(column.id) ?? column.width }}
                onClick={() => column.sortable && onSort(column.id)}
                aria-sort={column.sortable && sortColumn === column.id 
                  ? (sortDirection === "asc" ? "ascending" : "descending")
                  : column.sortable ? "none" : undefined}
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
          {sortedTorrents.map(torrent => {
            const status = statuses.get(torrent.id);
            const isSelected = selectedIds.has(torrent.id);
            
            return (
              <tr
                key={torrent.id}
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
                {COLUMNS.filter(col => visibleColumns.has(col.id)).map(column => {
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
                          <span className={`pill ${getStatusClass(status.state)} ${status.error?.startsWith("Auto-recovery:") ? "recovering" : ""}`}>
                            {status.error?.startsWith("Auto-recovery:") ? "Recovering" : formatStatus(status.state)}
                          </span>
                          {(status.state === "error" || status.error?.startsWith("Auto-recovery:") || status.error === "No peers available. Check trackers or try a different torrent.") && (
                            <ErrorDisplay error={status.error} torrentName={torrent.name} />
                          )}
                        </div>
                      )}
                      {/* Hidden columns for sorting/filtering only */}
                      {column.id === "size" && status && (
                        <span style={{ display: "none" }}>{fmtBytes(status.total_bytes ?? 0)}</span>
                      )}
                      {column.id === "downSpeed" && status && (
                        <span style={{ display: "none" }}>{fmtBytesPerSec(status.down_rate_bps ?? 0)}</span>
                      )}
                      {column.id === "upSpeed" && status && (
                        <span style={{ display: "none" }}>{fmtBytesPerSec(status.up_rate_bps ?? 0)}</span>
                      )}
                      {column.id === "added" && (
                        <span style={{ display: "none" }}>{fmtTimeElapsed(torrent.added_at_ms)}</span>
                      )}
                      {!["name", "progress", "downloaded", "eta", "speed", "peers", "status", "size", "downSpeed", "upSpeed", "added"].includes(column.id) && (
                        <span>{String(value)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {torrents.length === 0 && (
        <div className="empty" role="status" aria-live="polite">
          <div className="emptyTitle">No torrents found</div>
          <div className="emptyMessage">
            Add a torrent file or magnet link to get started
          </div>
          <div className="emptyHint">
            Use <kbd>Ctrl+M</kbd> to add a magnet link or <kbd>Ctrl+T</kbd> to add a torrent file
          </div>
        </div>
      )}
    </div>
  );
});

// Component for ETA cell with EMA smoothing
const TorrentEtaCell = memo<{ status: TorrentStatus; downloadedBytes: number; totalBytes: number }>(({
  status,
  downloadedBytes,
  totalBytes,
}) => {
  const emaEta = useEmaEta(
    downloadedBytes,
    totalBytes,
    status.down_rate_bps ?? 0,
    status.state,
    1000 // Update every 1 second
  );
  
  // Always try to show ETA when downloading - use EMA if available, otherwise calculate from current rate
  let displayEta: number | null = null;
  
  if (status.state === "downloading") {
    // Prefer EMA ETA (smoothed) if available
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
    // For non-downloading states, use effective ETA (handles backend eta_sec)
    displayEta = getEffectiveEta(
      status.eta_sec ?? null,
      status.state,
      totalBytes,
      downloadedBytes,
      status.down_rate_bps ?? 0
    );
  }
  
  return <span className="tableCellEta" title={displayEta !== null ? `Estimated time remaining: ${fmtEta(displayEta, status.state)}` : undefined}>{fmtEta(displayEta, status.state)}</span>;
});

TorrentEtaCell.displayName = "TorrentEtaCell";

// Component for displaying error or recovery status with clickable details
const ErrorDisplay = memo<{ error?: string; torrentName: string }>(({ error, torrentName }) => {
  const [showErrorModal, setShowErrorModal] = useState(false);

  // Check if this is an auto-recovery message
  const isRecovering = error?.startsWith("Auto-recovery:");
  const isNoPeers = error === "No peers available. Check trackers or try a different torrent.";

  if (!error) {
    return (
      <span style={{ fontSize: "10px", color: "var(--error)", marginTop: "2px" }}>
        Error - check details
      </span>
    );
  }

  // Style based on recovery vs error state
  const displayColor = isRecovering ? "var(--warning, #ff9800)" : "var(--error)";
  const displayText = isRecovering 
    ? "Reconnecting..." 
    : isNoPeers 
      ? "No peers found" 
      : "Error - click for details";

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
          <div style={{ 
            fontSize: "14px", 
            color: "var(--text)", 
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "monospace",
            background: "var(--bg-secondary)",
            padding: "12px",
            borderRadius: "4px",
            border: "1px solid var(--border)",
          }}>
            {error}
          </div>
          {isRecovering && (
            <div style={{ 
              marginTop: "12px", 
              fontSize: "13px", 
              color: "var(--text-muted)",
              lineHeight: "1.5"
            }}>
              The torrent is automatically reconnecting to find peers. 
              This happens when no progress has been made for a while.
              The download will resume once peers are found.
            </div>
          )}
          {isNoPeers && (
            <div style={{ 
              marginTop: "12px", 
              fontSize: "13px", 
              color: "var(--text-muted)",
              lineHeight: "1.5"
            }}>
              Suggestions:
              <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
                <li>Check if the torrent has active seeders</li>
                <li>Try using a VPN if trackers are blocked</li>
                <li>Wait - peers may come online later</li>
                <li>Try force re-announce from the Trackers tab</li>
              </ul>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
});

ErrorDisplay.displayName = "ErrorDisplay";

TorrentTable.displayName = "TorrentTable";
