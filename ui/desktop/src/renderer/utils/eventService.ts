// Event Service for managing torrent event history
import type { TorrentEvent, EventType, EventSeverity } from "../types";

const MAX_EVENTS = 1000;

let eventIdCounter = 0;

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${++eventIdCounter}`;
}

/**
 * Create a new event
 */
export function createEvent(
  type: EventType,
  severity: EventSeverity,
  message: string,
  options?: {
    torrentId?: string;
    torrentName?: string;
    details?: Record<string, unknown>;
  }
): TorrentEvent {
  return {
    id: generateEventId(),
    timestamp: Date.now(),
    type,
    severity,
    message,
    torrentId: options?.torrentId,
    torrentName: options?.torrentName,
    details: options?.details,
  };
}

/**
 * Add an event to the event list, maintaining max size
 */
export function addEvent(
  events: TorrentEvent[],
  event: TorrentEvent
): TorrentEvent[] {
  const newEvents = [event, ...events];
  if (newEvents.length > MAX_EVENTS) {
    return newEvents.slice(0, MAX_EVENTS);
  }
  return newEvents;
}

/**
 * Clear all events
 */
export function clearEvents(): TorrentEvent[] {
  return [];
}

/**
 * Filter events by type
 */
export function filterEventsByType(
  events: TorrentEvent[],
  types: EventType[]
): TorrentEvent[] {
  if (types.length === 0) return events;
  return events.filter((e) => types.includes(e.type));
}

/**
 * Filter events by severity
 */
export function filterEventsBySeverity(
  events: TorrentEvent[],
  severities: EventSeverity[]
): TorrentEvent[] {
  if (severities.length === 0) return events;
  return events.filter((e) => severities.includes(e.severity));
}

/**
 * Search events by message or torrent name
 */
export function searchEvents(
  events: TorrentEvent[],
  query: string
): TorrentEvent[] {
  if (!query.trim()) return events;
  const lowerQuery = query.toLowerCase();
  return events.filter(
    (e) =>
      e.message.toLowerCase().includes(lowerQuery) ||
      (e.torrentName && e.torrentName.toLowerCase().includes(lowerQuery))
  );
}

/**
 * Get human-readable label for event type
 */
export function getEventTypeLabel(type: EventType): string {
  switch (type) {
    case "disk_io":
      return "Disk I/O";
    case "hash_failure":
      return "Hash Failure";
    case "tracker_error":
      return "Tracker Error";
    case "vpn_kill_switch":
      return "VPN Kill Switch";
    case "piece_verified":
      return "Piece Verified";
    case "torrent_added":
      return "Torrent Added";
    case "torrent_completed":
      return "Torrent Completed";
    case "torrent_error":
      return "Torrent Error";
    case "torrent_started":
      return "Torrent Started";
    case "torrent_stopped":
      return "Torrent Stopped";
    case "peer_connected":
      return "Peer Connected";
    case "peer_disconnected":
      return "Peer Disconnected";
    default:
      return type;
  }
}

/**
 * Get icon/symbol for event type
 */
export function getEventTypeIcon(type: EventType): string {
  switch (type) {
    case "disk_io":
      return "💾";
    case "hash_failure":
      return "⚠️";
    case "tracker_error":
      return "🔗";
    case "vpn_kill_switch":
      return "🛡️";
    case "piece_verified":
      return "✓";
    case "torrent_added":
      return "+";
    case "torrent_completed":
      return "✓";
    case "torrent_error":
      return "✗";
    case "torrent_started":
      return "▶";
    case "torrent_stopped":
      return "⏹";
    case "peer_connected":
      return "↔";
    case "peer_disconnected":
      return "↔";
    default:
      return "•";
  }
}

/**
 * Format timestamp for display
 */
export function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Format timestamp with date for tooltips
 */
export function formatEventDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Get relative time (e.g., "2 minutes ago")
 */
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * All available event types for filtering
 */
export const ALL_EVENT_TYPES: EventType[] = [
  "disk_io",
  "hash_failure",
  "tracker_error",
  "vpn_kill_switch",
  "piece_verified",
  "torrent_added",
  "torrent_completed",
  "torrent_error",
  "torrent_started",
  "torrent_stopped",
  "peer_connected",
  "peer_disconnected",
];

/**
 * All severity levels for filtering
 */
export const ALL_SEVERITIES: EventSeverity[] = [
  "info",
  "warning",
  "error",
  "success",
];

/**
 * Get severity color class
 */
export function getSeverityClass(severity: EventSeverity): string {
  switch (severity) {
    case "error":
      return "eventSeverityError";
    case "warning":
      return "eventSeverityWarning";
    case "success":
      return "eventSeveritySuccess";
    case "info":
    default:
      return "eventSeverityInfo";
  }
}
