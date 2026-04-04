// Hook for managing policy state (Desired vs Effective)
// UI expresses intent, daemon computes effective policy

import { useEffect, useState, useCallback } from "react";
import type { PolicyState, DesiredPolicy } from "../types/policy";
import { getJson, patchJson } from "./api";
import { logger } from "./logger";

export function usePolicy(online: boolean) {
  const [state, setState] = useState<PolicyState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!online) {
      setState(null);
      return;
    }
    try {
      setError(null);
      const policyState = await getJson<PolicyState>("/v1/policy");
      setState(policyState);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load policy";
      setError(message);
      logger.errorWithPrefix("Policy", "Refresh error:", e);
    }
  }, [online]);

  const update = useCallback(async (patch: Partial<DesiredPolicy>) => {
    if (!online || !state) return;
    try {
      setLoading(true);
      setError(null);
      
      // Merge patch into current desired policy
      const updatedDesired: DesiredPolicy = {
        ...state.desired,
        ...patch,
      };
      
      // Send to daemon - it will compute effective policy
      const updatedState = await patchJson<PolicyState>("/v1/policy", {
        desired_patch: updatedDesired,
      });
      
      setState(updatedState);
      return updatedState;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to update policy";
      setError(message);
      // Refresh to get current state
      await refresh();
      throw e;
    } finally {
      setLoading(false);
    }
  }, [online, state, refresh]);

  const applyProfile = useCallback(async (profile: "standard" | "hardened" | "anonymous") => {
    if (!online) return;
    try {
      setLoading(true);
      setError(null);
      
      // Create base policy for profile
      const profilePolicy: DesiredPolicy = {
        anonymous_mode: profile === "anonymous",
        peer_encryption: profile === "standard" ? "prefer" : "require",
        dht_hardening: profile !== "standard",
        enforce_private_torrents: true,
        ip_blocklist: profile !== "standard",
        kill_switch: profile !== "standard",
        bind_interface_only: profile !== "standard",
        overlay_padding: profile === "anonymous" ? "low" : profile === "hardened" ? "low" : "off",
        sybil_resistance: profile !== "standard",
        relay_pow_required: profile !== "standard",
        relay_subnet_diversity: profile !== "standard",
        relay_reputation_weighting: profile !== "standard",
        // Max Privacy settings
        ipv6_enabled: profile !== "anonymous",
        upnp_natpmp_enabled: profile !== "anonymous",
        circuit_rotation_enabled: profile === "anonymous",
        deny_direct_exits: profile === "anonymous",
        minimize_fingerprinting: profile === "anonymous",
        profile,
      };
      
      const updatedState = await patchJson<PolicyState>("/v1/policy", {
        desired_patch: profilePolicy,
      });
      
      setState(updatedState);
      return updatedState;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to apply profile";
      setError(message);
      await refresh();
      throw e;
    } finally {
      setLoading(false);
    }
  }, [online, refresh]);

  useEffect(() => {
    refresh();
    // Poll for policy updates every 5 seconds
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    state,
    error,
    loading,
    refresh,
    update,
    applyProfile,
  };
}
