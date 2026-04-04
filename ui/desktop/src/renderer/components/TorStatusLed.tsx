import React from "react";
import type { TorState } from "../types";

interface TorStatusLedProps {
  torStatus: TorState | null;
  online: boolean;
}

export const TorStatusLed: React.FC<TorStatusLedProps> = ({ torStatus, online }) => {
  if (!online || !torStatus) {
    return (
      <div className="tor-status-led" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <div
          style={{
            width: "12px",
            height: "12px",
            borderRadius: "50%",
            backgroundColor: "#666",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: "12px", color: "#999" }}>Tor: Offline</span>
      </div>
    );
  }

  const getStatusColor = (): string => {
    switch (torStatus.status) {
      case "connected":
        return "#4CAF50"; // Green
      case "connecting":
        return "#FF9800"; // Orange
      case "error":
        return "#F44336"; // Red
      case "disconnected":
      default:
        return "#666"; // Gray
    }
  };

  const getStatusText = (): string => {
    switch (torStatus.status) {
      case "connected":
        return "Tor: Connected";
      case "connecting":
        return "Tor: Connecting...";
      case "error":
        return `Tor: Error${torStatus.error ? ` (${torStatus.error})` : ""}`;
      case "disconnected":
      default:
        return "Tor: Disconnected";
    }
  };

  return (
    <div className="tor-status-led" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <div
        style={{
          width: "12px",
          height: "12px",
          borderRadius: "50%",
          backgroundColor: getStatusColor(),
          flexShrink: 0,
          boxShadow: torStatus.status === "connected" ? `0 0 4px ${getStatusColor()}` : "none",
        }}
      />
      <span style={{ fontSize: "12px", color: torStatus.status === "connected" ? "#4CAF50" : "#999" }}>
        {getStatusText()}
      </span>
      {torStatus.socks_addr && (
        <span style={{ fontSize: "11px", color: "#666", marginLeft: "4px" }}>
          ({torStatus.socks_addr})
        </span>
      )}
    </div>
  );
};
