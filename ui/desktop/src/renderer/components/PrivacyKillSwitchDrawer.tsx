import React, { memo, useState, useCallback, useEffect, useRef } from "react";
import type { KillSwitchConfig, VpnStatus, KillSwitchScope } from "../types";
import { getJson, patchJson, postJson } from "../utils/api";

interface PrivacyKillSwitchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  vpnStatus: VpnStatus | null;
  killSwitch: KillSwitchConfig | null;
  online: boolean;
  onUpdate: () => void;
  onRefreshVpn?: () => Promise<void>;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const PrivacyKillSwitchDrawer = memo<PrivacyKillSwitchDrawerProps>(
  ({ isOpen, onClose, vpnStatus, killSwitch, online, onUpdate, onRefreshVpn, onError, onSuccess }) => {
    const [config, setConfig] = useState<KillSwitchConfig | null>(killSwitch);
    const [loading, setLoading] = useState(false);
    const [showEmergencyConfirm, setShowEmergencyConfirm] = useState(false);
    const [testResult, setTestResult] = useState<any>(null);
    const dirtyRef = useRef(false);

    // Sync with prop changes and fetch directly when the drawer opens.
    useEffect(() => {
      if (!killSwitch || dirtyRef.current) return;
      setConfig(killSwitch);
    }, [killSwitch]);

    useEffect(() => {
      if (!isOpen || !online || killSwitch) return;
      let active = true;
      void getJson<KillSwitchConfig>("/net/kill-switch")
        .then((ks) => {
          if (active) {
            setConfig(ks);
          }
        })
        .catch(() => {
          // Parent polling will retry; keep the loading state until then.
        });
      return () => {
        active = false;
      };
    }, [isOpen, online, killSwitch]);

    const handleKillSwitchToggle = useCallback(
      async (enabled: boolean) => {
        if (!online || !config) return;
        try {
          setLoading(true);
          await patchJson("/net/kill-switch", { enabled });
          // Immediately refresh VPN status after toggling kill switch
          if (onRefreshVpn) {
            await onRefreshVpn();
          }
          onUpdate();
          onSuccess(`VPN transfer pause ${enabled ? "enabled" : "disabled"}`);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to update VPN transfer pause";
          onError(message);
        } finally {
          setLoading(false);
        }
      },
      [online, config, onUpdate, onRefreshVpn, onError, onSuccess]
    );

    const handleScopeChange = useCallback(
      async (scope: KillSwitchScope) => {
        if (!online || !config) return;
        try {
          setLoading(true);
          await patchJson("/net/kill-switch", { scope });
          onUpdate();
          onSuccess("VPN transfer-pause scope updated");
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to update scope";
          onError(message);
        } finally {
          setLoading(false);
        }
      },
      [online, config, onUpdate, onError, onSuccess]
    );

    const handleApply = useCallback(async () => {
      if (!online || !config) return;
      try {
        setLoading(true);
        await patchJson("/net/kill-switch", {
          vpn_source: config.vpn_source,
          grace_period_sec: config.grace_period_sec,
          triggers: config.triggers,
        });
        dirtyRef.current = false;
        onUpdate();
        onSuccess("VPN transfer-pause configuration updated");
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to update configuration";
        onError(message);
      } finally {
        setLoading(false);
      }
    }, [online, config, onUpdate, onError, onSuccess]);

    const handleTriggerChange = useCallback(
      async (key: keyof KillSwitchConfig["triggers"], checked: boolean) => {
        if (!online || !config) return;
        const previous = config.triggers;
        const nextTriggers = { ...config.triggers, [key]: checked };
        dirtyRef.current = true;
        setConfig({ ...config, triggers: nextTriggers });
        try {
          setLoading(true);
          await patchJson("/net/kill-switch", { triggers: nextTriggers });
          dirtyRef.current = false;
          onUpdate();
          onSuccess("VPN transfer-pause triggers updated");
        } catch (e: unknown) {
          dirtyRef.current = false;
          setConfig((current) => (current ? { ...current, triggers: previous } : current));
          const message = e instanceof Error ? e.message : "Failed to update triggers";
          onError(message);
        } finally {
          setLoading(false);
        }
      },
      [online, config, onUpdate, onError, onSuccess]
    );

    const handleTest = useCallback(async () => {
      if (!online) return;
      try {
        const result = await postJson("/net/kill-switch/test", {});
        setTestResult(result);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to test VPN transfer pause";
        onError(message);
      }
    }, [online, onError]);

    const handleEmergencyUnlock = useCallback(async () => {
      if (!online || !config) return;
      try {
        setLoading(true);
        await patchJson("/net/kill-switch", { enabled: false });
        onUpdate();
        onSuccess("VPN transfer pause disabled (emergency unlock)");
        setShowEmergencyConfirm(false);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to disable VPN transfer pause";
        onError(message);
      } finally {
        setLoading(false);
      }
    }, [online, config, onUpdate, onError, onSuccess]);

    if (!isOpen) return null;

    if (!config) {
      return (
        <div className="drawerBackdrop" onClick={onClose}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawerHeader">
              <h2>Privacy & VPN Transfer Pause</h2>
              <button className="drawerClose" onClick={onClose}>
                ×
              </button>
            </div>
            <div className="drawerContent">
              <p>Loading configuration...</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="drawerBackdrop" onClick={onClose}>
        <div className="drawer" onClick={(e) => e.stopPropagation()}>
          <div className="drawerHeader">
            <h2>Privacy & VPN Transfer Pause</h2>
            <button className="drawerClose" onClick={onClose}>
              ×
            </button>
          </div>
          <div className="drawerContent">
            {/* Application-level VPN transfer pause. This is not an OS firewall. */}
            <div className="drawerSection">
              <div className="drawerSectionTitle">Pause transfers when VPN disconnects</div>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => handleKillSwitchToggle(e.target.checked)}
                  disabled={!online || loading}
                />
                <span className="slider" />
                <span className="tText">{config.enabled ? "ENABLED" : "DISABLED"}</span>
              </label>
              <div className="drawerNote">
                Application-level protection: ORC closes its transfer and discovery sockets after the grace period. It
                is not an operating-system firewall and cannot block other applications.
              </div>
            </div>

            {config.enabled && (
              <>
                {/* Scope Selector */}
                <div className="drawerSection">
                  <div className="drawerSectionTitle">Scope</div>
                  <label className="radio">
                    <input
                      type="radio"
                      name="scope"
                      value="torrent_only"
                      checked={config.scope === "torrent_only"}
                      onChange={() => handleScopeChange("torrent_only")}
                      disabled={!online || loading}
                    />
                    <span>Torrent-only (recommended)</span>
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="scope"
                      value="app_level"
                      checked={config.scope === "app_level"}
                      onChange={() => handleScopeChange("app_level")}
                      disabled
                    />
                    <span>App-level firewall block (unsupported)</span>
                    <span className="drawerNote">
                      {config.outbound_block_disabled_reason ?? "No platform firewall integration is installed"}
                    </span>
                  </label>
                </div>

                {/* When Triggered */}
                <div className="drawerSection">
                  <div className="drawerSectionTitle">When Triggered</div>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={config.triggers.pause_all_torrents}
                      onChange={(e) => void handleTriggerChange("pause_all_torrents", e.target.checked)}
                      disabled={!online || loading}
                    />
                    <span>Pause all torrents</span>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={config.triggers.stop_seeding}
                      onChange={(e) => void handleTriggerChange("stop_seeding", e.target.checked)}
                      disabled={!online || loading}
                    />
                    <span>Stop seeding</span>
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={config.triggers.disable_dht_pex_lpd}
                      onChange={(e) => void handleTriggerChange("disable_dht_pex_lpd", e.target.checked)}
                      disabled
                      title="Required: engine discovery sockets close whenever the kill switch engages"
                    />
                    <span>Disable DHT/PEX/LSD (required)</span>
                  </label>
                  {config.scope === "app_level" && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={config.triggers.block_outbound}
                        onChange={(e) => void handleTriggerChange("block_outbound", e.target.checked)}
                        disabled
                        title={config.outbound_block_disabled_reason ?? "OS-wide outbound blocking is unsupported"}
                      />
                      <span>Block outbound (unsupported)</span>
                    </label>
                  )}
                </div>

                {/* VPN Source */}
                <div className="drawerSection">
                  <div className="drawerSectionTitle">VPN Source</div>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={config.vpn_source.auto_detect}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          vpn_source: { ...config.vpn_source, auto_detect: e.target.checked },
                        })
                      }
                      disabled={!online || loading}
                    />
                    <span className="slider" />
                    <span className="tText">Auto-detect (recommended)</span>
                  </label>
                  {!config.vpn_source.auto_detect && (
                    <div className="drawerSubSection">
                      <div className="drawerSectionTitle">Allowlist Adapters</div>
                      {["Wintun", "TAP", "Tailscale", "WireGuard", "OpenVPN"].map((adapter) => (
                        <label key={adapter} className="checkbox">
                          <input
                            type="checkbox"
                            checked={config.vpn_source.allowed_adapters.includes(adapter)}
                            onChange={(e) => {
                              const adapters = e.target.checked
                                ? [...config.vpn_source.allowed_adapters, adapter]
                                : config.vpn_source.allowed_adapters.filter((a) => a !== adapter);
                              setConfig({
                                ...config,
                                vpn_source: { ...config.vpn_source, allowed_adapters: adapters },
                              });
                            }}
                            disabled={!online || loading}
                          />
                          <span>{adapter}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Grace Period */}
                <div className="drawerSection">
                  <div className="drawerSectionTitle">Grace Period: {config.grace_period_sec} seconds</div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={config.grace_period_sec}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        grace_period_sec: parseInt(e.target.value, 10),
                      })
                    }
                    disabled={!online || loading}
                    className="sliderRange"
                  />
                  <div className="drawerNote">Trigger after X seconds disconnected</div>
                </div>

                {/* Test & Emergency */}
                <div className="drawerSection">
                  <div className="drawerSectionTitle">Controls</div>
                  <button className="btn" onClick={handleTest} disabled={!online || loading}>
                    Simulate VPN Drop
                  </button>
                  {testResult && (
                    <div className="drawerTestResult">
                      <pre>{JSON.stringify(testResult, null, 2)}</pre>
                    </div>
                  )}
                  <button
                    className="btn danger"
                    onClick={() => setShowEmergencyConfirm(true)}
                    disabled={!online || loading || !config.enabled}
                    style={{ marginTop: "12px" }}
                  >
                    Emergency Unlock
                  </button>
                </div>

                {/* Audit */}
                {config.last_enforcement_ms && (
                  <div className="drawerSection">
                    <div className="drawerSectionTitle">Last Enforcement</div>
                    <div className="drawerAudit">
                      <div>Timestamp: {new Date(config.last_enforcement_ms).toLocaleString()}</div>
                      <div>State: {config.enforcement_state}</div>
                    </div>
                  </div>
                )}

                {/* Apply Button */}
                <div className="drawerActions">
                  <button className="btn primary" onClick={handleApply} disabled={!online || loading}>
                    {loading ? "APPLYING..." : "APPLY"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Emergency Unlock Confirmation */}
        {showEmergencyConfirm && (
          <div className="modalOverlay" onClick={() => setShowEmergencyConfirm(false)}>
            <div className="modalContent" onClick={(e) => e.stopPropagation()}>
              <div className="modalHeader">
                <div className="modalTitle">Emergency Unlock</div>
                <button className="modalClose" onClick={() => setShowEmergencyConfirm(false)}>
                  ×
                </button>
              </div>
              <div className="modalBody">
                <p>Disable automatic transfer pausing? This bypasses the configured grace period.</p>
              </div>
              <div className="modalActions">
                <button className="btn" onClick={() => setShowEmergencyConfirm(false)}>
                  Cancel
                </button>
                <button className="btn danger" onClick={handleEmergencyUnlock}>
                  Disable Kill Switch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
);

PrivacyKillSwitchDrawer.displayName = "PrivacyKillSwitchDrawer";
