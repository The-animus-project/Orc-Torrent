import React, { useCallback, useEffect, useState } from "react";
import type { SeedingSettings } from "../types";
import { getSeedingSettings, patchSeedingSettings } from "../utils/seedingApi";

interface SeedingSettingsPanelProps {
  online: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const SeedingSettingsPanel: React.FC<SeedingSettingsPanelProps> = ({ online, onError, onSuccess }) => {
  const [settings, setSettings] = useState<SeedingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      setSettings(await getSeedingSettings());
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to load seeding settings");
    }
  }, [online, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      setSettings(await patchSeedingSettings(settings));
      onSuccess("Seeding settings saved");
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to save seeding settings");
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return <p className="settingsSummaryNote">Loading seeding settings…</p>;
  }

  return (
    <div className="settingsSectionCard settingsSectionCardWide">
      <h2 className="settingsSectionCardTitle">Seeding limits</h2>
      <p className="settingsSummaryNote">
        Applies globally to completed torrents. Active downloads are never stopped by these rules.
      </p>

      <label className="settingsRateLimitToggleRow">
        <span className="settingsRateLimitLabel">Stop seeding when ratio reaches</span>
        <input
          type="checkbox"
          checked={settings.ratio_limit_enabled}
          onChange={(e) => setSettings({ ...settings, ratio_limit_enabled: e.target.checked })}
        />
      </label>
      <label className="settingsRateLimitField">
        <span className="settingsRateLimitLabel">Ratio (upload ÷ download)</span>
        <input
          type="number"
          min="0.1"
          step="0.1"
          className="settingsNumberInput"
          value={settings.ratio_limit}
          disabled={!settings.ratio_limit_enabled}
          onChange={(e) => setSettings({ ...settings, ratio_limit: parseFloat(e.target.value) || 1 })}
        />
      </label>

      <label className="settingsRateLimitToggleRow">
        <span className="settingsRateLimitLabel">Stop seeding after (hours)</span>
        <input
          type="checkbox"
          checked={settings.seed_time_limit_enabled}
          onChange={(e) => setSettings({ ...settings, seed_time_limit_enabled: e.target.checked })}
        />
      </label>
      <label className="settingsRateLimitField">
        <span className="settingsRateLimitLabel">Hours</span>
        <input
          type="number"
          min="1"
          step="1"
          className="settingsNumberInput"
          value={Math.round(settings.seed_time_minutes / 60) || ""}
          disabled={!settings.seed_time_limit_enabled}
          onChange={(e) =>
            setSettings({
              ...settings,
              seed_time_minutes: (parseInt(e.target.value, 10) || 0) * 60,
            })
          }
        />
      </label>

      <div className="settingsQuickActions">
        <button type="button" className="btn primary" onClick={() => void save()} disabled={!online || saving}>
          {saving ? "Saving…" : "Apply globally"}
        </button>
      </div>
    </div>
  );
};
