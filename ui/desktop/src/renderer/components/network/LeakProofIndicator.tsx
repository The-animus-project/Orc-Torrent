import React, { memo } from "react";
import type { NetPosture } from "../../types";

interface LeakProofIndicatorProps {
  netPosture: NetPosture | null;
}

export const LeakProofIndicator = memo<LeakProofIndicatorProps>(({
  netPosture,
}) => {
  const isLeakProof = netPosture?.leak_proof_enabled ?? false;
  const isProtected = netPosture?.state === "protected";

  return (
    <div className="networkWidget">
      <div className="networkWidgetTitle">Leak-Proof State</div>
      <div className="networkWidgetContent">
        <div className={`networkWidgetStatus ${isProtected ? "ok" : "bad"}`}>
          <span className={`statusIndicator ${isProtected ? "enabled" : "disabled"}`} />
          <span className="networkWidgetStatusText">
            {isProtected ? "CONFIRMED SAFE" : "RISK DETECTED"}
          </span>
        </div>
        <div className="networkWidgetDetail">
          <span className="networkWidgetLabel">Leak-proof:</span>
          <span className="networkWidgetValue">{isLeakProof ? "ENABLED" : "DISABLED"}</span>
        </div>
        {!isProtected && (
          <div className="networkWidgetNote" style={{ color: "var(--error)", marginTop: "8px" }}>
            Traffic may escape via non-bound interfaces
          </div>
        )}
      </div>
    </div>
  );
});

LeakProofIndicator.displayName = "LeakProofIndicator";
