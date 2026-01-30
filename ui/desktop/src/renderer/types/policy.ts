// Shared policy types - matches Rust daemon policy system
// UI expresses Desired, daemon computes Effective

export type TriState = "off" | "prefer" | "require";
export type PaddingLevel = "off" | "low" | "high";
export type PolicyProfile = "standard" | "hardened" | "anonymous";

export type DesiredPolicy = {
  anonymous_mode: boolean;
  peer_encryption: TriState;          // BEP 3/4
  dht_hardening: boolean;             // BEP 42
  enforce_private_torrents: boolean;
  ip_blocklist: boolean;
  kill_switch: boolean;
  bind_interface_only: boolean;
  overlay_padding: PaddingLevel;
  sybil_resistance: boolean;
  relay_pow_required: boolean;
  relay_subnet_diversity: boolean;
  relay_reputation_weighting: boolean;
  // Max Privacy settings
  ipv6_enabled: boolean;
  upnp_natpmp_enabled: boolean;
  circuit_rotation_enabled: boolean;
  deny_direct_exits: boolean;
  minimize_fingerprinting: boolean;
  profile: PolicyProfile | null;     // null = custom, else applies preset
};

export type EffectivePolicy = {
  // All desired fields (using snake_case to match Rust)
  anonymous_mode: boolean;
  peer_encryption: TriState;
  dht_hardening: boolean;
  enforce_private_torrents: boolean;
  ip_blocklist: boolean;
  kill_switch: boolean;
  bind_interface_only: boolean;
  overlay_padding: PaddingLevel;
  sybil_resistance: boolean;
  relay_pow_required: boolean;
  relay_subnet_diversity: boolean;
  relay_reputation_weighting: boolean;
  // Max Privacy settings
  ipv6_enabled: boolean;
  upnp_natpmp_enabled: boolean;
  circuit_rotation_enabled: boolean;
  deny_direct_exits: boolean;
  minimize_fingerprinting: boolean;
  profile: PolicyProfile | null;
  // Derived flags computed by daemon
  network_allowed: boolean;           // false when kill switch trips
  discovery_allowed: boolean;         // disabled under private torrents / anon mode rules
  direct_peer_allowed: boolean;        // false when anonymous mode enabled
};

export type PolicyWarning = {
  code: string;
  message: string;
  severity: "info" | "warn" | "block";
};

export type ToggleDisabled = {
  disabled: boolean;
  reason?: string;
};

export type PolicyState = {
  desired: DesiredPolicy;
  effective: EffectivePolicy;
  warnings: PolicyWarning[];
  disabled: Record<keyof DesiredPolicy, ToggleDisabled>;
  version: number;
  lastUpdatedMs: number;
};
