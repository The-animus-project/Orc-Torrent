import { useCallback, useRef, useState } from "react";
import type { TorrentEvent, TorrentStatus } from "../types";
import { showTorrentCompleteNotification } from "../utils/notifications";
import { createEvent, addEvent } from "../utils/eventService";
import { logger } from "../utils/logger";

export function useTorrentEvents() {
  const [events, setEvents] = useState<TorrentEvent[]>([]);
  const prevTorrentStates = useRef<Map<string, "stopped" | "downloading" | "seeding" | "checking" | "error">>(
    new Map()
  );
  const notifiedTorrents = useRef<Set<string>>(new Set());

  const pushEvent = useCallback((event: TorrentEvent) => {
    setEvents((prev) => addEvent(prev, event));
  }, []);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  const processStatusUpdates = useCallback(
    (statusResults: Array<{ id: string; status: TorrentStatus; name: string }>, currentTorrentIds: Set<string>) => {
      for (const result of statusResults) {
        const { id, status, name } = result;
        const prevState = prevTorrentStates.current.get(id);
        const currentState = status.state;

        if (prevState === "downloading" && currentState === "seeding") {
          if (!notifiedTorrents.current.has(id)) {
            notifiedTorrents.current.add(id);
            showTorrentCompleteNotification(name, id).catch((err) => {
              logger.warn("Failed to show completion notification:", err);
            });
            pushEvent(
              createEvent("torrent_completed", "success", "Download completed", {
                torrentId: id,
                torrentName: name,
              })
            );
          }
        }

        if (prevState && prevState !== currentState) {
          if (currentState === "error") {
            pushEvent(
              createEvent("torrent_error", "error", status.error || "Torrent encountered an error", {
                torrentId: id,
                torrentName: name,
                details: { previousState: prevState, error: status.error },
              })
            );
          } else if (currentState === "downloading" && prevState === "stopped") {
            pushEvent(
              createEvent("torrent_started", "info", "Torrent started downloading", {
                torrentId: id,
                torrentName: name,
              })
            );
          } else if (currentState === "seeding" && prevState === "stopped") {
            pushEvent(
              createEvent("torrent_started", "info", "Torrent started seeding", {
                torrentId: id,
                torrentName: name,
              })
            );
          } else if (currentState === "stopped" && (prevState === "downloading" || prevState === "seeding")) {
            pushEvent(
              createEvent("torrent_stopped", "info", "Torrent stopped", {
                torrentId: id,
                torrentName: name,
              })
            );
          } else if (currentState === "checking") {
            pushEvent(
              createEvent("piece_verified", "info", "Verifying torrent pieces", {
                torrentId: id,
                torrentName: name,
              })
            );
          }
        }

        prevTorrentStates.current.set(id, currentState);
      }

      for (const [id] of prevTorrentStates.current) {
        if (!currentTorrentIds.has(id)) {
          prevTorrentStates.current.delete(id);
          notifiedTorrents.current.delete(id);
        }
      }
    },
    [pushEvent]
  );

  return {
    events,
    pushEvent,
    clearEvents,
    processStatusUpdates,
  };
}
