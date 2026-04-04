import { getJson } from "../../utils/api";
import type { VpnStatus } from "../../types";

/**
 * Best-effort VPN status resolver that tries daemon endpoint first,
 * then falls back to Electron IPC if daemon fails or returns unknown.
 */
export async function getVpnStatusBestEffort(): Promise<VpnStatus> {
  try {
    const s = await getJson<VpnStatus>("/net/vpn-status");
    if (s?.posture && s.posture !== "unknown") return s;
  } catch {}

  try {
    const local = await (window as any).orc?.vpnStatus?.();
    if (local) {
      const now = Date.now();
      return {
        posture: local.detected ? "connected" : "disconnected",
        interface: local.interfaceName ?? null,
        default_route_interface: local.interfaceName ?? null,
        dns_servers: [],
        last_check_ms: now,
        connection_type: local.detected ? "vpn" : "non_vpn",
        signals: {
          adapter_match: false,
          default_route_match: false,
          dns_match: false,
          public_ip_match: null,
        },
        public_ip: null,
        // Legacy compatibility
        detected: local.detected,
        interfaceName: local.interfaceName ?? null,
      };
    }
  } catch {}

  return {
    posture: "unknown",
    interface: null,
    default_route_interface: null,
    dns_servers: [],
    last_check_ms: Date.now(),
    connection_type: "non_vpn",
    signals: {
      adapter_match: false,
      default_route_match: false,
      dns_match: false,
      public_ip_match: null,
    },
    public_ip: null,
  };
}
