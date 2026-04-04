import React, { memo, useCallback, useState, useEffect } from "react";
import type { NetPosture, Torrent, VpnStatus } from "../types";
import { patchJson } from "../utils/api";

interface NetworkPostureProps {
  netPosture: NetPosture | null;
  netifs: string[];
  online: boolean;
  selectedTorrent: Torrent | null;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

export const NetworkPosture = memo<NetworkPostureProps>(({ 
  netPosture, 
  netifs, 
  online,
  selectedTorrent,
  onUpdate,
  onError,
  onSuccess
}) => {
  const [bindIface, setBindIface] = useState(netPosture?.bind_interface ?? "");
  const [leakProof, setLeakProof] = useState(netPosture?.leak_proof_enabled ?? true);
  const [loading, setLoading] = useState(false);
  const [vpnStatus, setVpnStatus] = useState<VpnStatus | null>(null);

  useEffect(() => {
    setBindIface(netPosture?.bind_interface ?? "");
    setLeakProof(netPosture?.leak_proof_enabled ?? true);
  }, [netPosture]);

  // Fetch VPN status periodically
  useEffect(() => {
    const fetchVpnStatus = async () => {
      try {
        const status = await window.orc?.vpnStatus?.();
        if (status) {
          // Cast to VpnStatus - the API may return a partial object with legacy fields
          setVpnStatus(status as VpnStatus);
        }
      } catch (e) {
        // Silently fail - VPN detection is optional
      }
    };

    fetchVpnStatus();
    const interval = setInterval(fetchVpnStatus, 5000); // Check every 5 seconds
    return () => clearInterval(interval);
  }, []);

  // Auto-suggest VPN interface when VPN is detected
  useEffect(() => {
    if (vpnStatus?.detected && vpnStatus.interfaceName && !bindIface.trim()) {
      // Don't auto-set, just suggest via UI
    }
  }, [vpnStatus, bindIface]);

  const applyNetPosture = useCallback(async () => {
    if (!online || loading) return;
    try {
      setLoading(true);
      await patchJson<NetPosture>("/net/posture", {
        bind_interface: bindIface.trim() ? bindIface.trim() : null,
        leak_proof_enabled: leakProof,
      });
      onUpdate();
      onSuccess("Network posture updated");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update network posture";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [bindIface, leakProof, online, loading, onUpdate, onError, onSuccess]);

  const applyPrivateRecommended = useCallback(async () => {
    if (!online || loading) return;
    const def = bindIface.trim() ? bindIface.trim() : (netifs[0] ?? "");
    setBindIface(def);
    setLeakProof(true);
    try {
      setLoading(true);
      await patchJson<NetPosture>("/net/posture", {
        bind_interface: def ? def : null,
        leak_proof_enabled: true,
      });
      onUpdate();
      onSuccess("Private mode guardrails applied");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to apply guardrails";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [bindIface, netifs, online, loading, onUpdate, onError, onSuccess]);

  const isPrivateMode = selectedTorrent?.profile.mode === "private";
  const isProtected = leakProof && bindIface.trim();
  const vpnDetected = vpnStatus?.detected ?? false;
  const vpnInterface = vpnStatus?.interfaceName ?? null;
  const vpnNotBound = vpnDetected && bindIface !== vpnInterface;

  const applyVpnBinding = useCallback(() => {
    if (vpnInterface) {
      setBindIface(vpnInterface);
      setLeakProof(true);
    }
  }, [vpnInterface]);

  return (
    <section className="panel">
      <div className="panelHeader">
        <div className="panelTitle">Network Posture</div>
        <div className="panelMeta">Configure network security</div>
      </div>
      <div className="stack">
        {vpnDetected && (
          <div className={`npWarn ${vpnNotBound ? "bad" : "ok"}`}>
            VPN DETECTED: {vpnInterface}
            {vpnNotBound && (
              <button 
                className="btn small" 
                onClick={applyVpnBinding}
                style={{ marginLeft: "8px", padding: "4px 8px" }}
                disabled={!online || loading}
              >
                BIND TO VPN
              </button>
            )}
          </div>
        )}
        <div className="npGrid">
          <div className="npItem">
            <div className="npLabel">Bind interface</div>
            <div className="npControl">
              <select
                className="select"
                value={bindIface}
                onChange={(e) => setBindIface(e.target.value)}
                disabled={!online}
              >
                <option value="">(not set)</option>
                {netifs.map((n) => (
                  <option key={n} value={n} style={n === vpnInterface ? { fontWeight: "bold" } : {}}>
                    {n}{n === vpnInterface ? " (VPN)" : ""}
                  </option>
                ))}
              </select>
              <input
                className="input small"
                value={bindIface}
                onChange={(e) => setBindIface(e.target.value)}
                placeholder={vpnDetected && vpnInterface ? `VPN detected: ${vpnInterface}` : "Manual override"}
                disabled={!online}
                spellCheck={false}
              />
            </div>
          </div>

          <div className="npItem">
            <div className="npLabel">Leak-proof</div>
            <label className={`toggle ${!online ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={leakProof}
                onChange={(e) => setLeakProof(e.target.checked)}
                disabled={!online}
              />
              <span className="slider" />
              <span className="tText">{leakProof ? "ON" : "OFF"}</span>
            </label>
          </div>

          <div className="npItem">
            <div className="npLabel">State</div>
            <div className={`npState ${netPosture?.state ?? "unconfigured"}`}>
              {netPosture ? netPosture.state.replace("_", " ") : "—"}
            </div>
          </div>
        </div>

        <div className="npActions">
        <button className="btn" onClick={applyNetPosture} disabled={!online || loading}>
          {loading ? "APPLYING..." : "APPLY"}
        </button>
        {isPrivateMode && (
          <button className="btn primary" onClick={applyPrivateRecommended} disabled={!online || loading}>
            {loading ? "APPLYING..." : "APPLY PRIVATE GUARDRAILS"}
          </button>
        )}
        </div>

        {isPrivateMode && (
          <div className={`npWarn ${isProtected ? "ok" : "bad"}`}>
            PRIVATE MODE AUDIT: {isProtected
              ? "PROTECTED (BOUND + LEAK-PROOF ENABLED)"
              : "RISK (ENABLE LEAK-PROOF AND BIND TO A NIC TO PREVENT LEAKS)"}
            {vpnDetected && vpnNotBound && (
              <div style={{ marginTop: "4px", fontSize: "0.9em" }}>
                WARNING: VPN detected but not bound. Bind to {vpnInterface} for secure VPN routing.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
});

NetworkPosture.displayName = "NetworkPosture";
