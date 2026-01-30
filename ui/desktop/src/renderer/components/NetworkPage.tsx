import React, { memo, useState, useEffect, useCallback } from "react";
import type { NetworkAdapter, DefaultRoute, DnsConfig, KillSwitchConfig, VpnStatus, TorState } from "../types";
import { getJson, postJson } from "../utils/api";
import { TorStatusLed } from "./TorStatusLed";
import { Modal } from "./Modal";

interface NetworkPageProps {
  online: boolean;
  vpnStatus: VpnStatus | null;
  killSwitch: KillSwitchConfig | null;
  onError: (msg: string) => void;
  onSuccess?: (msg: string) => void;
  onBack?: () => void;
}

export const NetworkPage = memo<NetworkPageProps>(({
  online,
  vpnStatus,
  killSwitch,
  onError,
  onSuccess,
  onBack,
}) => {
  const [adapters, setAdapters] = useState<NetworkAdapter[]>([]);
  const [route, setRoute] = useState<DefaultRoute | null>(null);
  const [dns, setDns] = useState<DnsConfig | null>(null);
  const [torStatus, setTorStatus] = useState<TorState | null>(null);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showTestModal, setShowTestModal] = useState(false);

  const refreshData = useCallback(async () => {
    if (!online) return;
    try {
      setLoading(true);
      const [adaptersData, routeData, dnsData, torData] = await Promise.all([
        getJson<{ adapters: NetworkAdapter[] }>("/net/adapters"),
        getJson<DefaultRoute>("/net/route"),
        getJson<DnsConfig>("/net/dns"),
        getJson<TorState>("/tor/status").catch(() => null),
      ]);
      setAdapters(adaptersData.adapters || []);
      setRoute(routeData);
      setDns(dnsData);
      setTorStatus(torData);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to fetch network data";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [online, onError]);

  const handleRefreshVpn = useCallback(async () => {
    if (!online) return;
    try {
      setLoading(true);
      await postJson("/net/vpn-status/refresh", {});
      // Refresh all data after VPN status update
      await refreshData();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to refresh VPN status";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [online, refreshData, onError]);

  const handleTestEnforcement = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    try {
      const result = await postJson("/net/kill-switch/test", {});
      setTestResult(JSON.stringify(result, null, 2));
      setShowTestModal(true);
      onSuccess?.("Enforcement test completed");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to test enforcement";
      onError(message);
    } finally {
      setLoading(false);
    }
  }, [online, onError, onSuccess]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Use CSS variable-compatible colors for enforcement state
  const getEnforcementStateStyle = (state: string): { color: string; className: string } => {
    switch (state) {
      case "disarmed": return { color: "var(--text-muted)", className: "neutral" };
      case "armed": return { color: "var(--success)", className: "ok" };
      case "engaged": return { color: "var(--error)", className: "error" };
      case "releasing": return { color: "var(--warning)", className: "warning" };
      default: return { color: "var(--text-muted)", className: "neutral" };
    }
  };

  return (
    <div className="networkPage">
      <div className="networkPageHeader">
        {onBack && (
          <button
            className="btn ghost"
            onClick={onBack}
            title="Back to Main Menu"
            style={{ marginRight: "16px" }}
          >
            ← Back to Main Menu
          </button>
        )}
        <h1>Network</h1>
        <div className="networkPageActions">
          <button
            className="btn"
            onClick={refreshData}
            disabled={!online || loading}
          >
            Refresh Adapters
          </button>
          <button
            className="btn"
            onClick={handleRefreshVpn}
            disabled={!online || loading}
          >
            Re-check VPN Now
          </button>
          <button
            className="btn"
            onClick={handleTestEnforcement}
            disabled={!online || loading}
          >
            Test Enforcement
          </button>
        </div>
      </div>

      <div className="networkPageContent">
        {/* Current Adapters */}
        <div className="networkPageSection">
          <h2>Current Adapters</h2>
          {adapters.length === 0 ? (
            <p className="networkPageEmpty">No adapters detected</p>
          ) : (
            <table className="networkTable">
              <thead>
                <tr>
                  <th>Interface</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Gateway</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {adapters.map((adapter, idx) => (
                  <tr key={idx}>
                    <td>{adapter.name}</td>
                    <td>{adapter.interface_type}</td>
                    <td>
                      <span className={`statusBadge ${adapter.status.toLowerCase()}`}>
                        {adapter.status}
                      </span>
                    </td>
                    <td>{adapter.gateway || "—"}</td>
                    <td>
                      {adapter.is_default_route && <span className="flag">Default Route</span>}
                      {adapter.is_vpn && <span className="flag vpn">VPN</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Default Route */}
        <div className="networkPageSection">
          <h2>Default Route</h2>
          {route ? (
            <div className="networkInfoCard">
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Interface:</span>
                <span className="networkInfoValue">{route.interface || "—"}</span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Gateway:</span>
                <span className="networkInfoValue">{route.gateway || "—"}</span>
              </div>
              {route.metric !== null && (
                <div className="networkInfoRow">
                  <span className="networkInfoLabel">Metric:</span>
                  <span className="networkInfoValue">{route.metric}</span>
                </div>
              )}
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Last Update:</span>
                <span className="networkInfoValue">
                  {new Date(route.last_update_ms).toLocaleString()}
                </span>
              </div>
            </div>
          ) : (
            <p className="networkPageEmpty">No route information available</p>
          )}
        </div>

        {/* DNS Servers */}
        <div className="networkPageSection">
          <h2>DNS Servers</h2>
          {dns ? (
            <div className="networkInfoCard">
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Primary:</span>
                <span className="networkInfoValue">{dns.primary || "—"}</span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Secondary:</span>
                <span className="networkInfoValue">{dns.secondary || "—"}</span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Source:</span>
                <span className="networkInfoValue">{dns.source}</span>
              </div>
            </div>
          ) : (
            <p className="networkPageEmpty">No DNS information available</p>
          )}
        </div>

        {/* Enforcement State */}
        {killSwitch && (
          <div className="networkPageSection">
            <h2>Enforcement State</h2>
            <div className="networkInfoCard">
              <div className="networkInfoRow">
                <span className="networkInfoLabel">State:</span>
                <span
                  className={`networkInfoValue pill ${getEnforcementStateStyle(killSwitch.enforcement_state).className}`}
                  style={{
                    fontWeight: "bold",
                    textTransform: "uppercase",
                  }}
                >
                  {killSwitch.enforcement_state}
                </span>
              </div>
              {killSwitch.last_enforcement_ms && (
                <div className="networkInfoRow">
                  <span className="networkInfoLabel">Last Enforcement:</span>
                  <span className="networkInfoValue">
                    {new Date(killSwitch.last_enforcement_ms).toLocaleString()}
                  </span>
                </div>
              )}
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Kill Switch:</span>
                <span className="networkInfoValue">
                  {killSwitch.enabled ? "ENABLED" : "DISABLED"}
                </span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Scope:</span>
                <span className="networkInfoValue">
                  {killSwitch.scope === "torrent_only" ? "Torrent Only" : "App Level"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* VPN Status Details */}
        {vpnStatus && (
          <div className="networkPageSection">
            <h2>VPN Status Details</h2>
            <div className="networkInfoCard">
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Posture:</span>
                <span className="networkInfoValue" style={{ textTransform: "uppercase" }}>
                  {vpnStatus.posture}
                </span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Interface:</span>
                <span className="networkInfoValue">{vpnStatus.interface || "—"}</span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Default Route Interface:</span>
                <span className="networkInfoValue">{vpnStatus.default_route_interface || "—"}</span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">DNS Servers:</span>
                <span className="networkInfoValue">
                  {vpnStatus.dns_servers.length > 0
                    ? vpnStatus.dns_servers.join(", ")
                    : "—"}
                </span>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Signals:</span>
                <div className="networkSignals">
                  <span className={`signal ${vpnStatus.signals.adapter_match ? "match" : "nomatch"}`}>
                    Adapter: {vpnStatus.signals.adapter_match ? "YES" : "NO"}
                  </span>
                  <span className={`signal ${vpnStatus.signals.default_route_match ? "match" : "nomatch"}`}>
                    Route: {vpnStatus.signals.default_route_match ? "YES" : "NO"}
                  </span>
                  <span className={`signal ${vpnStatus.signals.dns_match ? "match" : "nomatch"}`}>
                    DNS: {vpnStatus.signals.dns_match ? "YES" : "NO"}
                  </span>
                </div>
              </div>
              <div className="networkInfoRow">
                <span className="networkInfoLabel">Last Check:</span>
                <span className="networkInfoValue">
                  {new Date(vpnStatus.last_check_ms).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tor Status */}
        <div className="networkPageSection">
          <h2>Tor Status</h2>
          <div className="networkInfoCard">
            <TorStatusLed torStatus={torStatus} online={online} />
            {torStatus && (
              <>
                <div className="networkInfoRow" style={{ marginTop: "12px" }}>
                  <span className="networkInfoLabel">Status:</span>
                  <span className="networkInfoValue" style={{ textTransform: "uppercase" }}>
                    {torStatus.status}
                  </span>
                </div>
                {torStatus.socks_addr && (
                  <div className="networkInfoRow">
                    <span className="networkInfoLabel">SOCKS Address:</span>
                    <span className="networkInfoValue">{torStatus.socks_addr}</span>
                  </div>
                )}
                <div className="networkInfoRow">
                  <span className="networkInfoLabel">Source:</span>
                  <span className="networkInfoValue">
                    {typeof torStatus.source === "string" 
                      ? torStatus.source 
                      : "external"}
                  </span>
                </div>
                {torStatus.error && (
                  <div className="networkInfoRow">
                    <span className="networkInfoLabel">Error:</span>
                    <span className="networkInfoValue" style={{ color: "#F44336" }}>
                      {torStatus.error}
                    </span>
                  </div>
                )}
                <div className="networkInfoRow">
                  <span className="networkInfoLabel">Last Check:</span>
                  <span className="networkInfoValue">
                    {new Date(torStatus.last_check_ms).toLocaleString()}
                  </span>
                </div>
                {torStatus.status === "connected" && (
                  <div className="networkInfoRow" style={{ marginTop: "12px", padding: "8px", backgroundColor: "var(--bg-secondary)", borderRadius: "4px", border: "1px solid var(--border)" }}>
                    <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                      <strong>Note:</strong> Tor Assist mode routes HTTP trackers and metadata through Tor.
                      Peer data connections remain direct. DHT and UDP trackers are disabled.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Test Enforcement Result Modal */}
      <Modal
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        title="Kill Switch Test Result"
      >
        <div style={{ padding: "16px" }}>
          <pre style={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "16px",
            fontSize: "12px",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: "400px",
            overflowY: "auto",
            color: "var(--text)"
          }}>
            {testResult || "No result"}
          </pre>
        </div>
      </Modal>
    </div>
  );
});

NetworkPage.displayName = "NetworkPage";
