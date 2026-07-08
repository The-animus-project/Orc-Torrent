import React, { useCallback, useEffect, useState } from "react";
import type { BandwidthProfile, BandwidthSettings, SessionLimitsResponse } from "../types";
import { getSessionLimits, patchBandwidthSchedule, postSessionLimits } from "../utils/bandwidthApi";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function bpsToKbps(bps?: number | null): string {
  if (!bps) return "";
  return String(Math.round(bps / 1024));
}

function kbpsToBps(kbps: string): number | null {
  const n = parseInt(kbps.trim(), 10);
  if (!n || n < 1) return null;
  return n * 1024;
}

interface BandwidthSettingsPanelProps {
  online: boolean;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onProfileChange?: (profile: BandwidthProfile) => void;
}

export const BandwidthSettingsPanel: React.FC<BandwidthSettingsPanelProps> = ({
  online,
  onError,
  onSuccess,
  onProfileChange,
}) => {
  const [limits, setLimits] = useState<SessionLimitsResponse | null>(null);
  const [normalDl, setNormalDl] = useState("");
  const [normalUl, setNormalUl] = useState("");
  const [limitedDl, setLimitedDl] = useState("");
  const [limitedUl, setLimitedUl] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!online) return;
    try {
      const resp = await getSessionLimits();
      setLimits(resp);
      onProfileChange?.(resp.active_profile);
      const bw = resp.bandwidth;
      setNormalDl(bpsToKbps(bw.normal_download_bps));
      setNormalUl(bpsToKbps(bw.normal_upload_bps));
      setLimitedDl(bpsToKbps(bw.limited_download_bps));
      setLimitedUl(bpsToKbps(bw.limited_upload_bps));
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to load bandwidth settings");
    }
  }, [online, onError, onProfileChange]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10000);
    return () => clearInterval(id);
  }, [load]);

  const buildBandwidth = (): BandwidthSettings | null => {
    if (!limits) return null;
    return {
      ...limits.bandwidth,
      normal_download_bps: kbpsToBps(normalDl),
      normal_upload_bps: kbpsToBps(normalUl),
      limited_download_bps: kbpsToBps(limitedDl),
      limited_upload_bps: kbpsToBps(limitedUl),
    };
  };

  const saveNormal = async () => {
    setSaving(true);
    try {
      const resp = await postSessionLimits({
        download_bps: kbpsToBps(normalDl),
        upload_bps: kbpsToBps(normalUl),
      });
      setLimits(resp);
      onProfileChange?.(resp.active_profile);
      onSuccess("Normal speed limits applied");
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to apply limits");
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    const bw = buildBandwidth();
    if (!bw) return;
    setSaving(true);
    try {
      await patchBandwidthSchedule(bw);
      await load();
      onSuccess("Bandwidth schedule saved");
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : "Failed to save schedule");
    } finally {
      setSaving(false);
    }
  };

  const toggleDay = (day: number) => {
    if (!limits) return;
    const days = limits.bandwidth.schedule_days.includes(day)
      ? limits.bandwidth.schedule_days.filter((d) => d !== day)
      : [...limits.bandwidth.schedule_days, day].sort();
    setLimits({
      ...limits,
      bandwidth: { ...limits.bandwidth, schedule_days: days },
    });
  };

  if (!limits) {
    return <p className="settingsSummaryNote">Loading bandwidth settings…</p>;
  }

  const profileLabel = limits.active_profile === "limited" ? "Limited" : "Normal";

  return (
    <>
      <div className="settingsSectionCard settingsSummaryCard">
        <h2 className="settingsSectionCardTitle">Active profile</h2>
        <span className={`settingsSummaryBadge ${limits.active_profile === "limited" ? "warn" : "ok"}`}>
          {profileLabel}
        </span>
      </div>

      <div className="settingsSectionCard settingsSectionCardWide">
        <h2 className="settingsSectionCardTitle">Normal speed limits</h2>
        <div className="settingsRateLimitGrid">
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Download (KB/s)</span>
            <input
              className="settingsNumberInput"
              value={normalDl}
              onChange={(e) => setNormalDl(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Upload (KB/s)</span>
            <input
              className="settingsNumberInput"
              value={normalUl}
              onChange={(e) => setNormalUl(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
        </div>
        <button type="button" className="btn primary" onClick={() => void saveNormal()} disabled={saving}>
          Apply normal limits
        </button>
      </div>

      <div className="settingsSectionCard settingsSectionCardWide">
        <h2 className="settingsSectionCardTitle">Quiet hours (limited profile)</h2>
        <label className="settingsRateLimitToggleRow">
          <span className="settingsRateLimitLabel">Enable schedule</span>
          <input
            type="checkbox"
            checked={limits.bandwidth.schedule_enabled}
            onChange={(e) =>
              setLimits({
                ...limits,
                bandwidth: { ...limits.bandwidth, schedule_enabled: e.target.checked },
              })
            }
          />
        </label>
        <div className="settingsRateLimitGrid">
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Limited download (KB/s)</span>
            <input
              className="settingsNumberInput"
              value={limitedDl}
              onChange={(e) => setLimitedDl(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Limited upload (KB/s)</span>
            <input
              className="settingsNumberInput"
              value={limitedUl}
              onChange={(e) => setLimitedUl(e.target.value)}
              placeholder="Unlimited"
            />
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">Start (HH:MM)</span>
            <input
              className="settingsNumberInput"
              value={limits.bandwidth.schedule_start}
              onChange={(e) =>
                setLimits({
                  ...limits,
                  bandwidth: { ...limits.bandwidth, schedule_start: e.target.value },
                })
              }
            />
          </label>
          <label className="settingsRateLimitField">
            <span className="settingsRateLimitLabel">End (HH:MM)</span>
            <input
              className="settingsNumberInput"
              value={limits.bandwidth.schedule_end}
              onChange={(e) =>
                setLimits({
                  ...limits,
                  bandwidth: { ...limits.bandwidth, schedule_end: e.target.value },
                })
              }
            />
          </label>
        </div>
        <div className="scheduleDaysRow">
          {DAY_LABELS.map((label, i) => (
            <label key={label} className="scheduleDayChip">
              <input
                type="checkbox"
                checked={limits.bandwidth.schedule_days.includes(i)}
                onChange={() => toggleDay(i)}
              />
              {label}
            </label>
          ))}
        </div>
        <button type="button" className="btn primary" onClick={() => void saveSchedule()} disabled={saving}>
          Save schedule
        </button>
      </div>
    </>
  );
};
