// Custom hook for torrent bulk operations
import { useCallback, useState } from "react";
import { postJson } from "./api";
import { getErrorMessage } from "./errorHandling";

interface UseTorrentOperationsOptions {
  online: boolean;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
  onRefresh: () => void;
}

interface UseTorrentOperationsResult {
  loadingOperations: Set<string>;
  handleBulkStart: (ids: string[]) => Promise<void>;
  handleBulkStop: (ids: string[]) => Promise<void>;
  handleBulkPause: (ids: string[]) => Promise<void>;
  handleBulkRemove: (ids: string[], confirmFirst?: boolean) => Promise<void>;
  handleForceRecheck: (ids: string[]) => Promise<void>;
  handleForceAnnounce: (ids: string[]) => Promise<void>;
}

export function useTorrentOperations({
  online,
  onSuccess,
  onError,
  onRefresh,
}: UseTorrentOperationsOptions): UseTorrentOperationsResult {
  const [loadingOperations, setLoadingOperations] = useState<Set<string>>(new Set());

  const setLoading = useCallback((opId: string, loading: boolean) => {
    setLoadingOperations(prev => {
      const next = new Set(prev);
      if (loading) {
        next.add(opId);
      } else {
        next.delete(opId);
      }
      return next;
    });
  }, []);

  const handleBulkStart = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) return;
    const opId = "start";
    setLoading(opId, true);
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/start`, {}));
      await Promise.all(promises);
      onSuccess(`Started ${ids.length} torrent(s)`);
      onRefresh();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to start torrent(s)"));
    } finally {
      setLoading(opId, false);
    }
  }, [online, onSuccess, onError, onRefresh, setLoading]);

  const handleBulkStop = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) return;
    const opId = "stop";
    setLoading(opId, true);
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/stop`, {}));
      await Promise.all(promises);
      onSuccess(`Stopped ${ids.length} torrent(s)`);
      onRefresh();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to stop torrent(s)"));
    } finally {
      setLoading(opId, false);
    }
  }, [online, onSuccess, onError, onRefresh, setLoading]);

  const handleBulkPause = useCallback(async (ids: string[]) => {
    // Pause is the same as stop
    await handleBulkStop(ids);
  }, [handleBulkStop]);

  const handleBulkRemove = useCallback(async (ids: string[], confirmFirst = true) => {
    if (!online || ids.length === 0) return;
    
    // Show confirmation dialog
    if (confirmFirst) {
      const confirmed = window.confirm(
        `Are you sure you want to remove ${ids.length} torrent(s)?\n\nThis will remove the torrent(s) from the list but keep downloaded files.`
      );
      if (!confirmed) return;
    }
    
    const opId = "remove";
    setLoading(opId, true);
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/remove`, {}));
      await Promise.all(promises);
      onSuccess(`Removed ${ids.length} torrent(s)`);
      onRefresh();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to remove torrent(s)"));
    } finally {
      setLoading(opId, false);
    }
  }, [online, onSuccess, onError, onRefresh, setLoading]);

  const handleForceRecheck = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) {
      onSuccess("Select torrent(s) to force recheck");
      return;
    }
    const opId = "recheck";
    setLoading(opId, true);
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/recheck`, {}));
      await Promise.all(promises);
      onSuccess(`Force recheck initiated for ${ids.length} torrent(s)`);
      onRefresh();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to force recheck"));
    } finally {
      setLoading(opId, false);
    }
  }, [online, onSuccess, onError, onRefresh, setLoading]);

  const handleForceAnnounce = useCallback(async (ids: string[]) => {
    if (!online || ids.length === 0) {
      onSuccess("Select torrent(s) to force announce");
      return;
    }
    const opId = "announce";
    setLoading(opId, true);
    try {
      const promises = ids.map(id => postJson(`/torrents/${id}/announce`, {}));
      await Promise.all(promises);
      onSuccess(`Force announce initiated for ${ids.length} torrent(s)`);
      onRefresh();
    } catch (e: unknown) {
      onError(getErrorMessage(e, "Failed to force announce"));
    } finally {
      setLoading(opId, false);
    }
  }, [online, onSuccess, onError, onRefresh, setLoading]);

  return {
    loadingOperations,
    handleBulkStart,
    handleBulkStop,
    handleBulkPause,
    handleBulkRemove,
    handleForceRecheck,
    handleForceAnnounce,
  };
}
