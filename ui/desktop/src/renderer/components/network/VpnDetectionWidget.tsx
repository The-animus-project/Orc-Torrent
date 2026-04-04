import React, { memo, useEffect, useRef, useState } from "react";
import type { VpnStatus, ConnectionType } from "../../types";

interface VpnDetectionWidgetProps {
  vpnStatus: VpnStatus | null;
  netifs: string[];
  onKillSwitchToggle?: () => void;
}

export const VpnDetectionWidget = memo<VpnDetectionWidgetProps>(({
  vpnStatus,
  netifs,
  onKillSwitchToggle,
}) => {
  // Use posture for more accurate detection, fallback to detected for legacy support
  const posture = vpnStatus?.posture || "unknown";
  const isConnected = posture === "connected" || vpnStatus?.detected === true;
  const interfaceName = vpnStatus?.interface || vpnStatus?.interfaceName || null;
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

  const handleClick = () => {
    if (onKillSwitchToggle) {
      onKillSwitchToggle();
    }
  };

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

  const connectionType = vpnStatus?.connection_type ?? "non_vpn";
  const connTypeLabel = getConnectionTypeLabel(connectionType);

  // Determine status text based on posture
  const getStatusText = () => {
    switch (posture) {
      case "connected":
        return `${connTypeLabel.toUpperCase()}: ACTIVE`;
      case "disconnected":
        return "INACTIVE";
      case "checking":
        return "CHECKING...";
      case "unknown":
      default:
        return "UNKNOWN";
    }
  };

  return (
    <div 
      className={`networkWidget ${onKillSwitchToggle ? "clickable" : ""}`}
      onClick={onKillSwitchToggle ? handleClick : undefined}
      title={onKillSwitchToggle ? "Click to configure kill switch" : undefined}
    >
      <div className="networkWidgetTitle">VPN Detection</div>
      <div className="networkWidgetContent">
        <div className="networkWidgetStatus">
          <span className={`statusIndicator ${isConnected ? "vpnConnected" : "vpnDisconnected"} ${statusChanged ? "statusChanged" : ""}`} />
          <span className="networkWidgetStatusText">
            {getStatusText()}
          </span>
        </div>
        {isConnected && (
          <>
            <div className="networkWidgetDetail">
              <span className="networkWidgetLabel">Connection Type:</span>
              <span className="networkWidgetValue">{connTypeLabel}</span>
            </div>
            {interfaceName && (
              <div className="networkWidgetDetail">
                <span className="networkWidgetLabel">Interface:</span>
                <span className="networkWidgetValue">{interfaceName}</span>
              </div>
            )}
            {vpnStatus?.public_ip && (
              <div className="networkWidgetDetail">
                <span className="networkWidgetLabel">Public IP:</span>
                <span className="networkWidgetValue">{vpnStatus.public_ip}</span>
              </div>
            )}
            {!interfaceName && (
              <div className="networkWidgetDetail">
                <span className="networkWidgetNote">Interface detection unavailable</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

VpnDetectionWidget.displayName = "VpnDetectionWidget";
