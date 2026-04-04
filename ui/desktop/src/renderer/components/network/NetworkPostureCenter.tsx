import React, { memo, useRef } from "react";
import type { NetPosture, VpnStatus } from "../../types";
import { VpnDetectionWidget } from "./VpnDetectionWidget";
import { BindInterfaceControl } from "./BindInterfaceControl";
import { LeakProofIndicator } from "./LeakProofIndicator";
import { KillSwitchPanel } from "./KillSwitchPanel";
import { ConnectionPolicyToggles } from "./ConnectionPolicyToggles";
import { ThreatModelPresets } from "./ThreatModelPresets";
import { patchJson } from "../../utils/api";

interface NetworkPostureCenterProps {
  netPosture: NetPosture | null;
  netifs: string[];
  vpnStatus: VpnStatus | null;
  online: boolean;
  onUpdate: () => void;
  onRefreshVpn?: () => Promise<void>;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
  onBack?: () => void;
}

export const NetworkPostureCenter = memo<NetworkPostureCenterProps>(({
  netPosture,
  netifs,
  vpnStatus,
  online,
  onUpdate,
  onRefreshVpn,
  onError,
  onSuccess,
  onBack,
}) => {
  const killSwitchPanelRef = useRef<HTMLDivElement>(null);

  const handleVpnWidgetClick = async () => {
    if (!online) {
      onError("Cannot configure kill switch: daemon not connected");
      return;
    }

    try {
      const currentEnabled = netPosture?.leak_proof_enabled ?? false;
      const newEnabled = !currentEnabled;
      
      await patchJson<NetPosture>("/net/posture", {
        leak_proof_enabled: newEnabled,
        bind_interface: netPosture?.bind_interface ?? null,
      });
      
      // Immediately refresh VPN status after toggling kill switch
      if (onRefreshVpn) {
        await onRefreshVpn();
      }
      
      onUpdate();
      onSuccess(`Kill switch ${newEnabled ? "enabled" : "disabled"}`);
      
      // Scroll to kill switch panel if enabled
      if (newEnabled && killSwitchPanelRef.current) {
        setTimeout(() => {
          killSwitchPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }, 100);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to toggle kill switch";
      onError(message);
    }
  };

  return (
    <div className="networkPostureCenter">
      <div className="networkPostureCenterHeader">
        {onBack && (
          <button
            className="btn ghost"
            onClick={onBack}
            title="Back to Main Menu"
            style={{ marginRight: "12px", fontSize: "12px", padding: "4px 8px" }}
          >
            ← Back to Torrents
          </button>
        )}
        <div className="networkPostureCenterTitle">Network Posture Security Center</div>
        <div className={`networkPostureCenterStatus ${netPosture?.state ?? "unconfigured"}`}>
          {netPosture?.state === "protected" ? "PROTECTED" : 
           netPosture?.state === "leak_risk" ? "LEAK RISK" : 
           "UNCONFIGURED"}
        </div>
      </div>
      <div className="networkPostureCenterContent">
        <VpnDetectionWidget
          vpnStatus={vpnStatus}
          netifs={netifs}
          onKillSwitchToggle={handleVpnWidgetClick}
        />
        <BindInterfaceControl
          netPosture={netPosture}
          netifs={netifs}
          vpnStatus={vpnStatus}
          online={online}
          onUpdate={onUpdate}
          onError={onError}
          onSuccess={onSuccess}
        />
        <LeakProofIndicator
          netPosture={netPosture}
        />
        <div ref={killSwitchPanelRef}>
          <KillSwitchPanel
            netPosture={netPosture}
            online={online}
            onUpdate={onUpdate}
            onRefreshVpn={onRefreshVpn}
            onError={onError}
            onSuccess={onSuccess}
          />
        </div>
        <ConnectionPolicyToggles
          online={online}
          onUpdate={onUpdate}
          onError={onError}
          onSuccess={onSuccess}
        />
        <ThreatModelPresets
          online={online}
          onUpdate={onUpdate}
          onError={onError}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  );
});

NetworkPostureCenter.displayName = "NetworkPostureCenter";
