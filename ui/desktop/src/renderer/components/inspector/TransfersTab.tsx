import React, { memo } from "react";
import type { Torrent, TorrentStatus } from "../../types";
import { fmtBytesPerSec } from "../../utils/format";

interface TransfersTabProps {
  torrent: Torrent;
  status: TorrentStatus | null;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const TransfersTab = memo<TransfersTabProps>(({
  torrent,
  status,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  // TODO: Implement speed graph and connection stats
  // This would require charting library or canvas drawing

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionTitle">Transfer Statistics</div>
        <div className="inspectorGrid">
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Download Speed</div>
            <div className="inspectorFieldValue">{status ? fmtBytesPerSec(status.down_rate_bps) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Upload Speed</div>
            <div className="inspectorFieldValue">{status ? fmtBytesPerSec(status.up_rate_bps) : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Connections</div>
            <div className="inspectorFieldValue">{status ? status.peers_seen : "—"}</div>
          </div>
          <div className="inspectorField">
            <div className="inspectorFieldLabel">Upload Slots</div>
            <div className="inspectorFieldValue">—</div>
          </div>
        </div>
        <div className="inspectorSectionNote" style={{ marginTop: "16px", padding: "16px", background: "var(--bg-secondary)", borderRadius: "8px", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px" }}>Additional Statistics</div>
          <div style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic", lineHeight: "1.5" }}>
            Speed graph and detailed connection stats will be available in a future update
          </div>
        </div>
      </div>
    </div>
  );
});

TransfersTab.displayName = "TransfersTab";
