import React, { memo, useCallback, useEffect, useState } from "react";
import {
  setNotificationSoundUrl,
  previewNotificationSound,
  getNotifyOnCompletion,
  getNotifyOnKillSwitch,
  NOTIFY_ON_COMPLETION_STORAGE_KEY,
  NOTIFY_ON_KILL_SWITCH_STORAGE_KEY,
} from "../utils/notifications";

interface NotificationSoundSettingsProps {
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

function defaultSoundLabel(filename: string): string {
  return filename.replace(/\.mp3$/i, "").replace(/\s*[-–—|]\s*.*$/, "").trim() || filename;
}

export const NotificationSoundSettings = memo<NotificationSoundSettingsProps>(({ onError, onSuccess }) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [defaultSounds, setDefaultSounds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(() => getNotifyOnCompletion());
  const [notifyOnKillSwitch, setNotifyOnKillSwitch] = useState(() => getNotifyOnKillSwitch());

  const refreshUrl = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.getUrl !== "function") return null;
    const url = await window.orc.notificationSound.getUrl();
    setCurrentUrl(url);
    setNotificationSoundUrl(url);
    return url;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (typeof window.orc?.notificationSound?.getDefaults === "function") {
        const list = await window.orc.notificationSound.getDefaults();
        if (!cancelled) setDefaultSounds(list);
      }
      await refreshUrl();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshUrl]);

  const handleSetDefault = useCallback(
    async (filename: string): Promise<boolean> => {
      if (typeof window.orc?.notificationSound?.setDefault !== "function") {
        onError?.("Notification sound is not available");
        return false;
      }
      const ok = await window.orc.notificationSound.setDefault(filename);
      if (ok) {
        await refreshUrl();
        onSuccess?.(`Notification sound: ${defaultSoundLabel(filename)}`);
        return true;
      }
      onError?.("Failed to set default sound");
      return false;
    },
    [refreshUrl, onError, onSuccess]
  );

  const handleChooseFile = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.chooseFile !== "function") {
      onError?.("Notification sound is not available");
      return;
    }
    const ok = await window.orc.notificationSound.chooseFile();
    if (ok) {
      await refreshUrl();
      onSuccess?.("Custom notification sound saved");
    } else {
      onError?.("No file selected or save failed");
    }
  }, [refreshUrl, onError, onSuccess]);

  const handleClear = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.clear !== "function") return;
    await window.orc.notificationSound.clear();
    await refreshUrl();
    onSuccess?.("Using built-in notification tone");
  }, [refreshUrl, onSuccess]);

  const handlePreview = useCallback(() => {
    previewNotificationSound();
  }, []);

  const handleNotifyOnCompletionChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setNotifyOnCompletion(checked);
    try {
      localStorage.setItem(NOTIFY_ON_COMPLETION_STORAGE_KEY, checked ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const handleNotifyOnKillSwitchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const checked = e.target.checked;
    setNotifyOnKillSwitch(checked);
    try {
      localStorage.setItem(NOTIFY_ON_KILL_SWITCH_STORAGE_KEY, checked ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

  const currentDefaultFilename =
    currentUrl?.startsWith("app://default-notification-sounds/") ?
      decodeURIComponent(currentUrl.replace("app://default-notification-sounds/", "").replace(/\?.*$/, ""))
    : null;
  const isCustom = currentUrl === "app://notification-sound";
  const isBuiltIn = currentUrl === null;

  const dropdownValue = isBuiltIn ? "" : isCustom ? "__custom__" : (currentDefaultFilename ?? "");

  const handleDropdownChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === "") {
        await handleClear();
        previewNotificationSound();
      } else if (value !== "__custom__") {
        const ok = await handleSetDefault(value);
        if (ok) previewNotificationSound();
      }
    },
    [handleClear, handleSetDefault]
  );

  if (loading) {
    return (
      <div className="notificationSoundSettings">
        <div className="securitySettingsSectionTitle">Notification sound</div>
        <div className="securitySettingsLoading">Loading…</div>
      </div>
    );
  }

  return (
    <div className="notificationSoundSettings">
      <div className="securitySettingsSectionTitle">Notification sound</div>
      <div className="notificationToggles" style={{ marginBottom: 12 }}>
        <label className="notificationToggleLabel" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={notifyOnCompletion}
            onChange={handleNotifyOnCompletionChange}
            aria-label="Desktop notification when a download finishes"
          />
          <span>Desktop notification when a download finishes</span>
        </label>
        <label className="notificationToggleLabel" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 6 }}>
          <input
            type="checkbox"
            checked={notifyOnKillSwitch}
            onChange={handleNotifyOnKillSwitchChange}
            aria-label="Desktop notification when kill switch activates or releases"
          />
          <span>Desktop notification when kill switch activates (and when it releases)</span>
        </label>
      </div>
      <p className="notificationSoundDescription">
        Sound played when a torrent completes or when the kill switch activates. Choose from the list below, or add more MP3 files to the app’s notification-sounds folder to see them here.
      </p>
      <div className="notificationSoundActions">
        <div className="notificationSoundDefaults" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <label className="notificationSoundDefaultsLabel" htmlFor="notification-sound-select" style={{ marginBottom: 0 }}>
            Notification sound:
          </label>
          <select
            id="notification-sound-select"
            className="notificationSoundSelect"
            value={dropdownValue}
            onChange={handleDropdownChange}
            aria-label="Select notification sound"
          >
            <option value="">Built-in tone</option>
            {defaultSounds.map((name) => (
              <option key={name} value={name}>
                {defaultSoundLabel(name)}
              </option>
            ))}
            {isCustom && (
              <option value="__custom__">Custom sound</option>
            )}
          </select>
          <button
            type="button"
            className="btn ghost"
            onClick={handlePreview}
            title="Play the selected notification sound"
            aria-label="Test notification sound"
          >
            ▶ Test sound
          </button>
        </div>
        <p className="notificationSoundDescription" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
          Click &quot;Test sound&quot; to play the selected sound, or change the dropdown to switch and hear it.
        </p>
        <div className="profileButtons" style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={handleChooseFile} title="Select your own audio file">
            Choose custom file…
          </button>
        </div>
      </div>
    </div>
  );
});

NotificationSoundSettings.displayName = "NotificationSoundSettings";
