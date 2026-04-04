import React, { memo, useState, useEffect, useMemo, useCallback } from "react";
import type { Torrent, TorrentStatus } from "../../types";
import { getJson } from "../../utils/api";
import { PieceMap } from "./PieceMap";
import { estimatePiecesFromProgress, type PieceData } from "../../utils/pieceVisualization";
import { logger } from "../../utils/logger";

interface PiecesTabProps {
  torrent: Torrent;
  torrentStatus?: TorrentStatus;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const PiecesTab = memo<PiecesTabProps>(({
  torrent,
  torrentStatus,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [pieceData, setPieceData] = useState<PieceData[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch piece data from API (if endpoint exists) or estimate from progress
  const fetchPieces = useCallback(async () => {
    if (!online || !torrentStatus) {
      setPieceData([]);
      return;
    }

    try {
      // TODO: Fetch from GET /torrents/{id}/pieces when endpoint is implemented
      // For now, estimate from progress
      const progress = torrentStatus.progress;
      
      // Estimate piece count based on torrent size
      // Real BitTorrent piece sizes are typically:
      // - Small torrents (<50MB): 16KB - 64KB
      // - Medium torrents (50MB - 500MB): 256KB - 512KB
      // - Large torrents (500MB - 4GB): 1MB - 2MB
      // - Very large torrents (>4GB): 2MB - 4MB
      let pieceSize = 256 * 1024; // 256KB default
      if (torrentStatus.total_bytes > 4 * 1024 * 1024 * 1024) {
        pieceSize = 4 * 1024 * 1024; // 4MB for very large torrents
      } else if (torrentStatus.total_bytes > 500 * 1024 * 1024) {
        pieceSize = 2 * 1024 * 1024; // 2MB for large torrents
      } else if (torrentStatus.total_bytes > 50 * 1024 * 1024) {
        pieceSize = 512 * 1024; // 512KB for medium torrents
      }
      
      let estimatedPieces = Math.ceil(torrentStatus.total_bytes / pieceSize);
      
      // Cap visualization to max 2000 pieces to prevent UI freeze
      // If there are more pieces, we'll aggregate them
      const MAX_VISUAL_PIECES = 2000;
      estimatedPieces = Math.min(Math.max(100, estimatedPieces), MAX_VISUAL_PIECES);
      
      const pieces = estimatePiecesFromProgress(progress, estimatedPieces);
      setPieceData(pieces);
    } catch (err) {
      // Silently handle errors - pieces are estimated anyway
      logger.warn("Failed to estimate pieces:", err);
      setPieceData([]);
    }
  }, [torrent.id, torrentStatus, online]);

  useEffect(() => {
    fetchPieces();
  }, [fetchPieces]);

  const completedCount = useMemo(() => {
    return pieceData.filter(p => p.completed).length;
  }, [pieceData]);

  const downloadingCount = useMemo(() => {
    return pieceData.filter(p => p.downloading).length;
  }, [pieceData]);

  const missingCount = useMemo(() => {
    return pieceData.filter(p => p.missing).length;
  }, [pieceData]);

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionTitle">
          Piece Map
          {pieceData.length > 0 && (
            <span style={{ marginLeft: "12px", fontSize: "12px", opacity: 0.7, fontWeight: "normal" }}>
              ({completedCount} completed, {downloadingCount} downloading, {missingCount} missing)
            </span>
          )}
        </div>
        
        {!online ? (
          <div className="empty" style={{ marginTop: "24px" }}>
            <div style={{ marginBottom: "8px", fontWeight: 600 }}>Not connected</div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", lineHeight: "1.5" }}>
              Connect to daemon to view piece map
            </div>
          </div>
        ) : pieceData.length === 0 ? (
          <div className="empty" style={{ marginTop: "24px" }}>
            <div style={{ marginBottom: "8px", fontWeight: 600 }}>No piece data available</div>
            <div style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", lineHeight: "1.5" }}>
              Piece information will be available once the torrent starts downloading
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "16px" }}>
            <PieceMap pieces={pieceData} width={800} height={200} />
            <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--text-muted)", lineHeight: "1.5" }}>
              {torrentStatus && (
                <>
                  Progress: {(torrentStatus.progress * 100).toFixed(1)}% ({completedCount} / {pieceData.length} pieces)
                  {torrentStatus.total_bytes > 0 && (
                    <span style={{ marginLeft: "12px" }}>
                      Downloaded: {(torrentStatus.downloaded_bytes / (1024 * 1024)).toFixed(2)} MB / {(torrentStatus.total_bytes / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

PiecesTab.displayName = "PiecesTab";
