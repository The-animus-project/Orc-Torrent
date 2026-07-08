import React, { memo, useCallback, useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/updaterTypes";

interface UpdateSettingsProps {
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

function formatLastChecked(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString();
}

function phaseLabel(status: UpdateStatus): string {
  switch (status.phase) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return status.availableVersion ? `Update available: v${status.availableVersion}` : "Update available";
    case "downloading":
      return status.downloadPercent != null
        ? `Downloading update… ${Math.round(status.downloadPercent)}%`
        : "Downloading update…";
    case "downloaded":
      return status.availableVersion ? `Ready to install v${status.availableVersion}` : "Update ready to install";
    case "not-available":
      return "You're up to date";
    case "error":
      return status.error ?? "Update check failed";
    default:
      return "Idle";
  }
}

export const UpdateSettings = memo<UpdateSettingsProps>(({ onError, onSuccess }) => {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (typeof window.orc?.updater?.getStatus !== "function") return;
    const next = (await window.orc.updater.getStatus()) as UpdateStatus;
    setStatus(next);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshStatus().then((next) => {
      if (!cancelled && next) setStatus(next);
    });

    const unsubscribe =
      typeof window.orc?.updater?.onStatusChanged === "function"
        ? window.orc.updater.onStatusChanged((next) => {
            setStatus(next as UpdateStatus);
          })
        : undefined;

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [refreshStatus]);

  const handleToggleAutoCheck = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      if (typeof window.orc?.updater?.setAutoCheck !== "function") {
        onError?.("Auto-update is not available in this build");
        return;
      }
      const enabled = event.target.checked;
      const next = (await window.orc.updater.setAutoCheck(enabled)) as UpdateStatus;
      setStatus(next);
      onSuccess?.(enabled ? "Auto-check updates enabled" : "Auto-check updates disabled");
    },
    [onError, onSuccess]
  );

  const handleCheckNow = useCallback(async () => {
    if (typeof window.orc?.updater?.check !== "function") {
      onError?.("Update checks are not available in this build");
      return;
    }
    setChecking(true);
    try {
      const next = (await window.orc.updater.check()) as UpdateStatus;
      setStatus(next);
      if (next.phase === "not-available") {
        onSuccess?.("You're running the latest version");
      } else if (next.phase === "error") {
        onError?.(next.error ?? "Update check failed");
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Update check failed");
    } finally {
      setChecking(false);
    }
  }, [onError, onSuccess]);

  const handleInstall = useCallback(async () => {
    if (typeof window.orc?.updater?.install !== "function") {
      onError?.("Install is not available in this build");
      return;
    }
    setInstalling(true);
    try {
      const result = (await window.orc.updater.install()) as { success: boolean; error?: string };
      if (!result.success) {
        onError?.(result.error ?? "Failed to install update");
        setInstalling(false);
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to install update");
      setInstalling(false);
    }
  }, [onError]);

  const updaterAvailable = typeof window.orc?.updater?.getStatus === "function";
  const autoCheck = status?.autoCheck ?? true;
  const showInstall = status?.phase === "downloaded";

  if (!updaterAvailable) {
    return (
      <p className="settingsSummaryNote">
        Auto-update is available in packaged public builds only. AnimUS private builds skip GitHub update checks.
      </p>
    );
  }

  return (
    <div className="settingsSection">
      <div className="settingsSummaryRows">
        <div className="settingsSummaryRow">
          <span>Current version</span>
          <span className="settingsSummaryValue">v{status?.currentVersion ?? "—"}</span>
        </div>
        <div className="settingsSummaryRow">
          <span>Auto-check updates</span>
          <label className="toggle small">
            <input type="checkbox" checked={autoCheck} onChange={handleToggleAutoCheck} />
            <span className="slider" />
          </label>
        </div>
        <div className="settingsSummaryRow">
          <span>Status</span>
          <span
            className={`settingsSummaryBadge ${status?.phase === "error" ? "warn" : status?.phase === "downloaded" ? "ok" : "muted"}`}
          >
            {status ? phaseLabel(status) : "Loading…"}
          </span>
        </div>
        <div className="settingsSummaryRow">
          <span>Last checked</span>
          <span className="settingsSummaryValue">{formatLastChecked(status?.lastCheckedAt ?? null)}</span>
        </div>
      </div>

      <div className="settingsQuickActions">
        <button
          className="btn"
          type="button"
          onClick={handleCheckNow}
          disabled={checking || status?.phase === "checking" || status?.phase === "downloading"}
        >
          {checking || status?.phase === "checking" ? "Checking…" : "Check for updates now"}
        </button>
        {showInstall ? (
          <button className="btn primary" type="button" onClick={handleInstall} disabled={installing}>
            {installing ? "Restarting…" : "Restart to update"}
          </button>
        ) : null}
      </div>

      {status?.phase === "downloaded" ? (
        <p className="settingsSummaryNote">
          A new version has been downloaded. Restart ORC TORRENT to complete the update.
        </p>
      ) : null}
    </div>
  );
});

UpdateSettings.displayName = "UpdateSettings";
