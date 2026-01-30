import React, { memo, useEffect, useRef, useState } from "react";
import type { VpnStatus, KillSwitchState, ConnectionType } from "../types";

interface VpnStatusLedProps {
  vpnStatus: VpnStatus | null;
  killSwitchState: KillSwitchState;
  onClick: () => void;
}

export const VpnStatusLed = memo<VpnStatusLedProps>(({
  vpnStatus,
  killSwitchState,
  onClick,
}) => {
  const posture = vpnStatus?.posture ?? "unknown";
  const connectionType = vpnStatus?.connection_type ?? "non_vpn";
  const prevPostureRef = useRef<string>(posture);
  const [statusChanged, setStatusChanged] = useState(false);

  // Detect status changes and trigger flash animation
  useEffect(() => {
    if (prevPostureRef.current !== posture) {
      setStatusChanged(true);
      const timer = setTimeout(() => setStatusChanged(false), 500);
      prevPostureRef.current = posture;
      return () => clearTimeout(timer);
    }
  }, [posture]);

  // Get connection type display string
  const getConnectionTypeLabel = (type: ConnectionType): string => {
    switch (type) {
      case "vpn": return "VPN";
      case "tor": return "Tor";
      case "i2p": return "I2P";
      case "non_vpn": return "Direct";
      default: return "Unknown";
    }
  };
  
  // Determine LED state
  let ledClass = "vpnLed";
  let ledState: "connected" | "disconnected" | "unknown" | "checking" | "disabled" = "disabled";
  let label = "VPN: Unknown";
  let tooltip = "VPN status unknown";

  if (!vpnStatus) {
    ledState = "disabled";
    label = "VPN: Disabled";
    tooltip = "VPN detection is disabled";
  } else {
    switch (posture) {
      case "connected":
        ledState = "connected";
        const connTypeLabel = getConnectionTypeLabel(connectionType);
        label = `${connTypeLabel}: Connected`;
        tooltip = `${connTypeLabel} connected`;
        if (vpnStatus.interface) {
          tooltip += ` via ${vpnStatus.interface}`;
        }
        if (vpnStatus.default_route_interface) {
          tooltip += `\nDefault route: ${vpnStatus.default_route_interface}`;
        }
        if (vpnStatus.public_ip) {
          tooltip += `\nPublic IP: ${vpnStatus.public_ip}`;
        }
        if (killSwitchState === "armed") {
          tooltip += "\nKill switch: ARMED";
        }
        break;
      case "disconnected":
        ledState = "disconnected";
        label = "VPN: Disconnected";
        tooltip = "VPN is not connected";
        if (killSwitchState === "engaged") {
          tooltip += "\nKill switch: ENGAGED (enforcement active)";
        }
        break;
      case "unknown":
        ledState = "unknown";
        label = "VPN: Unknown";
        tooltip = "VPN status is ambiguous (signals disagree)";
        break;
      case "checking":
        ledState = "checking";
        label = "VPN: Checking";
        tooltip = "Detecting VPN status...";
        break;
    }
    
    if (vpnStatus.last_check_ms) {
      const lastCheck = new Date(vpnStatus.last_check_ms);
      tooltip += `\nLast check: ${lastCheck.toLocaleTimeString()}`;
    }
  }

  ledClass += ` vpnLed${ledState.charAt(0).toUpperCase() + ledState.slice(1)}`;

  return (
    <div
      className={ledClass}
      onClick={onClick}
      title={tooltip}
      style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}
    >
      <span className={`vpnLedIndicator ${statusChanged ? "statusChanged" : ""}`} />
      <span className="vpnLedLabel">{label}</span>
    </div>
  );
});

VpnStatusLed.displayName = "VpnStatusLed";
