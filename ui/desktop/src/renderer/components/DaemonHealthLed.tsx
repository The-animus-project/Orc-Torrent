import React, { memo } from "react";

export type DaemonHealthState = "healthy" | "warning" | "error" | "offline";

interface DaemonHealthLedProps {
  state: DaemonHealthState;
  onClick?: () => void;
  details?: string;
}

/**
 * LED indicator showing overall daemon health status
 * - Green (Healthy): Daemon running, no firewall issues, no errors
 * - Yellow (Warning): Daemon running but has firewall issues
 * - Red (Error): Daemon has errors or is offline
 */
export const DaemonHealthLed = memo<DaemonHealthLedProps>(({ state, onClick, details }) => {
  const getStateInfo = () => {
    switch (state) {
      case "healthy":
        return {
          label: "Connected",
          title: details || "Daemon healthy - All systems operational",
        };
      case "warning":
        return {
          label: "Limited",
          title: details || "Daemon running with warnings - Check firewall settings",
        };
      case "error":
        return {
          label: "Error",
          title: details || "Daemon error - Check connection",
        };
      case "offline":
      default:
        return {
          label: "Offline",
          title: details || "Daemon offline - Connecting...",
        };
    }
  };

  const stateInfo = getStateInfo();

  return (
    <div
      className={`daemonHealthLed daemonHealthLed${state.charAt(0).toUpperCase() + state.slice(1)}`}
      onClick={onClick}
      title={stateInfo.title}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <span className="daemonHealthLedIndicator" />
      <span className="daemonHealthLedLabel">{stateInfo.label}</span>
    </div>
  );
});

DaemonHealthLed.displayName = "DaemonHealthLed";
