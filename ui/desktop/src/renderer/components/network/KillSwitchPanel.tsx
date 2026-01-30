import React, { memo, useCallback, useState, useEffect } from "react";
import type { NetPosture } from "../../types";
import { patchJson } from "../../utils/api";

interface KillSwitchPanelProps {
  netPosture: NetPosture | null;
  online: boolean;
  onUpdate: () => void;
  onRefreshVpn?: () => Promise<void>;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type KillSwitchPolicy = "stop_all" | "stop_downloads" | "stop_seeding" | "disabled";

interface KillSwitchConfig {
  enabled: boolean;
  policy: KillSwitchPolicy;
  triggers: {
    vpnDown: boolean;
    ipChange: boolean;
    interfaceChange: boolean;
    dnsChange: boolean;
  };
}

export const KillSwitchPanel = memo<KillSwitchPanelProps>(({
  netPosture,
  online,
  onUpdate,
  onRefreshVpn,
  onError,
  onSuccess,
}) => {
  const [config, setConfig] = useState<KillSwitchConfig>({
    enabled: netPosture?.leak_proof_enabled ?? false,
    policy: "stop_all",
    triggers: {
      vpnDown: true,
      ipChange: true,
      interfaceChange: true,
      dnsChange: false,
    },
  });
  const [loading, setLoading] = useState(false);

  // Sync with netPosture prop changes
  useEffect(() => {
    setConfig(prev => ({
      ...prev,
      enabled: netPosture?.leak_proof_enabled ?? false,
    }));
  }, [netPosture?.leak_proof_enabled]);

  const handleApply = useCallback(async () => {
    if (!online || loading) return;
    try {
      setLoading(true);
      // Use the /net/posture endpoint to update leak_proof_enabled
      await patchJson<NetPosture>("/net/posture", {
        leak_proof_enabled: config.enabled,
        bind_interface: netPosture?.bind_interface ?? null,
      });
      onUpdate();
      onSuccess("Kill switch configuration updated");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update kill switch";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [config.enabled, netPosture?.bind_interface, online, loading, onUpdate, onError, onSuccess]);

  return (
    <div className="networkWidget">
      <div className="networkWidgetTitle">Kill Switch</div>
      <div className="networkWidgetContent">
        <label className="toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => {
              const newEnabled = e.target.checked;
              setConfig(prev => ({ ...prev, enabled: newEnabled }));
              // Auto-apply when toggling kill switch
              if (online && !loading) {
                setLoading(true);
                patchJson<NetPosture>("/net/posture", {
                  leak_proof_enabled: newEnabled,
                  bind_interface: netPosture?.bind_interface ?? null,
                }).then(async () => {
                  // Immediately refresh VPN status after toggling kill switch
                  if (onRefreshVpn) {
                    await onRefreshVpn();
                  }
                  onUpdate();
                  onSuccess(`Kill switch ${newEnabled ? "enabled" : "disabled"}`);
                }).catch((err: unknown) => {
                  const message = err instanceof Error ? err.message : "Failed to update kill switch";
                  onError(message);
                  // Revert on error
                  setConfig(prev => ({ ...prev, enabled: !newEnabled }));
                }).finally(() => {
                  setLoading(false);
                });
              } else if (!online) {
                // Revert if offline
                setConfig(prev => ({ ...prev, enabled: !newEnabled }));
              }
            }}
            disabled={!online || loading}
          />
          <span className="slider" />
          <span className="tText">{config.enabled ? "ENABLED" : "DISABLED"}</span>
        </label>
        {config.enabled && (
          <>
            <div className="networkWidgetSection">
              <div className="networkWidgetLabel">Policy:</div>
              <select
                className="select"
                value={config.policy}
                onChange={(e) => setConfig(prev => ({ ...prev, policy: e.target.value as KillSwitchPolicy }))}
                disabled={!online}
              >
                <option value="stop_all">Stop All</option>
                <option value="stop_downloads">Stop Downloads Only</option>
                <option value="stop_seeding">Stop Seeding Only</option>
              </select>
            </div>
            <div className="networkWidgetSection">
              <div className="networkWidgetLabel">Triggers:</div>
              <div className="networkWidgetTriggers">
                <label className="toggle small">
                  <input
                    type="checkbox"
                    checked={config.triggers.vpnDown}
                    onChange={(e) => setConfig(prev => ({ ...prev, triggers: { ...prev.triggers, vpnDown: e.target.checked } }))}
                    disabled={!online}
                  />
                  <span className="slider" />
                  <span className="tText">VPN Down</span>
                </label>
                <label className="toggle small">
                  <input
                    type="checkbox"
                    checked={config.triggers.ipChange}
                    onChange={(e) => setConfig(prev => ({ ...prev, triggers: { ...prev.triggers, ipChange: e.target.checked } }))}
                    disabled={!online}
                  />
                  <span className="slider" />
                  <span className="tText">IP Change</span>
                </label>
                <label className="toggle small">
                  <input
                    type="checkbox"
                    checked={config.triggers.interfaceChange}
                    onChange={(e) => setConfig(prev => ({ ...prev, triggers: { ...prev.triggers, interfaceChange: e.target.checked } }))}
                    disabled={!online}
                  />
                  <span className="slider" />
                  <span className="tText">Interface Change</span>
                </label>
                <label className="toggle small">
                  <input
                    type="checkbox"
                    checked={config.triggers.dnsChange}
                    onChange={(e) => setConfig(prev => ({ ...prev, triggers: { ...prev.triggers, dnsChange: e.target.checked } }))}
                    disabled={!online}
                  />
                  <span className="slider" />
                  <span className="tText">DNS Change</span>
                </label>
              </div>
            </div>
            <button
              className="btn"
              onClick={handleApply}
              disabled={!online || loading}
            >
              {loading ? "APPLYING..." : "APPLY"}
            </button>
          </>
        )}
      </div>
    </div>
  );
});

KillSwitchPanel.displayName = "KillSwitchPanel";
