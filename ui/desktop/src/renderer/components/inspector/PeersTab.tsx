import React, { memo, useCallback, useState, useEffect, useMemo } from "react";
import type { Torrent, TorrentStatus } from "../../types";
import { fmtBytesPerSec, fmtBytes } from "../../utils/format";
import { getJson } from "../../utils/api";
import { getPeerCountryInfo } from "../../utils/country";

interface Peer {
  id: string;
  ip: string;
  port: number;
  client?: string | null;
  flags?: string | null;
  down_rate: number;
  up_rate: number;
  downloaded?: number;
  uploaded?: number;
  progress?: number;
  snubbed: boolean;
  choked: boolean;
  interested?: boolean;
  optimistic?: boolean;
  incoming?: boolean;
  encrypted?: boolean;
  rtt_ms?: number | null;
  country?: string | null;
}

interface PeersTabProps {
  torrent: Torrent;
  torrentStatus?: TorrentStatus;
  online: boolean;
  onUpdate: () => void;
  onError: (msg: string) => void;
  onSuccess: (msg: string) => void;
}

type SortField = "ip" | "country" | "client" | "progress" | "downRate" | "upRate" | "uploaded" | "status";
type SortDirection = "asc" | "desc";

export const PeersTab = memo<PeersTabProps>(({
  torrent,
  torrentStatus,
  online,
  onError,
}) => {
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(false);
  const [sortField, setSortField] = useState<SortField>("downRate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filter, setFilter] = useState("");
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  // Fetch peers from API
  const fetchPeers = useCallback(async () => {
    if (!online) return;
    
    setLoading(true);
    try {
      const data = await getJson<{ peers: Peer[] }>(`/torrents/${torrent.id}/peers`);
      setPeers(data.peers || []);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to fetch peers";
      const isPersistentError = err instanceof Error && "status" in err && 
        typeof (err as Record<string, unknown>).status === "number" && 
        ((err as Record<string, unknown>).status as number) >= 400 && 
        ((err as Record<string, unknown>).status as number) < 500;
      if (isPersistentError) {
        onError(message);
        setPeers([]);
      }
    } finally {
      setLoading(false);
    }
  }, [torrent.id, online, onError]);

  // Initial fetch and refresh
  useEffect(() => {
    fetchPeers();
  }, [fetchPeers]);

  // Auto-refresh peers every 5 seconds when online (optimized for performance)
  // Peer data doesn't change rapidly, 5s provides good balance of freshness and efficiency
  useEffect(() => {
    if (!online) return;
    const interval = setInterval(fetchPeers, 5000);
    return () => clearInterval(interval);
  }, [online, fetchPeers]);

  // Copy IP to clipboard
  const handleCopyIp = useCallback(async (ip: string, port: number) => {
    const addr = `${ip}:${port}`;
    try {
      await navigator.clipboard.writeText(addr);
      setCopiedIp(addr);
      setTimeout(() => setCopiedIp(null), 2000);
    } catch {
      onError("Failed to copy IP to clipboard");
    }
  }, [onError]);

  // Summary statistics. Use torrent-level down/up rate when peer-level rates are all 0
  // (daemon currently returns discovered addresses only; per-peer rates not yet wired).
  const stats = useMemo(() => {
    const totalDown = peers.reduce((sum, p) => sum + p.down_rate, 0);
    const totalUp = peers.reduce((sum, p) => sum + p.up_rate, 0);
    const useTorrentRates = totalDown === 0 && totalUp === 0 && torrentStatus;
    const displayDown = useTorrentRates ? (torrentStatus?.down_rate_bps ?? 0) : totalDown;
    const displayUp = useTorrentRates ? (torrentStatus?.up_rate_bps ?? 0) : totalUp;
    const downloading = peers.filter(p => p.down_rate > 0).length;
    const uploading = peers.filter(p => p.up_rate > 0).length;
    const seeds = peers.filter(p => (p.progress ?? 0) >= 1).length;
    const incoming = peers.filter(p => p.incoming).length;
    const encrypted = peers.filter(p => p.encrypted).length;
    const choked = peers.filter(p => p.choked).length;
    return {
      totalDown,
      totalUp,
      displayDown,
      displayUp,
      downloading,
      uploading,
      seeds,
      incoming,
      encrypted,
      choked,
      total: peers.length,
    };
  }, [peers, torrentStatus]);

  // Filter and sort peers (filter matches IP, client, country code, or country name)
  const filteredPeers = useMemo(() => {
    let result = [...peers];
    
    if (filter) {
      const lowerFilter = filter.toLowerCase().trim();
      result = result.filter(p => {
        if (p.ip.toLowerCase().includes(lowerFilter)) return true;
        if (p.client?.toLowerCase().includes(lowerFilter)) return true;
        if (p.country?.toLowerCase().includes(lowerFilter)) return true;
        const countryInfo = getPeerCountryInfo(p.country, p.ip);
        if (countryInfo.name.toLowerCase().includes(lowerFilter)) return true;
        return false;
      });
    }
    
    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "ip":
          cmp = a.ip.localeCompare(b.ip);
          break;
        case "country":
          cmp = (a.country || "").localeCompare(b.country || "");
          break;
        case "client":
          cmp = (a.client || "").localeCompare(b.client || "");
          break;
        case "progress":
          cmp = (a.progress ?? 0) - (b.progress ?? 0);
          break;
        case "downRate":
          cmp = a.down_rate - b.down_rate;
          break;
        case "upRate":
          cmp = a.up_rate - b.up_rate;
          break;
        case "uploaded":
          cmp = (a.uploaded ?? 0) - (b.uploaded ?? 0);
          break;
        case "status":
          // Sort by activity level
          const getActivityScore = (p: Peer) => {
            if (p.snubbed) return 0;
            if (p.choked) return 1;
            return 2 + (p.down_rate > 0 ? 1 : 0) + (p.up_rate > 0 ? 1 : 0);
          };
          cmp = getActivityScore(a) - getActivityScore(b);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    
    return result;
  }, [peers, filter, sortField, sortDirection]);

  // Handle column sort
  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "downRate" || field === "upRate" ? "desc" : "asc");
    }
  }, [sortField]);

  // Parse client name for better display
  const parseClient = useCallback((client: string | null | undefined): { name: string; version: string } => {
    if (!client) return { name: "Unknown", version: "" };
    
    // Client code mapping (2-letter peer IDs)
    const clientCodes: Record<string, string> = {
      qB: "qBittorrent", TR: "Transmission", UT: "µTorrent", DE: "Deluge", 
      LT: "libtorrent", BC: "BitComet", AZ: "Azureus", BT: "BitTorrent",
      FD: "Free Download Manager", SD: "Thunder", XL: "Xunlei", AG: "Ares"
    };
    
    // Check for peer ID format: -XX1234-
    const peerIdMatch = client.match(/^-?([A-Za-z]{2})(\d{4})-?/);
    if (peerIdMatch) {
      const code = peerIdMatch[1].toUpperCase();
      const name = clientCodes[code] || code;
      const ver = peerIdMatch[2];
      const version = ver ? `${ver[0]}.${ver[1]}.${ver[2]}` : "";
      return { name, version };
    }
    
    // Check for common client string patterns
    const clientPatterns: Array<{ regex: RegExp; name: string }> = [
      { regex: /qBittorrent[\/\s]?([\d.]+)?/i, name: "qBittorrent" },
      { regex: /Transmission[\/\s]?([\d.]+)?/i, name: "Transmission" },
      { regex: /µTorrent[\/\s]?([\d.]+)?/i, name: "µTorrent" },
      { regex: /libtorrent[\/\s]?([\d.]+)?/i, name: "libtorrent" },
      { regex: /Deluge[\/\s]?([\d.]+)?/i, name: "Deluge" },
    ];
    
    for (const pattern of clientPatterns) {
      const match = client.match(pattern.regex);
      if (match) {
        return { name: pattern.name, version: match[1] || "" };
      }
    }
    
    return { name: client.substring(0, 20), version: "" };
  }, []);

  // Get connection flags display
  const getConnectionFlags = useCallback((peer: Peer): { icon: string; label: string; class: string }[] => {
    const flags: { icon: string; label: string; class: string }[] = [];
    
    if (peer.encrypted) flags.push({ icon: "🔒", label: "Encrypted", class: "encrypted" });
    if (peer.incoming) flags.push({ icon: "←", label: "Incoming", class: "incoming" });
    else flags.push({ icon: "→", label: "Outgoing", class: "outgoing" });
    
    return flags;
  }, []);

  // Get peer status
  const getPeerStatus = useCallback((peer: Peer): { label: string; class: string; detail: string } => {
    if (peer.snubbed) return { label: "Snubbed", class: "snubbed", detail: "Peer is not responding" };
    if (peer.choked && peer.down_rate === 0 && peer.up_rate === 0) {
      return { label: "Choked", class: "choked", detail: "Peer is choking us" };
    }
    if (peer.down_rate > 0 && peer.up_rate > 0) {
      return { label: "Active", class: "active", detail: "Transferring both ways" };
    }
    if (peer.down_rate > 0) return { label: "Downloading", class: "downloading", detail: "Receiving data" };
    if (peer.up_rate > 0) return { label: "Uploading", class: "uploading", detail: "Sending data" };
    return { label: "Idle", class: "idle", detail: "Connected but idle" };
  }, []);

  // Sort indicator component
  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <span className="sortIndicator">⇅</span>;
    return <span className="sortIndicator active">{sortDirection === "asc" ? "↑" : "↓"}</span>;
  };

  // Get unique IPs and unique countries (for summary)
  const uniqueIPs = useMemo(() => {
    const ips = new Set(peers.map(p => p.ip));
    return ips.size;
  }, [peers]);

  const uniqueCountries = useMemo(() => {
    const keys = new Set<string>();
    peers.forEach(p => {
      const info = getPeerCountryInfo(p.country, p.ip);
      keys.add(info.isSpecial ? "local" : (p.country?.toUpperCase() || "—"));
    });
    return keys.size;
  }, [peers]);

  return (
    <div className="inspectorTabContent">
      {/* KPI Header */}
      {online && (
        <div className="peerKpiHeader">
          <div className="peerKpiSection">
            <div className="peerKpiTitle">Connected Peers</div>
            <div className="peerKpiValue">{peers.length}</div>
            {uniqueIPs !== peers.length && (
              <div className="peerKpiSubtext">{uniqueIPs} unique IPs</div>
            )}
          </div>
          <div className="peerKpiSection">
            <div className="peerKpiTitle">Total Rate</div>
            <div className="peerKpiValue download">{fmtBytesPerSec(stats.displayDown)}</div>
            <div className="peerKpiSubtext">↓ Download</div>
          </div>
          <div className="peerKpiSection">
            <div className="peerKpiTitle">Total Rate</div>
            <div className="peerKpiValue upload">{fmtBytesPerSec(stats.displayUp)}</div>
            <div className="peerKpiSubtext">↑ Upload</div>
          </div>
          {torrentStatus && (
            <div className="peerKpiSection">
              <div className="peerKpiTitle">Torrent Status</div>
              <div className="peerKpiValue">
                {torrentStatus.state === "downloading" && peers.length === 0 && (torrentStatus.down_rate_bps ?? 0) === 0 && (torrentStatus.up_rate_bps ?? 0) === 0
                  ? "connecting…"
                  : torrentStatus.state}
              </div>
              <div className="peerKpiSubtext">
                {torrentStatus.state === "downloading"
                  ? peers.length === 0 && (torrentStatus.down_rate_bps ?? 0) === 0
                    ? "Searching for peers"
                    : "Active"
                  : torrentStatus.state === "seeding"
                    ? "Seeding"
                    : torrentStatus.state === "stopped"
                      ? "Paused"
                      : torrentStatus.state === "checking"
                        ? "Checking"
                        : "Error"}
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Summary Stats */}
      {online && peers.length > 0 && (
        <div className="peerSummary">
          <div className="peerSummaryItem" title="Addresses discovered from trackers/DHT (not all may be connected)">
            <span className="peerSummaryValue">{stats.total}</span>
            <span className="peerSummaryLabel">Discovered</span>
          </div>
          <div className="peerSummaryDivider" />
          <div className="peerSummaryItem">
            <span className="peerSummaryValue seeds">{stats.seeds}</span>
            <span className="peerSummaryLabel">Seeds</span>
          </div>
          {uniqueCountries > 0 && (
            <>
              <div className="peerSummaryDivider" />
              <div className="peerSummaryItem" title="Unique countries / regions">
                <span className="peerSummaryValue">{uniqueCountries}</span>
                <span className="peerSummaryLabel">Countries</span>
              </div>
            </>
          )}
          <div className="peerSummaryDivider" />
          <div className="peerSummaryItem download">
            <span className="peerSummaryValue">{fmtBytesPerSec(stats.displayDown)}</span>
            <span className="peerSummaryLabel">↓ Total</span>
          </div>
          <div className="peerSummaryDivider" />
          <div className="peerSummaryItem upload">
            <span className="peerSummaryValue">{fmtBytesPerSec(stats.displayUp)}</span>
            <span className="peerSummaryLabel">↑ Total</span>
          </div>
          {stats.encrypted > 0 && (
            <>
              <div className="peerSummaryDivider" />
              <div className="peerSummaryItem">
                <span className="peerSummaryValue encrypted">{stats.encrypted}</span>
                <span className="peerSummaryLabel">🔒 Encrypted</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="inspectorSection">
        <div className="inspectorSectionHeader">
          <div className="inspectorSectionTitle">
            Peers
            {loading && <span className="loadingIndicator">(updating...)</span>}
          </div>
          {peers.length > 0 && (
            <input
              type="text"
              className="input peerFilter"
              placeholder="Filter by IP, client, or country..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter peers by IP, client, or country"
            />
          )}
        </div>
        
        <div className="peerList">
          {!online ? (
            <div className="empty">
              <div className="emptyIcon">👥</div>
              <div className="emptyTitle">Not Connected</div>
              <div className="emptySubtitle">
                Connect to daemon to view peer information
              </div>
            </div>
          ) : peers.length === 0 && !loading ? (
            <div className="empty">
              <div className="emptyIcon">🔍</div>
              <div className="emptyTitle">No Peers Connected</div>
              <div className="emptySubtitle">
                Peers will appear here when connections are established.<br />
                Make sure the torrent is started and trackers are reachable.
              </div>
            </div>
          ) : filteredPeers.length === 0 && filter ? (
            <div className="empty">
              <div className="emptyIcon">🔎</div>
              <div className="emptyTitle">No Matching Peers</div>
              <div className="emptySubtitle">
                No peers match your filter "{filter}"
              </div>
            </div>
          ) : filteredPeers.length > 0 && (
            <table className="table peerTable">
              <thead>
                <tr>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("ip")}
                    style={{ width: "160px" }}
                    scope="col"
                    aria-sort={sortField === "ip" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent">
                      Address <SortIndicator field="ip" />
                    </div>
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("country")}
                    style={{ width: "60px" }}
                    scope="col"
                    aria-sort={sortField === "country" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent">
                      Country <SortIndicator field="country" />
                    </div>
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("client")}
                    style={{ width: "140px" }}
                    scope="col"
                    aria-sort={sortField === "client" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent">
                      Client <SortIndicator field="client" />
                    </div>
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("progress")}
                    style={{ width: "100px" }}
                    scope="col"
                    aria-sort={sortField === "progress" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent">
                      Progress <SortIndicator field="progress" />
                    </div>
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("downRate")}
                    style={{ width: "100px", textAlign: "right" }}
                    scope="col"
                    aria-sort={sortField === "downRate" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent" style={{ justifyContent: "flex-end" }}>
                      ↓ Down <SortIndicator field="downRate" />
                    </div>
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("upRate")}
                    style={{ width: "100px", textAlign: "right" }}
                    scope="col"
                    aria-sort={sortField === "upRate" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent" style={{ justifyContent: "flex-end" }}>
                      ↑ Up <SortIndicator field="upRate" />
                    </div>
                  </th>
                  <th className="tableHeader" style={{ width: "80px" }} scope="col">
                    Flags
                  </th>
                  <th
                    className="tableHeader sortable"
                    onClick={() => handleSort("status")}
                    style={{ width: "100px" }}
                    scope="col"
                    aria-sort={sortField === "status" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
                  >
                    <div className="tableHeaderContent">
                      Status <SortIndicator field="status" />
                    </div>
                  </th>
                  <th className="tableHeader" style={{ width: "40px" }} scope="col" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {filteredPeers.map(peer => {
                  const clientInfo = parseClient(peer.client);
                  const status = getPeerStatus(peer);
                  const connFlags = getConnectionFlags(peer);
                  const progress = peer.progress ?? 0;
                  const ipAddr = `${peer.ip}:${peer.port}`;
                  const countryInfo = getPeerCountryInfo(peer.country, peer.ip);
                  
                  return (
                    <tr key={peer.id} className={`tableRow ${status.class}`}>
                      <td className="tableCell">
                        <div className="peerAddress">
                          <span className="peerIp" title={ipAddr}>{peer.ip}</span>
                          <span className="peerPort">:{peer.port}</span>
                        </div>
                        {peer.rtt_ms !== null && peer.rtt_ms !== undefined && (
                          <div className="peerRtt">{peer.rtt_ms}ms</div>
                        )}
                      </td>
                      <td className="tableCell">
                        <div className="peerCountry" title={countryInfo.title} aria-label={countryInfo.name}>
                          <span className="peerCountryFlag">{countryInfo.flag}</span>
                        </div>
                      </td>
                      <td className="tableCell">
                        <div className="peerClient">
                          <span className="peerClientName">{clientInfo.name}</span>
                          {clientInfo.version && (
                            <span className="peerClientVersion">{clientInfo.version}</span>
                          )}
                        </div>
                      </td>
                      <td className="tableCell">
                        <div className="peerProgress">
                          <div className="peerProgressBar">
                            <div 
                              className={`peerProgressFill ${progress >= 1 ? 'complete' : ''}`}
                              style={{ width: `${Math.min(100, progress * 100)}%` }}
                            />
                          </div>
                          <span className="peerProgressText">
                            {progress >= 1 ? "Seed" : `${(progress * 100).toFixed(0)}%`}
                          </span>
                        </div>
                      </td>
                      <td className="tableCell peerSpeed download">
                        {peer.down_rate > 0 ? fmtBytesPerSec(peer.down_rate) : "—"}
                        {peer.downloaded !== undefined && peer.downloaded > 0 && (
                          <div className="peerTransferred">{fmtBytes(peer.downloaded)}</div>
                        )}
                      </td>
                      <td className="tableCell peerSpeed upload">
                        {peer.up_rate > 0 ? fmtBytesPerSec(peer.up_rate) : "—"}
                        {peer.uploaded !== undefined && peer.uploaded > 0 && (
                          <div className="peerTransferred">{fmtBytes(peer.uploaded)}</div>
                        )}
                      </td>
                      <td className="tableCell">
                        <div className="peerFlags">
                          {connFlags.map((flag, i) => (
                            <span key={i} className={`peerFlag ${flag.class}`} title={flag.label}>
                              {flag.icon}
                            </span>
                          ))}
                          {peer.flags && (
                            <span className="peerFlagsRaw" title={peer.flags}>
                              {peer.flags}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="tableCell">
                        <span className={`peerStatusPill ${status.class}`} title={status.detail}>
                          {status.label}
                        </span>
                      </td>
                      <td className="tableCell">
                        <button
                          type="button"
                          className="btn ghost small iconBtn"
                          onClick={() => handleCopyIp(peer.ip, peer.port)}
                          title="Copy IP address"
                          aria-label={copiedIp === ipAddr ? "Copied" : `Copy ${ipAddr}`}
                        >
                          {copiedIp === ipAddr ? "✓" : "📋"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
});

PeersTab.displayName = "PeersTab";
