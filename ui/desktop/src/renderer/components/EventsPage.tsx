import React, { memo, useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { TorrentEvent, EventType, EventSeverity } from "../types";
import {
  filterEventsByType,
  filterEventsBySeverity,
  searchEvents,
  getEventTypeLabel,
  formatEventTime,
  formatEventDateTime,
  getRelativeTime,
  getSeverityClass,
  getEventTypeIcon,
  ALL_SEVERITIES,
} from "../utils/eventService";

interface EventsPageProps {
  events: TorrentEvent[];
  online: boolean;
  onBack: () => void;
  onClearEvents: () => void;
}

// Event type filter options grouped by category
const EVENT_TYPE_GROUPS = {
  "Torrent Activity": ["torrent_added", "torrent_started", "torrent_stopped", "torrent_completed", "torrent_error"] as EventType[],
  "Data Integrity": ["piece_verified", "hash_failure", "disk_io"] as EventType[],
  "Network": ["tracker_error", "vpn_kill_switch", "peer_connected", "peer_disconnected"] as EventType[],
};

// SVG Icons for empty states
const OfflineIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
    <line x1="12" y1="2" x2="12" y2="12" />
  </svg>
);

const EmptyIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const SearchIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const EventsPage = memo<EventsPageProps>(({
  events,
  online,
  onBack,
  onClearEvents,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<EventType>>(new Set());
  const [selectedSeverities, setSelectedSeverities] = useState<Set<EventSeverity>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter events based on current filters
  const filteredEvents = useMemo(() => {
    let result = events;
    
    if (selectedTypes.size > 0) {
      result = filterEventsByType(result, Array.from(selectedTypes));
    }
    
    if (selectedSeverities.size > 0) {
      result = filterEventsBySeverity(result, Array.from(selectedSeverities));
    }
    
    if (searchQuery.trim()) {
      result = searchEvents(result, searchQuery);
    }
    
    return result;
  }, [events, selectedTypes, selectedSeverities, searchQuery]);

  // Auto-scroll to top when new events arrive
  useEffect(() => {
    if (autoScroll && listRef.current && events.length > 0) {
      listRef.current.scrollTop = 0;
    }
  }, [events.length, autoScroll]);

  const handleTypeToggle = useCallback((type: EventType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleSeverityToggle = useCallback((severity: EventSeverity) => {
    setSelectedSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(severity)) {
        next.delete(severity);
      } else {
        next.add(severity);
      }
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setSelectedTypes(new Set());
    setSelectedSeverities(new Set());
    setSearchQuery("");
  }, []);

  const handleEventClick = useCallback((eventId: string) => {
    setExpandedEventId((prev) => (prev === eventId ? null : eventId));
  }, []);

  const hasActiveFilters = selectedTypes.size > 0 || selectedSeverities.size > 0 || searchQuery.trim();

  return (
    <div className="eventHistoryPage">
      <div className="eventHistoryHeader">
        <button
          className="btn ghost"
          onClick={onBack}
          title="Back to Main Menu"
          aria-label="Back to Main Menu"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h1 className="eventHistoryTitle">Event History</h1>
        <div className="eventHistoryHeaderActions">
          <label className="eventHistoryAutoScroll">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button
            className={`btn ghost small ${showFilters ? "active" : ""}`}
            onClick={() => setShowFilters(!showFilters)}
            title="Toggle filters"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filters
          </button>
          {events.length > 0 && (
            <button
              className="btn ghost small"
              onClick={onClearEvents}
              title="Clear all events"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="eventHistoryToolbar">
        <div className="eventHistorySearch">
          <svg className="eventHistorySearchIcon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search events..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="eventHistorySearchInput"
          />
          {searchQuery && (
            <button
              className="eventHistorySearchClear"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="eventHistorySeverityFilters">
          {ALL_SEVERITIES.map((severity) => (
            <button
              key={severity}
              className={`eventHistorySeverityBtn ${getSeverityClass(severity)} ${
                selectedSeverities.has(severity) ? "active" : ""
              }`}
              onClick={() => handleSeverityToggle(severity)}
              aria-pressed={selectedSeverities.has(severity)}
              title={`Filter by ${severity}`}
            >
              <span className="eventHistorySeverityBtnDot" />
              {severity.charAt(0).toUpperCase() + severity.slice(1)}
            </button>
          ))}
        </div>

        {hasActiveFilters && (
          <button
            className="btn ghost small"
            onClick={handleClearFilters}
            title="Clear all filters"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Clear
          </button>
        )}
      </div>

      {showFilters && (
        <div className="eventHistoryFilters">
          {Object.entries(EVENT_TYPE_GROUPS).map(([groupName, types]) => (
            <div key={groupName} className="eventHistoryFilterGroup">
              <span className="eventHistoryFilterGroupName">{groupName}:</span>
              <div className="eventHistoryFilterTags">
                {types.map((type) => (
                  <button
                    key={type}
                    className={`eventHistoryFilterTag ${selectedTypes.has(type) ? "active" : ""}`}
                    onClick={() => handleTypeToggle(type)}
                    aria-pressed={selectedTypes.has(type)}
                    title={`Filter by ${getEventTypeLabel(type)}`}
                  >
                    <span className="eventHistoryFilterTagIcon">{getEventTypeIcon(type)}</span>
                    {getEventTypeLabel(type)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="eventHistoryContent" ref={listRef}>
        {!online ? (
          <div className="eventHistoryEmpty">
            <div className="eventHistoryEmptyIcon">
              <OfflineIcon />
            </div>
            <div className="eventHistoryEmptyTitle">Daemon Offline</div>
            <div className="eventHistoryEmptyText">
              Connect to the daemon to start tracking torrent events.
            </div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="eventHistoryEmpty">
            <div className="eventHistoryEmptyIcon">
              {events.length === 0 ? <EmptyIcon /> : <SearchIcon />}
            </div>
            <div className="eventHistoryEmptyTitle">
              {events.length === 0 ? "No Events Yet" : "No Matching Events"}
            </div>
            <div className="eventHistoryEmptyText">
              {events.length === 0
                ? "Events will appear here as torrents are added, downloaded, and verified."
                : "Try adjusting your filters or search query."}
            </div>
            {hasActiveFilters && (
              <button
                className="btn ghost"
                onClick={handleClearFilters}
                style={{ marginTop: "12px" }}
              >
                Clear Filters
              </button>
            )}
          </div>
        ) : (
          <div className="eventHistoryList">
            <div className="eventHistoryListHeader">
              <span className="eventHistoryColTime">Time</span>
              <span className="eventHistoryColSeverity">Level</span>
              <span className="eventHistoryColType">Type</span>
              <span className="eventHistoryColMessage">Message</span>
            </div>
            {filteredEvents.map((event) => (
              <div
                key={event.id}
                className={`eventHistoryRow ${getSeverityClass(event.severity)} ${
                  expandedEventId === event.id ? "expanded" : ""
                } ${event.details ? "hasDetails" : ""}`}
                onClick={() => event.details && handleEventClick(event.id)}
                role={event.details ? "button" : undefined}
                tabIndex={event.details ? 0 : undefined}
                onKeyDown={(e) => {
                  if (event.details && (e.key === "Enter" || e.key === " ")) {
                    handleEventClick(event.id);
                  }
                }}
              >
                <div className="eventHistoryRowMain">
                  <span
                    className="eventHistoryColTime"
                    title={formatEventDateTime(event.timestamp)}
                  >
                    <span className="eventHistoryTimeMain">{formatEventTime(event.timestamp)}</span>
                    <span className="eventHistoryRelTime">
                      {getRelativeTime(event.timestamp)}
                    </span>
                  </span>
                  <span className={`eventHistoryColSeverity ${getSeverityClass(event.severity)}`}>
                    <span className="eventHistorySeverityDot" />
                    <span className="eventHistorySeverityLabel">{event.severity.toUpperCase()}</span>
                  </span>
                  <span className="eventHistoryColType">
                    <span className="eventHistoryTypeIcon">{getEventTypeIcon(event.type)}</span>
                    <span className="eventHistoryTypeLabel">{getEventTypeLabel(event.type)}</span>
                  </span>
                  <span className="eventHistoryColMessage">
                    <span className="eventHistoryMessageText">{event.message}</span>
                    {event.torrentName && (
                      <span className="eventHistoryTorrentName" title={event.torrentName}>
                        {event.torrentName}
                      </span>
                    )}
                    {event.details && (
                      <span className="eventHistoryExpandIcon">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          {expandedEventId === event.id ? (
                            <polyline points="18 15 12 9 6 15" />
                          ) : (
                            <polyline points="6 9 12 15 18 9" />
                          )}
                        </svg>
                      </span>
                    )}
                  </span>
                </div>
                {expandedEventId === event.id && event.details && (
                  <div className="eventHistoryRowDetails">
                    <pre>{JSON.stringify(event.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="eventHistoryFooter">
        <span className="eventHistoryCount">
          {filteredEvents.length === events.length
            ? `${events.length} event${events.length !== 1 ? "s" : ""}`
            : `${filteredEvents.length} of ${events.length} events`}
        </span>
        {events.length > 0 && (
          <span className="eventHistoryLatest">
            Latest: {getRelativeTime(events[0]?.timestamp || Date.now())}
          </span>
        )}
      </div>
    </div>
  );
});

EventsPage.displayName = "EventsPage";
