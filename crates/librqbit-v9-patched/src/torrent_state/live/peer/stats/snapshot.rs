use std::{collections::HashMap, sync::atomic::Ordering};

use orc_mse::TrafficProtection;
use serde::{Deserialize, Serialize};

use crate::{
    stream_connect::ConnectionKind,
    torrent_state::live::peer::{Peer, PeerState},
};

#[derive(Serialize, Deserialize)]
pub struct PeerCounters {
    pub incoming_connections: u32,
    pub fetched_bytes: u64,
    pub uploaded_bytes: u64,
    pub total_time_connecting_ms: u64,
    pub connection_attempts: u32,
    pub connections: u32,
    pub errors: u32,
    pub fetched_chunks: u32,
    pub downloaded_and_checked_pieces: u32,
    pub total_piece_download_ms: u64,
    pub times_stolen_from_me: u32,
    pub times_i_stole: u32,
    pub request_rtt_ms: Option<u64>,
    pub goodput_bytes_per_second: u64,
    pub choke_events: u64,
    pub choke_rate: f64,
    pub reject_events: u64,
    pub reject_rate: f64,
    pub timeout_events: u64,
    pub consecutive_timeouts: u32,
    pub available_pieces: u32,
    pub total_pieces: u32,
    pub outstanding_bytes: u64,
    pub outstanding_requests: u32,
    pub target_pipeline_requests: u32,
    pub stalled_reassignments: u64,
}

#[derive(Serialize)]
pub struct PeerStats {
    pub counters: PeerCounters,
    pub state: &'static str,
    pub conn_kind: Option<ConnectionKind>,
    pub traffic_protection: Option<TrafficProtection>,
}

impl From<&super::atomic::PeerCountersAtomic> for PeerCounters {
    fn from(counters: &super::atomic::PeerCountersAtomic) -> Self {
        Self {
            incoming_connections: counters.incoming_connections.load(Ordering::Relaxed),
            fetched_bytes: counters.fetched_bytes.load(Ordering::Relaxed),
            uploaded_bytes: counters.uploaded_bytes.load(Ordering::Relaxed),
            total_time_connecting_ms: counters.total_time_connecting_ms.load(Ordering::Relaxed),
            connection_attempts: counters
                .outgoing_connection_attempts
                .load(Ordering::Relaxed),
            connections: counters.outgoing_connections.load(Ordering::Relaxed),
            errors: counters.errors.load(Ordering::Relaxed),
            fetched_chunks: counters.fetched_chunks.load(Ordering::Relaxed),
            downloaded_and_checked_pieces: counters
                .downloaded_and_checked_pieces
                .load(Ordering::Relaxed),
            total_piece_download_ms: counters.total_piece_download_ms.load(Ordering::Relaxed),
            times_i_stole: counters.times_i_stole.load(Ordering::Relaxed),
            times_stolen_from_me: counters.times_stolen_from_me.load(Ordering::Relaxed),
            request_rtt_ms: match counters.scheduler_rtt_ms.load(Ordering::Relaxed) {
                0 => None,
                value => Some(value),
            },
            goodput_bytes_per_second: counters.scheduler_goodput_bps.load(Ordering::Relaxed),
            choke_events: counters.scheduler_choke_events.load(Ordering::Relaxed),
            choke_rate: counters.scheduler_choke_ratio_ppm.load(Ordering::Relaxed) as f64
                / 1_000_000.0,
            reject_events: counters.scheduler_reject_events.load(Ordering::Relaxed),
            reject_rate: counters.scheduler_reject_ratio_ppm.load(Ordering::Relaxed) as f64
                / 1_000_000.0,
            timeout_events: counters.scheduler_timeout_events.load(Ordering::Relaxed),
            consecutive_timeouts: counters
                .scheduler_consecutive_timeouts
                .load(Ordering::Relaxed),
            available_pieces: counters.scheduler_available_pieces.load(Ordering::Relaxed),
            total_pieces: counters.scheduler_total_pieces.load(Ordering::Relaxed),
            outstanding_bytes: counters.scheduler_outstanding_bytes.load(Ordering::Relaxed),
            outstanding_requests: counters
                .scheduler_outstanding_requests
                .load(Ordering::Relaxed),
            target_pipeline_requests: counters.scheduler_target_requests.load(Ordering::Relaxed),
            stalled_reassignments: counters
                .scheduler_stalled_reassignments
                .load(Ordering::Relaxed),
        }
    }
}

impl From<&Peer> for PeerStats {
    fn from(peer: &Peer) -> Self {
        let state = peer.get_state();
        Self {
            counters: peer.stats.counters.as_ref().into(),
            state: state.name(),
            conn_kind: match state {
                PeerState::Live(l) => Some(l.connection_kind),
                _ => None,
            },
            traffic_protection: match state {
                PeerState::Live(l) => Some(l.traffic_protection),
                _ => None,
            },
        }
    }
}

#[derive(Serialize)]
pub struct PeerStatsSnapshot {
    pub peers: HashMap<String, PeerStats>,
}

#[derive(Clone, Copy, Default, Deserialize)]
pub enum PeerStatsFilterState {
    #[serde(rename = "all")]
    All,
    #[default]
    #[serde(rename = "live")]
    Live,
}

impl PeerStatsFilterState {
    pub(crate) fn matches(&self, s: &PeerState) -> bool {
        matches!((self, s), (Self::All, _) | (Self::Live, PeerState::Live(_)))
    }
}

#[derive(Default, Deserialize)]
pub struct PeerStatsFilter {
    #[serde(default)]
    pub state: PeerStatsFilterState,
}
