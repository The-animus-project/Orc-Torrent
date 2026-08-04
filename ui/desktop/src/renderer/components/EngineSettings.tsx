import React, { memo, useCallback, useEffect, useState } from "react";
import type { EngineMode, EngineNetworkPolicy } from "../types/policy";
import { getJson } from "../utils/api";
import { usePolicy } from "../utils/usePolicy";

type Capability = {
  supported: boolean;
  enabled: boolean;
  reason?: string;
};

type EngineCapabilities = {
  name: string;
  api_version: number;
  implementation_version: string;
  lineage: string;
  mode: EngineMode;
  transports: Record<"tcp" | "utp" | "ipv4" | "ipv6", Capability>;
  discovery: Record<"dht" | "pex" | "lsd", Capability>;
  persistence_enabled: boolean;
  network_suspended: boolean;
  degraded_reasons: string[];
};

interface EngineSettingsProps {
  online: boolean;
  onError?: (message: string) => void;
  onSuccess?: (message: string) => void;
}

const MODERN_POLICY: EngineNetworkPolicy = {
  mode: "modern",
  transports: { tcp: true, utp: true, ipv4: true, ipv6: true },
  discovery: { dht: true, pex: true, lsd: true },
  strict_binding: false,
};

const LEGACY_POLICY: EngineNetworkPolicy = {
  mode: "legacy",
  transports: { tcp: true, utp: false, ipv4: true, ipv6: false },
  discovery: { dht: true, pex: true, lsd: false },
  strict_binding: false,
};

