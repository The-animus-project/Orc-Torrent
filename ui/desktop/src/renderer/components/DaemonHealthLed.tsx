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
          color: "#4caf50", // Green
          bgColor: "rgba(76, 175, 80, 0.15)",
          borderColor: "rgba(76, 175, 80, 0.3)",
          label: "Connected",
          icon: "●",
          title: details || "Daemon healthy - All systems operational",
        };
      case "warning":
        return {
          color: "#ff9800", // Orange
          bgColor: "rgba(255, 152, 0, 0.15)",
          borderColor: "rgba(255, 152, 0, 0.3)",
          label: "Limited",
          icon: "⚠",
          title: details || "Daemon running with warnings - Check firewall settings",
        };
      case "error":
        return {
          color: "#f44336", // Red
          bgColor: "rgba(244, 67, 54, 0.15)",
          borderColor: "rgba(244, 67, 54, 0.3)",
          label: "Error",
          icon: "✖",
          title: details || "Daemon error - Check connection",
        };
      case "offline":
      default:
        return {
          color: "#9e9e9e", // Gray
          bgColor: "rgba(158, 158, 158, 0.15)",
          borderColor: "rgba(158, 158, 158, 0.3)",
          label: "Offline",
          icon: "○",
          title: details || "Daemon offline - Connecting...",
        };
    }
  };

  const stateInfo = getStateInfo();

  return (
    <div
      className={`daemonHealthLed chip ${state === "healthy" ? "ok" : state === "offline" ? "neutral" : "bad"}`}
      onClick={onClick}
      title={stateInfo.title}
      style={{
        cursor: onClick ? "pointer" : "default",
        background: stateInfo.bgColor,
        borderColor: stateInfo.borderColor,
        color: stateInfo.color,
        padding: "4px 12px",
        display: "flex",
        alignItems: "center",
        gap: "6px",
        fontSize: "12px",
        fontWeight: 600,
        borderRadius: "4px",
        border: `1px solid ${stateInfo.borderColor}`,
        transition: "all 0.2s ease",
      }}
    >
      <span
        className="healthIcon"
        style={{
          fontSize: "10px",
          lineHeight: 1,
          color: stateInfo.color,
        }}
      >
        {stateInfo.icon}
      </span>
      <span className="healthLabel">{stateInfo.label}</span>
    </div>
  );
});

DaemonHealthLed.displayName = "DaemonHealthLed";
