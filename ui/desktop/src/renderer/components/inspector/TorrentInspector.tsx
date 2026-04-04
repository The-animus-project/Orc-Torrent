import React, { memo, useState, useCallback } from "react";
import type { Torrent, TorrentStatus, OverlayStatus, TorrentEvent } from "../../types";
import { OverviewTab } from "./OverviewTab";
import { FilesTab } from "./FilesTab";
import { PeersTab } from "./PeersTab";
import { TrackersTab } from "./TrackersTab";
import { TransfersTab } from "./TransfersTab";
import { PiecesTab } from "./PiecesTab";
import { EventsTab } from "./EventsTab";
import { SwarmTab } from "./SwarmTab";

export type InspectorTab = "overview" | "files" | "peers" | "swarm" | "trackers" | "transfers" | "pieces" | "events";

interface TorrentInspectorProps {
  torrent: Torrent | null;
  status: TorrentStatus | null;
  overlay: OverlayStatus | null;
  events: TorrentEvent[];
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

const TABS: { id: InspectorTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
  { id: "peers", label: "Peers" },
  { id: "swarm", label: "Swarm" },
  { id: "trackers", label: "Trackers" },
  { id: "transfers", label: "Transfers" },
  { id: "pieces", label: "Pieces" },
  { id: "events", label: "Events" },
];

export const TorrentInspector = memo<TorrentInspectorProps>(({
  torrent,
  status,
  overlay,
  events,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");

  if (!torrent) {
    return (
      <div className="torrentInspector">
        <div className="torrentInspectorEmpty">
          <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>No torrent selected</div>
          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>Select a torrent from the list to view details</div>
        </div>
      </div>
    );
  }

  return (
    <div className="torrentInspector">
      <div className="torrentInspectorHeader">
        <div className="torrentInspectorTitle">{torrent.name}</div>
        <div className="torrentInspectorTabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`inspectorTab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="torrentInspectorContent">
        {activeTab === "overview" && (
          <OverviewTab
            torrent={torrent}
            status={status}
            overlay={overlay}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "files" && (
          <FilesTab
            torrent={torrent}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "peers" && (
          <PeersTab
            torrent={torrent}
            torrentStatus={status ?? undefined}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "swarm" && (
          <SwarmTab
            torrent={torrent}
            status={status}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "trackers" && (
          <TrackersTab
            torrent={torrent}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "transfers" && (
          <TransfersTab
            torrent={torrent}
            status={status}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "pieces" && (
          <PiecesTab
            torrent={torrent}
            torrentStatus={status ?? undefined}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
        {activeTab === "events" && (
          <EventsTab
            torrent={torrent}
            events={events}
            online={online}
            onUpdate={onUpdate}
            onError={onError}
            onSuccess={onSuccess}
          />
        )}
      </div>
    </div>
  );
});

TorrentInspector.displayName = "TorrentInspector";
