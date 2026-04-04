import React, { memo, useCallback, useState } from "react";
import { patchJson } from "../../utils/api";

interface ConnectionPolicyTogglesProps {
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

interface ConnectionPolicies {
  dht: boolean;
  pex: boolean;
  lsd: boolean;
  forceEncryption: boolean;
  allowLegacyPeers: boolean;
}

export const ConnectionPolicyToggles = memo<ConnectionPolicyTogglesProps>(({
  online,
  onUpdate,
  onError,
  onSuccess,
}) => {
  const [policies, setPolicies] = useState<ConnectionPolicies>({
    dht: true,
    pex: true,
    lsd: true,
    forceEncryption: false,
    allowLegacyPeers: true,
  });
  const [loading, setLoading] = useState(false);

  const handleApply = useCallback(async () => {
    if (!online || loading) return;
    try {
      setLoading(true);
      // Note: Connection policies API endpoint not yet implemented
      // await patchJson("/net/policies", policies);
      onUpdate();
      onSuccess("Connection policies will be applied when the API endpoint is available");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update connection policies";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [policies, online, loading, onUpdate, onError, onSuccess]);

  return (
    <div className="networkWidget">
      <div className="networkWidgetTitle">Connection Policies</div>
      <div className="networkWidgetContent">
        <div className="networkWidgetToggles">
          <label className="toggle">
            <input
              type="checkbox"
              checked={policies.dht}
              onChange={(e) => setPolicies(prev => ({ ...prev, dht: e.target.checked }))}
              disabled={!online}
            />
            <span className="slider" />
            <span className="tText">DHT</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={policies.pex}
              onChange={(e) => setPolicies(prev => ({ ...prev, pex: e.target.checked }))}
              disabled={!online}
            />
            <span className="slider" />
            <span className="tText">PEX</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={policies.lsd}
              onChange={(e) => setPolicies(prev => ({ ...prev, lsd: e.target.checked }))}
              disabled={!online}
            />
            <span className="slider" />
            <span className="tText">LSD</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={policies.forceEncryption}
              onChange={(e) => setPolicies(prev => ({ ...prev, forceEncryption: e.target.checked }))}
              disabled={!online}
            />
            <span className="slider" />
            <span className="tText">Force Encryption</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={policies.allowLegacyPeers}
              onChange={(e) => setPolicies(prev => ({ ...prev, allowLegacyPeers: e.target.checked }))}
              disabled={!online}
            />
            <span className="slider" />
            <span className="tText">Allow Legacy Peers</span>
          </label>
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

ConnectionPolicyToggles.displayName = "ConnectionPolicyToggles";
