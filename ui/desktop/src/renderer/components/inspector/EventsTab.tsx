import React, { memo, useMemo } from "react";
import type { Torrent, TorrentEvent } from "../../types";
import {
  formatEventTime,
  formatEventDateTime,
  getRelativeTime,
  getSeverityClass,
  getEventTypeLabel,
  getEventTypeIcon,
} from "../../utils/eventService";

interface EventsTabProps {
  torrent: Torrent;
  events: TorrentEvent[];
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const EventsTab = memo<EventsTabProps>(({
  torrent,
  events,
  online,
}) => {
  // Filter events for this specific torrent
  const torrentEvents = useMemo(() => {
    return events.filter((e) => e.torrentId === torrent.id);
  }, [events, torrent.id]);

  return (
    <div className="inspectorTabContent">
      <div className="inspectorSection">
        <div className="inspectorSectionHeader">
          <div className="inspectorSectionTitle">Event History</div>
          <span className="inspectorSectionBadge">{torrentEvents.length}</span>
        </div>
        
        {!online ? (
          <div className="eventTabEmpty">
            <div className="eventTabEmptyIcon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                <line x1="12" y1="2" x2="12" y2="12" />
              </svg>
            </div>
            <div className="eventTabEmptyText">Connect to daemon to view events</div>
          </div>
        ) : torrentEvents.length === 0 ? (
          <div className="eventTabEmpty">
            <div className="eventTabEmptyIcon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div className="eventTabEmptyText">No events recorded for this torrent yet</div>
            <div className="eventTabEmptyHint">
              Events will appear as the torrent downloads, verifies pieces, or encounters errors.
            </div>
          </div>
        ) : (
          <div className="eventTabList">
            {torrentEvents.map((event) => (
              <div
                key={event.id}
                className={`eventTabRow ${getSeverityClass(event.severity)}`}
              >
                <div className="eventTabRowIcon">
                  {getEventTypeIcon(event.type)}
                </div>
                <div className="eventTabRowContent">
                  <div className="eventTabRowHeader">
                    <span className="eventTabRowType">{getEventTypeLabel(event.type)}</span>
                    <span
                      className="eventTabRowTime"
                      title={formatEventDateTime(event.timestamp)}
                    >
                      {getRelativeTime(event.timestamp)}
                    </span>
                  </div>
                  <div className="eventTabRowMessage">{event.message}</div>
                </div>
                <div className={`eventTabRowSeverity ${getSeverityClass(event.severity)}`}>
                  <span className="eventTabSeverityDot" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

EventsTab.displayName = "EventsTab";