export const EngineSettings = memo<EngineSettingsProps>(({ online, onError, onSuccess }) => {
  const { state, update, loading } = usePolicy(online);
  const [capabilities, setCapabilities] = useState<EngineCapabilities | null>(null);

  const refreshCapabilities = useCallback(async () => {
    if (!online) {
      setCapabilities(null);
      return;
    }
    try {
      setCapabilities(await getJson<EngineCapabilities>("/engine/capabilities"));
    } catch (error: unknown) {
      onError?.(error instanceof Error ? error.message : "Failed to read engine capabilities");
    }
  }, [online, onError]);

  useEffect(() => {
    void refreshCapabilities();
    const interval = window.setInterval(() => void refreshCapabilities(), 5000);
    return () => window.clearInterval(interval);
  }, [refreshCapabilities]);

  const applyEngine = useCallback(
    async (engine: EngineNetworkPolicy, message: string) => {
      try {
        await update({ engine, ipv6_enabled: engine.transports.ipv6 });
        await refreshCapabilities();
        onSuccess?.(message);
      } catch (error: unknown) {
        onError?.(error instanceof Error ? error.message : "Failed to update engine policy");
      }
    },
    [onError, onSuccess, refreshCapabilities, update]
  );

  if (!state) {
    return <p className="settingsSummaryNote">Loading engine policy…</p>;
  }

  const desired = state.desired.engine;
  const effective = state.effective.engine;
  const modernEnabled = desired.mode === "modern";

  const setMode = (mode: EngineMode) => {
    if (mode === "modern") {
      void applyEngine(MODERN_POLICY, "Modern swarm beta enabled");
    } else if (mode === "legacy") {
      void applyEngine(LEGACY_POLICY, "Legacy swarm mode selected");
    } else {
      void applyEngine({ ...LEGACY_POLICY, mode: "auto" }, "Automatic engine mode selected");
    }
  };

  const patchEngine = (patch: Partial<EngineNetworkPolicy>) => {
    void applyEngine({ ...desired, ...patch }, "Engine network policy updated");
  };

  const patchGroup = <K extends "transports" | "discovery">(
    group: K,
    key: keyof EngineNetworkPolicy[K],
    checked: boolean
  ) => {
    patchEngine({ [group]: { ...desired[group], [key]: checked } } as Partial<EngineNetworkPolicy>);
  };

  return (
    <div className="settingsSummaryCard">
      <h2 className="settingsSectionCardTitle">ORC Engine</h2>
      <div className="settingsSummaryField">
        <label className="notificationThemeLabel" htmlFor="engine-mode-select">
          Swarm compatibility mode
        </label>
        <select
          id="engine-mode-select"
          className="triStateSelect"
          value={desired.mode}
          onChange={(event) => setMode(event.target.value as EngineMode)}
          disabled={!online || loading}
        >
          <option value="auto">Automatic (Legacy during beta)</option>
          <option value="legacy">Legacy</option>
          <option value="modern">Modern swarm (beta)</option>
        </select>
        <p className="settingsSummaryNote">
          Modern enables uTP, IPv6, and local peer discovery. Automatic remains on the proven Legacy set for this beta.
        </p>
      </div>

      <div className="settingsRateLimitToggleRow">
        <div>
          <div className="settingsRateLimitLabel">Modern swarm (beta)</div>
          <p className="settingsSummaryNote">
            Explicit opt-in; turning this off selects Legacy and will not be changed by a future automatic-mode
            promotion.
          </p>
        </div>
        <label className="toggle small" aria-label="Enable Modern swarm beta">
          <input
            type="checkbox"
            checked={modernEnabled}
            onChange={(event) => setMode(event.target.checked ? "modern" : "legacy")}
            disabled={!online || loading}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="settingsSummaryRows">
        {(["tcp", "utp", "ipv4", "ipv6"] as const).map((key) => (
          <label className="settingsSummaryRow" key={key}>
            <span>{key.toUpperCase()}</span>
            <input
              type="checkbox"
              checked={desired.transports[key]}
              onChange={(event) => patchGroup("transports", key, event.target.checked)}
              disabled={!online || loading}
            />
          </label>
        ))}
        {(["dht", "pex", "lsd"] as const).map((key) => (
          <label className="settingsSummaryRow" key={key}>
            <span>{key.toUpperCase()}</span>
            <input
              type="checkbox"
              checked={desired.discovery[key]}
              onChange={(event) => patchGroup("discovery", key, event.target.checked)}
              disabled={!online || loading}
            />
          </label>
        ))}
        <label className="settingsSummaryRow">
          <span>Strict interface binding</span>
          <input
            type="checkbox"
            checked={desired.strict_binding}
            onChange={(event) => patchEngine({ strict_binding: event.target.checked })}
            disabled={!online || loading}
          />
        </label>
      </div>

      <p className="settingsSummaryNote">
        {capabilities ? "Runtime" : "Effective policy"}:{" "}
        {(capabilities?.transports.tcp.enabled ?? effective.transports.tcp) ? "TCP" : "no TCP"},{" "}
        {(capabilities?.transports.utp.enabled ?? effective.transports.utp) ? "uTP" : "no uTP"},{" "}
        {(capabilities?.transports.ipv4.enabled ?? effective.transports.ipv4) ? "IPv4" : "no IPv4"},{" "}
        {(capabilities?.transports.ipv6.enabled ?? effective.transports.ipv6) ? "IPv6" : "no IPv6"}; discovery{" "}
        {(capabilities?.discovery.dht.enabled ?? effective.discovery.dht) ? "DHT " : ""}
        {(capabilities?.discovery.pex.enabled ?? effective.discovery.pex) ? "PEX " : ""}
        {(capabilities?.discovery.lsd.enabled ?? effective.discovery.lsd) ? "LSD" : ""}.
      </p>

      {capabilities && (
        <div className="settingsSummaryRows">
          <div className="settingsSummaryRow">
            <span>Runtime network</span>
            <span className={`settingsSummaryBadge ${capabilities.network_suspended ? "warn" : "ok"}`}>
              {capabilities.network_suspended ? "Suspended" : "Active"}
            </span>
          </div>
          <div className="settingsSummaryRow">
            <span>Persistence</span>
            <span className={`settingsSummaryBadge ${capabilities.persistence_enabled ? "ok" : "muted"}`}>
              {capabilities.persistence_enabled ? "Enabled" : "Memory only"}
            </span>
          </div>
          <div className="settingsSummaryRow">
            <span>Lineage</span>
            <span className="settingsSummaryValue">{capabilities.lineage}</span>
          </div>
          {capabilities.degraded_reasons.map((reason) => (
            <div className="warning warn" key={reason}>
              {reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

EngineSettings.displayName = "EngineSettings";
