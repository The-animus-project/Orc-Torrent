import React, { useState, useEffect, useCallback } from "react";
import { LogViewer } from "./LogViewer";
import { getJson } from "../utils/api";
import { logger } from "../utils/logger";

interface DaemonControlProps {
  /** From App ping; status/control use IPC, Verify uses HTTP. */
  online: boolean;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

type DaemonStatus = "stopped" | "starting" | "running" | "stopping" | "unknown";

export const DaemonControl: React.FC<DaemonControlProps> = ({
  online,
  onError,
  onSuccess,
}) => {
  const [status, setStatus] = useState<DaemonStatus>("unknown");
  const [pid, setPid] = useState<number | undefined>(undefined);
  const [isOperating, setIsOperating] = useState(false);

  // Fetch daemon status
  const fetchStatus = useCallback(async () => {
    try {
      if (window.orc?.daemon?.getStatus) {
        const result = await window.orc.daemon.getStatus();
        setStatus(result.status as DaemonStatus);
        setPid(result.pid);
      }
    } catch (err) {
      logger.errorWithPrefix("DaemonControl", "Failed to fetch daemon status:", err);
      setStatus("unknown");
    }
  }, []);

  // Poll status periodically
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Handle start daemon
  const handleStart = useCallback(async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      if (window.orc?.daemon?.start) {
        const result = await window.orc.daemon.start();
        if (result.success) {
          onSuccess?.("Daemon started successfully");
          setTimeout(fetchStatus, 1000); // Refresh status after a delay
        } else {
          onError?.(result.error || "Failed to start daemon");
        }
      } else {
        onError?.("Daemon control API not available");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to start daemon";
      onError?.(msg);
    } finally {
      setIsOperating(false);
    }
  }, [isOperating, onError, onSuccess, fetchStatus]);

  // Handle stop daemon
  const handleStop = useCallback(async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      if (window.orc?.daemon?.stop) {
        const result = await window.orc.daemon.stop();
        if (result.success) {
          onSuccess?.("Daemon stopped successfully");
          setTimeout(fetchStatus, 1000);
        } else {
          onError?.(result.error || "Failed to stop daemon");
        }
      } else {
        onError?.("Daemon control API not available");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to stop daemon";
      onError?.(msg);
    } finally {
      setIsOperating(false);
    }
  }, [isOperating, onError, onSuccess, fetchStatus]);

  // Handle restart daemon
  const handleRestart = useCallback(async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      if (window.orc?.daemon?.restart) {
        const result = await window.orc.daemon.restart();
        if (result.success) {
          onSuccess?.("Daemon restarted successfully");
          setTimeout(fetchStatus, 2000); // Give it more time to restart
        } else {
          onError?.(result.error || "Failed to restart daemon");
        }
      } else {
        onError?.("Daemon control API not available");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to restart daemon";
      onError?.(msg);
    } finally {
      setIsOperating(false);
    }
  }, [isOperating, onError, onSuccess, fetchStatus]);

  // Verify GUI-daemon HTTP connection (health, version, torrents)
  const handleVerifyConnection = useCallback(async () => {
    if (isOperating) return;
    setIsOperating(true);
    try {
      const [health, version, torrents] = await Promise.all([
        getJson<{ ok: boolean }>("/health"),
        getJson<{ version: string }>("/version"),
        getJson<{ items: unknown[] }>("/torrents"),
      ]);
      const ok = Boolean(health?.ok);
      const v = version?.version ?? "?";
      const n = Array.isArray(torrents?.items) ? torrents.items.length : 0;
      const torrentLabel = n === 1 ? "1 torrent" : `${n} torrents`;
      if (ok) {
        onSuccess?.(`Connection OK: daemon v${v}, ${torrentLabel}`);
      } else {
        onError?.("Health check failed (ok=false)");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection check failed";
      onError?.(msg);
    } finally {
      setIsOperating(false);
    }
  }, [isOperating, onError, onSuccess]);

  const getStatusColor = () => {
    switch (status) {
      case "running":
        return "green";
      case "starting":
        return "yellow";
      case "stopping":
        return "orange";
      case "stopped":
        return "red";
      default:
        return "gray";
    }
  };

  const getStatusText = () => {
    switch (status) {
      case "running":
        return `Running${pid ? ` (PID: ${pid})` : ""}`;
      case "starting":
        return "Starting...";
      case "stopping":
        return "Stopping...";
      case "stopped":
        return "Stopped";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="daemonControl">
      <div className="daemonControlHeader">
        <h2>Daemon Control</h2>
        <div className="daemonStatus">
          <span
            className="daemonStatusIndicator"
            style={{ backgroundColor: getStatusColor() }}
          />
          <span className="daemonStatusText">{getStatusText()}</span>
        </div>
      </div>

      <div className="daemonControlActions">
        <button
          className="btn primary"
          onClick={handleStart}
          disabled={isOperating || status === "running" || status === "starting"}
          title="Start the daemon"
        >
          {isOperating && status === "starting" ? "Starting..." : "Start"}
        </button>
        <button
          className="btn"
          onClick={handleStop}
          disabled={isOperating || status === "stopped" || status === "stopping"}
          title="Stop the daemon gracefully"
        >
          {isOperating && status === "stopping" ? "Stopping..." : "Stop"}
        </button>
        <button
          className="btn"
          onClick={handleRestart}
          disabled={isOperating}
          title="Restart the daemon"
        >
          {isOperating ? "Restarting..." : "Restart"}
        </button>
        <button
          className="btn"
          onClick={handleVerifyConnection}
          disabled={isOperating}
          title="Verify HTTP connection to daemon (health, version, torrents)"
        >
          Verify connection
        </button>
      </div>

      <div className="daemonControlLogs">
        <LogViewer maxLines={300} />
      </div>
    </div>
  );
};
