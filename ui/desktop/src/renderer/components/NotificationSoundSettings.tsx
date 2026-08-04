import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  setNotificationSoundUrl,
  previewNotificationSound,
  showTestDesktopNotification,
  getNotifyOnCompletion,
  getNotifyOnKillSwitch,
  NOTIFY_ON_COMPLETION_STORAGE_KEY,
  NOTIFY_ON_KILL_SWITCH_STORAGE_KEY,
} from "../utils/notifications";
import {
  getCustomSoundSelectValue,
  getNotificationSoundSelectOptions,
  isCustomNotificationSoundUrl,
  parseDefaultNotificationSoundUrl,
  readStoredNotificationSoundPreference,
  storedNotificationSoundPreferenceToUrl,
} from "../../shared/notificationSoundRegistry";

interface NotificationSoundSettingsProps {
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export const NotificationSoundSettings = memo<NotificationSoundSettingsProps>(({ onError, onSuccess }) => {
  const [currentUrl, setCurrentUrl] = useState<string | null>(null);
  const [diskSounds, setDiskSounds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [notifyOnCompletion, setNotifyOnCompletion] = useState(() => getNotifyOnCompletion());
  const [notifyOnKillSwitch, setNotifyOnKillSwitch] = useState(() => getNotifyOnKillSwitch());

  const refreshUrl = useCallback(async () => {
    let url: string | null = null;
    if (typeof window.orc?.notificationSound?.getPreference === "function") {
      const preference = await window.orc.notificationSound.getPreference();
      if (typeof window.orc.notificationSound.getUrl === "function") {
        url = await window.orc.notificationSound.getUrl();
      }
      url = url ?? storedNotificationSoundPreferenceToUrl(preference);
    } else if (typeof window.orc?.notificationSound?.getUrl === "function") {
      url = await window.orc.notificationSound.getUrl();
    } else {
      const stored = readStoredNotificationSoundPreference();
      url = stored ? storedNotificationSoundPreferenceToUrl(stored) : null;
    }
    setCurrentUrl(url);
    setNotificationSoundUrl(url);
    return url;
  }, []);

  const refreshDiskSounds = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.getDefaults !== "function") {
      setDiskSounds([]);
      return;
    }
    const list = await window.orc.notificationSound.getDefaults();
    setDiskSounds(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshDiskSounds();
      await refreshUrl();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshDiskSounds, refreshUrl]);

  const isCustom = isCustomNotificationSoundUrl(currentUrl);
  const isBuiltIn = currentUrl === null;
  const currentDefaultFilename = parseDefaultNotificationSoundUrl(currentUrl);
  const customSelectValue = getCustomSoundSelectValue();

  const soundOptions = useMemo(() => getNotificationSoundSelectOptions(diskSounds, isCustom), [diskSounds, isCustom]);

  const dropdownValue = isBuiltIn ? "" : isCustom ? customSelectValue : (currentDefaultFilename ?? "");
  const dropdownValueInOptions = soundOptions.some((o) => o.value === dropdownValue);

  const handleSetDefault = useCallback(
    async (filename: string): Promise<boolean> => {
      if (typeof window.orc?.notificationSound?.setDefault !== "function") {
        onError?.("Notification sound is not available");
        return false;
      }
      const ok = await window.orc.notificationSound.setDefault(filename);
      if (ok) {
        await refreshUrl();
        await refreshDiskSounds();
        const label = soundOptions.find((o) => o.value === filename)?.label ?? filename;
        onSuccess?.(`Notification sound: ${label}`);
        return true;
      }
      onError?.("Failed to set default sound");
      return false;
    },
    [refreshUrl, refreshDiskSounds, onError, onSuccess, soundOptions]
  );

  const handleChooseFile = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.chooseFile !== "function") {
      onError?.("Notification sound is not available");
      return false;
    }
    const ok = await window.orc.notificationSound.chooseFile();
    if (ok) {
      await refreshUrl();
      await refreshDiskSounds();
      onSuccess?.("Custom notification sound saved");
      previewNotificationSound();
      return true;
    }
    onError?.("No file selected or save failed");
    return false;
  }, [refreshUrl, refreshDiskSounds, onError, onSuccess]);

  const handleClear = useCallback(async () => {
    if (typeof window.orc?.notificationSound?.clear !== "function") return;
    await window.orc.notificationSound.clear();
    await refreshUrl();
    onSuccess?.("Using built-in notification tone");
  }, [refreshUrl, onSuccess]);

  const handlePreview = useCallback(() => {
    previewNotificationSound();
  }, []);

  const handleSendTestDesktopNotification = useCallback(async () => {
    const ok = await showTestDesktopNotification();
    if (ok) onSuccess?.("Test desktop notification sent");
    else onError?.("Desktop notification permission is blocked or unavailable");
  }, [onError, onSuccess]);

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

  const handleDropdownChange = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      if (value === "") {
        await handleClear();
        previewNotificationSound();
        return;
      }
      if (value === customSelectValue) {
        if (!isCustom) {
          await handleChooseFile();
        } else {
          previewNotificationSound();
        }
        return;
      }
      const option = soundOptions.find((o) => o.value === value);
      if (!option?.available) {
        onError?.("That sound file is missing from the notification-sounds folder");
        return;
      }
      const ok = await handleSetDefault(value);
      if (ok) previewNotificationSound();
    },
    [customSelectValue, handleClear, handleChooseFile, handleSetDefault, isCustom, onError, soundOptions]
  );

  if (loading) {
    return (
      <div className="notificationSoundSettings">
        <div className="securitySettingsSectionTitle">Notification sound</div>
        <div className="securitySettingsLoading">Loading…</div>
      </div>
    );
  }

  const missingBundledCount = soundOptions.filter((o) => o.kind === "bundled" && !o.available).length;

  return (
    <div className="notificationSoundSettings">
      <div className="securitySettingsSectionTitle">Notification sound</div>
      <div className="notificationToggles">
        <label className="notificationToggleLabel">
          <input
            type="checkbox"
            checked={notifyOnCompletion}
            onChange={handleNotifyOnCompletionChange}
            aria-label="Desktop notification when a download finishes"
          />
          <span>Desktop notification when a download finishes</span>
        </label>
        <label className="notificationToggleLabel">
          <input
            type="checkbox"
            checked={notifyOnKillSwitch}
            onChange={handleNotifyOnKillSwitchChange}
            aria-label="Desktop notification when VPN transfer pause activates or releases"
          />
          <span>Desktop notification when VPN transfer pause activates (and when it releases)</span>
        </label>
      </div>
      <p className="notificationSoundDescription">
        Sound played when a torrent completes or when VPN transfer pause activates. All bundled sounds are listed below;
        pick &quot;Custom sound…&quot; or use Choose custom file to use your own audio.
      </p>
      {missingBundledCount > 0 ? (
        <p className="notificationSoundDescription notificationSoundWarning">
          {missingBundledCount} bundled sound{missingBundledCount === 1 ? "" : "s"} missing from the app folder and
          cannot be selected until the MP3 is installed.
        </p>
      ) : null}
      <div className="notificationSoundActions">
        <div className="notificationSoundDefaults notificationSoundDefaultsRow">
          <label
            className="notificationSoundDefaultsLabel notificationSoundDefaultsLabelInline"
            htmlFor="notification-sound-select"
          >
            Notification sound:
          </label>
          <select
            id="notification-sound-select"
            className="notificationSoundSelect"
            value={dropdownValueInOptions ? dropdownValue : ""}
            onChange={handleDropdownChange}
            aria-label="Select notification sound"
          >
            {!dropdownValueInOptions && dropdownValue ? (
              <option value={dropdownValue} disabled>
                {dropdownValue} (missing — pick another sound)
              </option>
            ) : null}
            {soundOptions.map((option) => (
              <option key={option.value || "builtin"} value={option.value} disabled={!option.available}>
                {option.available ? option.label : `${option.label} (not installed)`}
              </option>
            ))}
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
        <p className="notificationSoundDescription notificationSoundHint">
          Click &quot;Test sound&quot; to play the selected sound, or change the dropdown to switch and hear it.
        </p>
        <div className="profileButtons notificationSoundButtons">
          <button type="button" className="btn" onClick={handleChooseFile} title="Select your own audio file">
            Choose custom file…
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={handleSendTestDesktopNotification}
            title="Show a test desktop popup using the selected sound"
          >
            Send test desktop notification
          </button>
        </div>
      </div>
    </div>
  );
});

NotificationSoundSettings.displayName = "NotificationSoundSettings";
