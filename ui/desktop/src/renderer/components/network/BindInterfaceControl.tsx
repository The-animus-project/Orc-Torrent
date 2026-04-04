import React, { memo, useCallback, useState } from "react";
import type { NetPosture, VpnStatus } from "../../types";
import { patchJson } from "../../utils/api";

interface BindInterfaceControlProps {
  netPosture: NetPosture | null;
  netifs: string[];
  vpnStatus: VpnStatus | null;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const BindInterfaceControl = memo<BindInterfaceControlProps>(({
  netPosture,
  netifs,
  vpnStatus,
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [bindIface, setBindIface] = useState(netPosture?.bind_interface ?? "");
  const [loading, setLoading] = useState(false);

  const handleApply = useCallback(async () => {
    if (!online || loading) return;
    try {
      setLoading(true);
      await patchJson("/net/posture", {
        bind_interface: bindIface.trim() ? bindIface.trim() : null,
        leak_proof_enabled: netPosture?.leak_proof_enabled ?? true,
      });
      onUpdate();
      onSuccess("Interface binding updated");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update interface binding";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [bindIface, netPosture, online, loading, onUpdate, onError, onSuccess]);

  const handleLockToVpn = useCallback(() => {
    if (vpnStatus?.interfaceName) {
      setBindIface(vpnStatus.interfaceName);
    }
  }, [vpnStatus]);

  return (
    <div className="networkWidget">
      <div className="networkWidgetTitle">Bind Interface</div>
      <div className="networkWidgetContent">
        <div className="fieldRow">
          <select
            className="select"
            value={bindIface}
            onChange={(e) => setBindIface(e.target.value)}
            disabled={!online}
          >
            <option value="">(not set)</option>
            {netifs.map((n) => (
              <option key={n} value={n} style={n === vpnStatus?.interfaceName ? { fontWeight: "bold" } : {}}>
                {n}{n === vpnStatus?.interfaceName ? " (VPN)" : ""}
              </option>
            ))}
          </select>
          {vpnStatus?.detected && vpnStatus.interfaceName && (
            <button
              className="btn ghost small"
              onClick={handleLockToVpn}
              disabled={!online}
            >
              LOCK TO VPN
            </button>
          )}
        </div>
        <button
          className="btn"
          onClick={handleApply}
          disabled={!online || loading}
        >
          {loading ? "APPLYING..." : "APPLY"}
        </button>
      </div>
    </div>
  );
});

BindInterfaceControl.displayName = "BindInterfaceControl";
