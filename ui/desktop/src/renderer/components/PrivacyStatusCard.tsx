import React, { useCallback, useEffect, useState } from "react";
import type { PrivacyStatus } from "../types";
import { applyVpnSafetyPreset, getPrivacyStatus } from "../utils/privacyApi";

interface PrivacyStatusCardProps {
  online: boolean;
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  onStatusChange?: (status: PrivacyStatus | null) => void;
}

const RISK_LABELS: Record<PrivacyStatus["risk_state"], string> = {
  protected: "Protected",
  warning: "Warning",
  blocked: "Blocked",
  unknown: "Unknown",
};

export const PrivacyStatusCard: React.FC<PrivacyStatusCardProps> = ({ online, onSuccess, onError, onStatusChange }) => {
  const [status, setStatus] = useState<PrivacyStatus | null>(null);
  const [applying, setApplying] = useState(false);

  const refresh = useCallback(async () => {
    if (!online) return;
    try {
      const s = await getPrivacyStatus();
      setStatus(s);
      onStatusChange?.(s);
    } catch {
      setStatus(null);
      onStatusChange?.(null);
    }
  }, [online, onStatusChange]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleVpnSafety = async () => {
    setApplying(true);
    try {
      const result = await applyVpnSafetyPreset();
      setStatus(result.privacy_status);
      onStatusChange?.(result.privacy_status);
      const summary =
        result.changed.length > 0 ? `VPN Safety Mode: ${result.changed.join("; ")}` : "VPN Safety Mode already active";
      onSuccess?.(summary);
    } catch (e: unknown) {
      onError?.(e instanceof Error ? e.message : "Failed to apply VPN Safety Mode");
    } finally {
      setApplying(false);
    }
  };

  if (!status) {
    return (
      <div className="privacyStatusCard privacyStatusCardUnknown">
        <div className="privacyStatusCardHeader">
          <span className="privacyStatusBadge unknown">Unknown</span>
          <span className="privacyStatusReason">Privacy status unavailable</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`privacyStatusCard privacyStatusCard${status.risk_state}`}>
      <div className="privacyStatusCardHeader">
        <span className={`privacyStatusBadge ${status.risk_state}`}>{RISK_LABELS[status.risk_state]}</span>
        <span className="privacyStatusReason">{status.reason}</span>
      </div>
      <div className="privacyStatusDetails">
        <span>VPN: {status.vpn_detected ? "detected" : "not detected"}</span>
        <span>Kill switch: {status.kill_switch_enabled ? (status.kill_switch_engaged ? "engaged" : "on") : "off"}</span>
        {status.bind_interface && <span>Bind: {status.bind_interface}</span>}
      </div>
      <p className="privacyStatusDisclaimer">
        VPN and kill switch reduce accidental leaks; they do not provide anonymity.
      </p>
      <div className="privacyStatusActions">
        <button
          type="button"
          className="btn small primary"
          onClick={() => void handleVpnSafety()}
          disabled={!online || applying}
        >
          {applying ? "Applying…" : "VPN Safety Mode"}
        </button>
      </div>
    </div>
  );
};
