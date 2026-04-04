import React, { memo } from "react";
import { fmtBytesPerSec, fmtBytes } from "../../utils/format";
import type { NetPosture } from "../../types";

interface StatusBarProps {
  globalUpSpeed: number; // bytes per second
  globalDownSpeed: number; // bytes per second
  dhtStatus: "enabled" | "disabled";
  pexStatus: "enabled" | "disabled";
  lsdStatus: "enabled" | "disabled";
  vpnStatus: "active" | "inactive" | "unknown";
  bindInterface: string | null;
  diskFree: number | null; // bytes
  encryptionMode: "forced" | "preferred" | "disabled";
  netPosture: NetPosture | null;
  /** Build/version shown in bottom right */
  version?: string;
}

export const StatusBar = memo<StatusBarProps>(({
  globalUpSpeed,
  globalDownSpeed,
  dhtStatus,
  pexStatus,
  lsdStatus,
  vpnStatus,
  bindInterface,
  diskFree,
  encryptionMode,
  netPosture,
  version,
}) => {
  return (
    <div className="statusBar">
      <div className="statusBarLeft">
        <div className="statusItem">
          <span className="statusLabel">↓</span>
          <span className="statusValue">{fmtBytesPerSec(globalDownSpeed)}</span>
        </div>
        <div className="statusItem">
          <span className="statusLabel">↑</span>
          <span className="statusValue">{fmtBytesPerSec(globalUpSpeed)}</span>
        </div>
        <div className="statusDivider" />
        <div className="statusItem">
          <span className={`statusIndicator ${dhtStatus === "enabled" ? "enabled" : "disabled"}`} />
          <span className="statusLabel">DHT</span>
        </div>
        <div className="statusItem">
          <span className={`statusIndicator ${pexStatus === "enabled" ? "enabled" : "disabled"}`} />
          <span className="statusLabel">PEX</span>
        </div>
        <div className="statusItem">
          <span className={`statusIndicator ${lsdStatus === "enabled" ? "enabled" : "disabled"}`} />
          <span className="statusLabel">LSD</span>
        </div>
        <div className="statusDivider" />
        <div className="statusItem">
          <span className={`statusIndicator ${vpnStatus === "active" ? "enabled" : "disabled"}`} />
          <span className="statusLabel">VPN</span>
          {vpnStatus === "active" && bindInterface && (
            <span className="statusValueSmall">{bindInterface}</span>
          )}
        </div>
        {bindInterface && (
          <div className="statusItem">
            <span className="statusLabel">BIND:</span>
            <span className="statusValueSmall">{bindInterface}</span>
          </div>
        )}
        {diskFree !== null && (
          <>
            <div className="statusDivider" />
            <div className="statusItem">
              <span className="statusLabel">DISK:</span>
              <span className="statusValueSmall">{fmtBytes(diskFree)}</span>
            </div>
          </>
        )}
        <div className="statusDivider" />
        <div className="statusItem">
          <span className="statusLabel">ENC:</span>
          <span className="statusValueSmall">{encryptionMode.toUpperCase()}</span>
        </div>
      </div>
      <div className="statusBarRight">
        {netPosture && (
          <div className={`statusPosture ${netPosture.state}`}>
            {netPosture.state === "protected" ? "PROTECTED" : 
             netPosture.state === "leak_risk" ? "LEAK RISK" : 
             "UNCONFIGURED"}
          </div>
        )}
        {version != null && version !== "" && (
          <span className="statusBarVersion" title="Build version">
            v{version}
          </span>
        )}
      </div>
    </div>
  );
});

StatusBar.displayName = "StatusBar";
