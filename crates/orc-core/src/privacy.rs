use serde::{Deserialize, Serialize};

use crate::{vpn_status, KillSwitchState, OrcState, VpnPostureState};
use orc_engine::PeerTrafficMode;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RiskState {
    Protected,
    Warning,
    Blocked,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyStatus {
    pub vpn_detected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vpn_interface: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bind_interface: Option<String>,
    pub kill_switch_enabled: bool,
    pub kill_switch_engaged: bool,
    pub network_allowed: bool,
    pub dht_enabled: bool,
    pub pex_enabled: bool,
    pub lsd_enabled: bool,
    pub tcp_enabled: bool,
    pub utp_enabled: bool,
    pub ipv4_enabled: bool,
    pub ipv6_enabled: bool,
    pub binding_strict: bool,
    pub network_suspended: bool,
    pub requested_peer_traffic_mode: PeerTrafficMode,
    pub effective_peer_traffic_mode: PeerTrafficMode,
    pub peer_traffic_mixed: bool,
    pub protected_peer_count: u32,
    pub plaintext_peer_count: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub degraded_reasons: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_ip: Option<String>,
    pub risk_state: RiskState,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivacyPresetResult {
    pub changed: Vec<String>,
    pub privacy_status: PrivacyStatus,
}

pub fn compute_privacy_status(state: &OrcState) -> PrivacyStatus {
    let vpn = vpn_status();
    let vpn_detected =
        vpn.detected == Some(true) || matches!(vpn.posture, VpnPostureState::Connected);
    let vpn_interface = vpn.interface_name.clone();
    let kill_switch_enabled = state.kill_switch.enabled;
    let kill_switch_engaged = matches!(
        state.kill_switch.enforcement_state,
        KillSwitchState::Engaged
    );
    let network_allowed = state.policy.effective.network_allowed;
    let capabilities = state.engine.capabilities();
    let dht_enabled = capabilities.discovery.dht.enabled && state.engine.api_dht_stats().is_ok();
    let pex_enabled = capabilities.discovery.pex.enabled;
    let lsd_enabled = capabilities.discovery.lsd.enabled;
    let peer_encryption = &capabilities.security.peer_encryption;

    let (risk_state, reason) = compute_risk_state(
        vpn_detected,
        vpn.detected,
        kill_switch_enabled,
        kill_switch_engaged,
        network_allowed,
        state.bind_interface.is_some(),
        state.leak_proof_enabled,
    );

    PrivacyStatus {
        vpn_detected,
        vpn_interface,
        bind_interface: state.bind_interface.clone(),
        kill_switch_enabled,
        kill_switch_engaged,
        network_allowed,
        dht_enabled,
        pex_enabled,
        lsd_enabled,
        tcp_enabled: capabilities.transports.tcp.enabled,
        utp_enabled: capabilities.transports.utp.enabled,
        ipv4_enabled: capabilities.transports.ipv4.enabled,
        ipv6_enabled: capabilities.transports.ipv6.enabled,
        binding_strict: state.policy.effective.engine.strict_binding,
        network_suspended: capabilities.network_suspended,
        requested_peer_traffic_mode: peer_encryption.requested_mode,
        effective_peer_traffic_mode: peer_encryption.effective_mode,
        peer_traffic_mixed: peer_encryption.live_rc4_peers > 0
            && peer_encryption.live_plaintext_peers > 0,
        protected_peer_count: peer_encryption.live_rc4_peers,
        plaintext_peer_count: peer_encryption.live_plaintext_peers,
        degraded_reasons: capabilities.degraded_reasons,
        public_ip: None,
        risk_state,
        reason,
    }
}

pub fn compute_risk_state(
    vpn_detected: bool,
    vpn_detected_opt: Option<bool>,
    kill_switch_enabled: bool,
    kill_switch_engaged: bool,
    network_allowed: bool,
    bind_interface_set: bool,
    leak_proof_enabled: bool,
) -> (RiskState, String) {
    if kill_switch_engaged || !network_allowed {
        return (
            RiskState::Blocked,
            "Kill switch active, torrents paused".to_string(),
        );
    }
    if vpn_detected_opt.is_none() {
        return (
            RiskState::Unknown,
            "VPN status could not be determined".to_string(),
        );
    }
    if (vpn_detected && kill_switch_enabled) || (bind_interface_set && network_allowed) {
        return (
            RiskState::Protected,
            if vpn_detected && kill_switch_enabled {
                "VPN detected and kill switch enabled".to_string()
            } else {
                "Bind interface configured".to_string()
            },
        );
    }
    if leak_proof_enabled && !vpn_detected {
        return (
            RiskState::Warning,
            "Leak protection enabled but VPN not detected".to_string(),
        );
    }
    if !vpn_detected {
        return (RiskState::Warning, "VPN not detected".to_string());
    }
    (
        RiskState::Warning,
        "Privacy settings are partially configured".to_string(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocked_when_kill_switch_engaged() {
        let (state, reason) = compute_risk_state(true, Some(true), true, true, false, false, false);
        assert_eq!(state, RiskState::Blocked);
        assert!(reason.contains("Kill switch"));
    }

    #[test]
    fn protected_vpn_and_kill_switch() {
        let (state, reason) = compute_risk_state(true, Some(true), true, false, true, false, false);
        assert_eq!(state, RiskState::Protected);
        assert!(reason.contains("VPN detected"));
    }

    #[test]
    fn warning_no_vpn() {
        let (state, _) = compute_risk_state(false, Some(false), false, false, true, false, false);
        assert_eq!(state, RiskState::Warning);
    }

    #[test]
    fn protected_bind_only() {
        let (state, reason) =
            compute_risk_state(false, Some(false), false, false, true, true, false);
        assert_eq!(state, RiskState::Protected);
        assert!(reason.contains("Bind interface"));
    }

    #[test]
    fn warning_leak_proof_without_vpn() {
        let (state, reason) =
            compute_risk_state(false, Some(false), false, false, true, false, true);
        assert_eq!(state, RiskState::Warning);
        assert!(reason.contains("Leak protection"));
    }

    #[test]
    fn unknown_when_detection_inconclusive() {
        let (state, _) = compute_risk_state(false, None, false, false, true, false, false);
        assert_eq!(state, RiskState::Unknown);
    }
}
