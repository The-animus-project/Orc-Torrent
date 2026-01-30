import React, { memo, useCallback, useState } from "react";
import type { PolicyState, DesiredPolicy } from "../types/policy";
import { usePolicy } from "../utils/usePolicy";

interface SecuritySettingsProps {
  online: boolean;
  onError?: (msg: string) => void;
  onSuccess?: (msg: string) => void;
}

export const SecuritySettings = memo<SecuritySettingsProps>(({
  online,
  onError,
  onSuccess,
}) => {
  const { state, error, loading, update, applyProfile } = usePolicy(online);
  const [activePanel, setActivePanel] = useState<"network" | "privacy" | "resistance">("network");

  const handleToggle = useCallback(async (key: keyof DesiredPolicy, value: any) => {
    if (!state) return;
    try {
      const updated = await update({ [key]: value });
      if (updated && onSuccess) {
        onSuccess("Policy updated");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to update policy";
      if (onError) onError(msg);
    }
  }, [state, update, onError, onSuccess]);

  const handleProfileChange = useCallback(async (profile: "standard" | "hardened" | "anonymous") => {
    try {
      await applyProfile(profile);
      if (onSuccess) onSuccess(`Applied ${profile} profile`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to apply profile";
      if (onError) onError(msg);
    }
  }, [applyProfile, onError, onSuccess]);

  if (!state) {
    return (
      <div className="securitySettings">
        <div className="securitySettingsLoading">
          {error ? `Error: ${error}` : "Loading policy..."}
        </div>
      </div>
    );
  }

  const { desired, effective, warnings, disabled } = state;

  const isDisabled = (key: string): boolean => {
    return disabled[key as keyof DesiredPolicy]?.disabled ?? false;
  };

  const getDisabledReason = (key: string): string | undefined => {
    return disabled[key as keyof DesiredPolicy]?.reason;
  };

  const isOverridden = (key: keyof DesiredPolicy): boolean => {
    const desiredVal = desired[key];
    // EffectivePolicy flattens desired fields at top level
    const effectiveVal = effective[key as keyof typeof effective];
    if (effectiveVal === undefined) return false;
    return JSON.stringify(desiredVal) !== JSON.stringify(effectiveVal);
  };

  return (
    <div className="securitySettings">
      {/* Profile Selection */}
      <div className="securitySettingsProfiles">
        <div className="securitySettingsSectionTitle">Security Profiles</div>
        <div className="profileButtons">
          <button
            className={`btn ${desired.profile === "standard" ? "primary" : ""}`}
            onClick={() => handleProfileChange("standard")}
            disabled={!online || loading}
            title="Maximum Speed: Direct connections, no encryption overhead, best download performance"
          >
            Standard
            {desired.profile === "standard" && (
              <span style={{ marginLeft: "8px", fontSize: "11px", opacity: 0.8 }}>⚡ Best Speed</span>
            )}
          </button>
          <button
            className={`btn ${desired.profile === "hardened" ? "primary" : ""}`}
            onClick={() => handleProfileChange("hardened")}
            disabled={!online || loading}
            title="Balanced: Encrypted connections with IP blocklist, moderate speed"
          >
            Hardened
          </button>
          <button
            className={`btn ${desired.profile === "anonymous" ? "primary" : ""}`}
            onClick={() => handleProfileChange("anonymous")}
            disabled={!online || loading}
            title="Maximum Privacy: All traffic through overlay network, slower speeds"
          >
            Anonymous
          </button>
        </div>
        {desired.profile === "standard" && (
          <div style={{ 
            marginTop: "8px", 
            padding: "10px 12px", 
            backgroundColor: "rgba(76, 175, 80, 0.15)", 
            borderRadius: "4px",
            fontSize: "12px",
            color: "var(--text-primary)",
            border: "1px solid rgba(76, 175, 80, 0.3)"
          }}>
            <strong>✓ Optimized for Speed:</strong> Anonymous mode is OFF. Direct peer connections enabled for maximum download performance.
          </div>
        )}
        {desired.profile === "anonymous" && (
          <div style={{ 
            marginTop: "8px", 
            padding: "10px 12px", 
            backgroundColor: "rgba(255, 152, 0, 0.15)", 
            borderRadius: "4px",
            fontSize: "12px",
            color: "var(--text-primary)",
            border: "1px solid rgba(255, 152, 0, 0.3)"
          }}>
            <strong>⚠ Privacy Mode Active:</strong> Anonymous mode is ON. Download speeds may be reduced due to overlay network routing. 
            <button 
              onClick={() => handleProfileChange("standard")}
              disabled={!online || loading}
              style={{
                marginLeft: "8px",
                padding: "2px 8px",
                fontSize: "11px",
                backgroundColor: "rgba(33, 150, 243, 0.2)",
                border: "1px solid rgba(33, 150, 243, 0.4)",
                borderRadius: "3px",
                cursor: (!online || loading) ? "not-allowed" : "pointer",
                color: "var(--text-primary)"
              }}
            >
              Switch to Standard for Speed
            </button>
          </div>
        )}
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="securitySettingsWarnings">
          {warnings.map((warning, idx) => (
            <div key={idx} className={`warning ${warning.severity}`}>
              <strong>{warning.code}:</strong> {warning.message}
            </div>
          ))}
        </div>
      )}

      {/* Panel Tabs */}
      <div className="securitySettingsTabs">
        <button
          className={`tab ${activePanel === "network" ? "active" : ""}`}
          onClick={() => setActivePanel("network")}
        >
          Network Safety
        </button>
        <button
          className={`tab ${activePanel === "privacy" ? "active" : ""}`}
          onClick={() => setActivePanel("privacy")}
        >
          Privacy & Encryption
        </button>
        <button
          className={`tab ${activePanel === "resistance" ? "active" : ""}`}
          onClick={() => setActivePanel("resistance")}
        >
          Attack Resistance
        </button>
      </div>

      {/* Panel A: Network Safety */}
      {activePanel === "network" && (
        <div className="securitySettingsPanel">
          <PolicyToggle
            label="Kill Switch"
            value={desired.kill_switch}
            effective={effective.kill_switch}
            disabled={isDisabled("kill_switch")}
            disabledReason={getDisabledReason("kill_switch")}
            overridden={isOverridden("kill_switch")}
            onChange={(val) => handleToggle("kill_switch", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="Bind to Interface Only"
            value={desired.bind_interface_only}
            effective={effective.bind_interface_only}
            disabled={isDisabled("bind_interface_only")}
            disabledReason={getDisabledReason("bind_interface_only")}
            overridden={isOverridden("bind_interface_only")}
            onChange={(val) => handleToggle("bind_interface_only", val)}
            online={online}
            loading={loading}
          />
        </div>
      )}

      {/* Panel B: Privacy & Encryption */}
      {activePanel === "privacy" && (
        <div className="securitySettingsPanel">
          <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "rgba(33, 150, 243, 0.1)", borderRadius: "4px" }}>
            <div style={{ fontWeight: "600", marginBottom: "4px", fontSize: "13px" }}>
              💡 For Best Download Speeds:
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: "1.5" }}>
              Turn OFF Anonymous Mode and use Standard profile above. This enables direct peer connections with maximum performance.
            </div>
          </div>
          <PolicyToggle
            label="Anonymous Mode"
            value={desired.anonymous_mode}
            effective={effective.anonymous_mode}
            disabled={isDisabled("anonymous_mode")}
            disabledReason={getDisabledReason("anonymous_mode")}
            overridden={isOverridden("anonymous_mode")}
            onChange={(val) => {
              handleToggle("anonymous_mode", val);
              // If turning off anonymous mode, suggest switching to standard profile
              if (!val && desired.profile !== "standard") {
                setTimeout(() => {
                  if (onSuccess) {
                    onSuccess("Anonymous mode disabled. Consider switching to Standard profile for best speeds.");
                  }
                }, 500);
              }
            }}
            online={online}
            loading={loading}
          />
          {desired.anonymous_mode && (
            <div style={{ 
              marginTop: "8px", 
              padding: "8px 12px", 
              backgroundColor: "rgba(255, 152, 0, 0.1)", 
              borderRadius: "4px",
              fontSize: "12px",
              color: "var(--text-secondary)"
            }}>
              ⚠ Anonymous mode is ON. This routes traffic through overlay network and may reduce download speeds.
            </div>
          )}
          <TriStateToggle
            label="Peer Protocol Encryption"
            value={desired.peer_encryption}
            effective={effective.peer_encryption}
            disabled={isDisabled("peer_encryption")}
            disabledReason={getDisabledReason("peer_encryption")}
            overridden={isOverridden("peer_encryption")}
            onChange={(val) => handleToggle("peer_encryption", val)}
            online={online}
            loading={loading}
          />
          <PaddingToggle
            label="Overlay Padding"
            value={desired.overlay_padding}
            effective={effective.overlay_padding}
            disabled={isDisabled("overlay_padding")}
            disabledReason={getDisabledReason("overlay_padding")}
            overridden={isOverridden("overlay_padding")}
            onChange={(val) => handleToggle("overlay_padding", val)}
            online={online}
            loading={loading}
          />
        </div>
      )}

      {/* Panel C: Attack Resistance */}
      {activePanel === "resistance" && (
        <div className="securitySettingsPanel">
          <PolicyToggle
            label="DHT Hardening"
            value={desired.dht_hardening}
            effective={effective.dht_hardening}
            disabled={isDisabled("dht_hardening")}
            disabledReason={getDisabledReason("dht_hardening")}
            overridden={isOverridden("dht_hardening")}
            onChange={(val) => handleToggle("dht_hardening", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="IP Blocklist"
            value={desired.ip_blocklist}
            effective={effective.ip_blocklist}
            disabled={isDisabled("ip_blocklist")}
            disabledReason={getDisabledReason("ip_blocklist")}
            overridden={isOverridden("ip_blocklist")}
            onChange={(val) => handleToggle("ip_blocklist", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="Sybil-Resistant Relay Selection"
            value={desired.sybil_resistance}
            effective={effective.sybil_resistance}
            disabled={isDisabled("sybil_resistance")}
            disabledReason={getDisabledReason("sybil_resistance")}
            overridden={isOverridden("sybil_resistance")}
            onChange={(val) => handleToggle("sybil_resistance", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="PoW Required"
            value={desired.relay_pow_required}
            effective={effective.relay_pow_required}
            disabled={isDisabled("relay_pow_required")}
            disabledReason={getDisabledReason("relay_pow_required")}
            overridden={isOverridden("relay_pow_required")}
            onChange={(val) => handleToggle("relay_pow_required", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="Subnet Diversity"
            value={desired.relay_subnet_diversity}
            effective={effective.relay_subnet_diversity}
            disabled={isDisabled("relay_subnet_diversity")}
            disabledReason={getDisabledReason("relay_subnet_diversity")}
            overridden={isOverridden("relay_subnet_diversity")}
            onChange={(val) => handleToggle("relay_subnet_diversity", val)}
            online={online}
            loading={loading}
          />
          <PolicyToggle
            label="Reputation Weighting"
            value={desired.relay_reputation_weighting}
            effective={effective.relay_reputation_weighting}
            disabled={isDisabled("relay_reputation_weighting")}
            disabledReason={getDisabledReason("relay_reputation_weighting")}
            overridden={isOverridden("relay_reputation_weighting")}
            onChange={(val) => handleToggle("relay_reputation_weighting", val)}
            online={online}
            loading={loading}
          />
        </div>
      )}
    </div>
  );
});

SecuritySettings.displayName = "SecuritySettings";

// Toggle component
const PolicyToggle = memo<{
  label: string;
  value: boolean;
  effective: boolean;
  disabled: boolean;
  disabledReason?: string;
  overridden: boolean;
  onChange: (value: boolean) => void;
  online: boolean;
  loading: boolean;
}>(({ label, value, effective, disabled, disabledReason, overridden, onChange, online, loading }) => {
  return (
    <div className="policyToggle">
      <div className="policyToggleHeader">
        <label className="policyToggleLabel">{label}</label>
        {overridden && <span className="policyBadge overridden">Overridden</span>}
        {effective !== value && <span className="policyBadge effective">Effective: {effective ? "On" : "Off"}</span>}
      </div>
      <label className="toggle">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          disabled={!online || loading || disabled}
        />
        <span className="slider" />
        <span className="tText">{value ? "On" : "Off"}</span>
      </label>
      {disabled && disabledReason && (
        <div className="policyToggleDisabledReason">{disabledReason}</div>
      )}
    </div>
  );
});

PolicyToggle.displayName = "PolicyToggle";

// Tri-state toggle
const TriStateToggle = memo<{
  label: string;
  value: "off" | "prefer" | "require";
  effective: "off" | "prefer" | "require";
  disabled: boolean;
  disabledReason?: string;
  overridden: boolean;
  onChange: (value: "off" | "prefer" | "require") => void;
  online: boolean;
  loading: boolean;
}>(({ label, value, effective, disabled, disabledReason, overridden, onChange, online, loading }) => {
  return (
    <div className="policyToggle">
      <div className="policyToggleHeader">
        <label className="policyToggleLabel">{label}</label>
        {overridden && <span className="policyBadge overridden">Overridden</span>}
      </div>
      <select
        className="triStateSelect"
        value={value}
        onChange={(e) => onChange(e.target.value as "off" | "prefer" | "require")}
        disabled={!online || loading || disabled}
      >
        <option value="off">Off</option>
        <option value="prefer">Prefer</option>
        <option value="require">Require</option>
      </select>
      {disabled && disabledReason && (
        <div className="policyToggleDisabledReason">{disabledReason}</div>
      )}
    </div>
  );
});

TriStateToggle.displayName = "TriStateToggle";

// Padding level toggle
const PaddingToggle = memo<{
  label: string;
  value: "off" | "low" | "high";
  effective: "off" | "low" | "high";
  disabled: boolean;
  disabledReason?: string;
  overridden: boolean;
  onChange: (value: "off" | "low" | "high") => void;
  online: boolean;
  loading: boolean;
}>(({ label, value, effective, disabled, disabledReason, overridden, onChange, online, loading }) => {
  return (
    <div className="policyToggle">
      <div className="policyToggleHeader">
        <label className="policyToggleLabel">{label}</label>
        {overridden && <span className="policyBadge overridden">Overridden</span>}
      </div>
      <select
        className="triStateSelect"
        value={value}
        onChange={(e) => onChange(e.target.value as "off" | "low" | "high")}
        disabled={!online || loading || disabled}
      >
        <option value="off">Off</option>
        <option value="low">Low</option>
        <option value="high">High</option>
      </select>
      {disabled && disabledReason && (
        <div className="policyToggleDisabledReason">{disabledReason}</div>
      )}
    </div>
  );
});

PaddingToggle.displayName = "PaddingToggle";
