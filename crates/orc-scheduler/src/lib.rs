//! ORC-owned request scheduling primitives.
//!
//! This crate deliberately has no dependency on the private transfer backend. Wire transports
//! report observations here and consume scheduling decisions through stable ORC types.

use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};

use serde::{Deserialize, Serialize};

pub const BLOCK_BYTES: u32 = 16 * 1024;
pub const LEGACY_PIPELINE_REQUESTS: u16 = 128;
const MIN_PIPELINE_REQUESTS: u16 = 2;
const MAX_PIPELINE_REQUESTS: u16 = 128;
const COLD_PIPELINE_REQUESTS: u16 = 8;
const MAX_FAST_PIECES: usize = 64;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchedulerMode {
    #[default]
    Legacy,
    Adaptive,
}

#[derive(Debug, Clone, Copy, Hash, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Block {
    pub piece: u32,
    pub offset: u32,
    pub length: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Outstanding {
    sent_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PeerMetrics {
    pub rtt_ms: Option<u64>,
    pub goodput_bytes_per_second: u64,
    pub choke_events: u64,
    pub choke_ratio: f64,
    pub reject_events: u64,
    pub reject_ratio: f64,
    pub timeout_events: u64,
    pub consecutive_timeouts: u32,
    pub available_pieces: u32,
    pub total_pieces: u32,
    pub availability_ratio: f64,
    pub outstanding_requests: u16,
    pub outstanding_bytes: u64,
    pub target_pipeline_requests: u16,
    pub target_pipeline_bytes: u64,
    pub stalled_reassignments: u64,
    pub supports_fast_extension: bool,
    pub choked: bool,
}

/// Adaptive state for one peer connection.
pub struct PeerScheduler {
    mode: SchedulerMode,
    rtt_ms: Option<f64>,
    goodput_bps: f64,
    delivery_epoch_ms: Option<u64>,
    delivery_epoch_bytes: u64,
    completed_requests: u64,
    choke_events: u64,
    choked_since_ms: Option<u64>,
    total_observed_ms: u64,
    total_choked_ms: u64,
    reject_events: u64,
    timeout_events: u64,
    consecutive_timeouts: u32,
    available_pieces: u32,
    total_pieces: u32,
    outstanding_bytes: u64,
    outstanding: BTreeMap<Block, Outstanding>,
    stalled_reassignments: u64,
    supports_fast_extension: bool,
    choked: bool,
    allowed_fast: BTreeSet<u32>,
    suggested: VecDeque<u32>,
}

impl PeerScheduler {
    pub fn new(mode: SchedulerMode, total_pieces: u32) -> Self {
        Self {
            mode,
            rtt_ms: None,
            goodput_bps: 0.0,
            delivery_epoch_ms: None,
            delivery_epoch_bytes: 0,
            completed_requests: 0,
            choke_events: 0,
            choked_since_ms: None,
            total_observed_ms: 0,
            total_choked_ms: 0,
            reject_events: 0,
            timeout_events: 0,
            consecutive_timeouts: 0,
            available_pieces: 0,
            total_pieces,
            outstanding_bytes: 0,
            outstanding: BTreeMap::new(),
            stalled_reassignments: 0,
            supports_fast_extension: false,
            choked: true,
            allowed_fast: BTreeSet::new(),
            suggested: VecDeque::new(),
        }
    }

    pub fn mode(&self) -> SchedulerMode {
        self.mode
    }

    pub fn set_mode(&mut self, mode: SchedulerMode) {
        self.mode = mode;
    }

    pub fn set_fast_extension(&mut self, supported: bool) {
        self.supports_fast_extension = supported;
        if !supported {
            self.allowed_fast.clear();
            self.suggested.clear();
        }
    }

    pub fn set_choked(&mut self, choked: bool, now_ms: u64) {
        if self.choked == choked {
            return;
        }
        self.choked = choked;
        if choked {
            self.choke_events += 1;
            self.choked_since_ms = Some(now_ms);
        } else if let Some(started) = self.choked_since_ms.take() {
            self.total_choked_ms = self
                .total_choked_ms
                .saturating_add(now_ms.saturating_sub(started));
        }
        self.total_observed_ms = self.total_observed_ms.max(now_ms);
    }

    pub fn set_have_all(&mut self) {
        self.available_pieces = self.total_pieces;
    }

    pub fn set_have_none(&mut self) {
        self.available_pieces = 0;
    }

    pub fn set_available_pieces(&mut self, count: u32) {
        self.available_pieces = count.min(self.total_pieces);
    }

    pub fn note_have(&mut self) {
        self.available_pieces = self
            .available_pieces
            .saturating_add(1)
            .min(self.total_pieces);
    }

    pub fn allow_fast(&mut self, piece: u32) {
        if piece < self.total_pieces && self.allowed_fast.len() < MAX_FAST_PIECES {
            self.allowed_fast.insert(piece);
        }
    }

    pub fn is_allowed_fast(&self, piece: u32) -> bool {
        self.supports_fast_extension && self.allowed_fast.contains(&piece)
    }

    pub fn can_request_piece(&self, piece: u32) -> bool {
        !self.choked || self.is_allowed_fast(piece)
    }

    pub fn suggest_piece(&mut self, piece: u32) {
        if piece >= self.total_pieces || self.suggested.contains(&piece) {
            return;
        }
        if self.suggested.len() == MAX_FAST_PIECES {
            self.suggested.pop_front();
        }
        self.suggested.push_back(piece);
    }

    pub fn take_suggested_piece(&mut self) -> Option<u32> {
        self.suggested.pop_front()
    }

    pub fn on_request(&mut self, block: Block, now_ms: u64) -> bool {
        if self.outstanding.contains_key(&block) {
            return false;
        }
        self.outstanding_bytes = self.outstanding_bytes.saturating_add(block.length as u64);
        self.outstanding
            .insert(block, Outstanding { sent_at_ms: now_ms });
        true
    }

    /// Records a successful response and returns its measured request RTT.
    pub fn on_block_received(&mut self, block: Block, now_ms: u64) -> Option<u64> {
        let outstanding = self.outstanding.remove(&block)?;
        self.outstanding_bytes = self.outstanding_bytes.saturating_sub(block.length as u64);
        let sample_ms = now_ms.saturating_sub(outstanding.sent_at_ms).max(1);
        self.rtt_ms = Some(ewma(self.rtt_ms, sample_ms as f64, 0.2));
        match self.delivery_epoch_ms {
            None => {
                self.delivery_epoch_ms = Some(now_ms);
                self.delivery_epoch_bytes = block.length as u64;
            }
            Some(epoch) if epoch == now_ms => {
                self.delivery_epoch_bytes = self
                    .delivery_epoch_bytes
                    .saturating_add(block.length as u64);
            }
            Some(epoch) => {
                let elapsed = now_ms.saturating_sub(epoch).max(1);
                let sample_bps = self.delivery_epoch_bytes as f64 * 1000.0 / elapsed as f64;
                self.goodput_bps = ewma_nonzero(self.goodput_bps, sample_bps, 0.2);
                self.delivery_epoch_ms = Some(now_ms);
                self.delivery_epoch_bytes = block.length as u64;
            }
        }
        self.completed_requests += 1;
        self.consecutive_timeouts = 0;
        self.total_observed_ms = self.total_observed_ms.max(now_ms);
        Some(sample_ms)
    }

    /// A rejection is immediately removed so another peer can own the block.
    pub fn on_reject(&mut self, block: Block) -> bool {
        let Some(_) = self.outstanding.remove(&block) else {
            return false;
        };
        self.outstanding_bytes = self.outstanding_bytes.saturating_sub(block.length as u64);
        self.reject_events += 1;
        true
    }

    pub fn stall_timeout_ms(&self) -> u64 {
        let based_on_rtt = self.rtt_ms.unwrap_or(1_000.0) * 4.0;
        based_on_rtt.clamp(2_000.0, 15_000.0) as u64
    }

    /// Removes timed-out blocks and returns them for immediate reassignment.
    pub fn take_stalled(&mut self, now_ms: u64) -> Vec<Block> {
        let deadline = self.stall_timeout_ms();
        let stalled: Vec<_> = self
            .outstanding
            .iter()
            .filter(|(_, request)| now_ms.saturating_sub(request.sent_at_ms) >= deadline)
            .map(|(block, _)| *block)
            .collect();
        for block in &stalled {
            self.outstanding.remove(block);
            self.outstanding_bytes = self.outstanding_bytes.saturating_sub(block.length as u64);
        }
        if !stalled.is_empty() {
            self.timeout_events += stalled.len() as u64;
            self.stalled_reassignments += stalled.len() as u64;
            // A batch of simultaneously expired blocks is one timeout episode, not N
            // consecutive failures. Penalizing by block count collapses lossy high-BDP peers.
            self.consecutive_timeouts = self.consecutive_timeouts.saturating_add(1);
        }
        stalled
    }

    pub fn target_pipeline_requests(&self) -> u16 {
        if self.mode == SchedulerMode::Legacy {
            return LEGACY_PIPELINE_REQUESTS;
        }
        let (Some(rtt_ms), goodput) = (self.rtt_ms, self.goodput_bps) else {
            return COLD_PIPELINE_REQUESTS;
        };
        if goodput <= 0.0 {
            return COLD_PIPELINE_REQUESTS;
        }
        // Two bandwidth-delay products keep the connection busy while bounding queueing.
        let target_bytes = goodput * (rtt_ms.max(25.0) / 1000.0) * 2.0;
        let target = (target_bytes / BLOCK_BYTES as f64).ceil() as u16;
        let timeout_penalty = self.consecutive_timeouts.min(3);
        (target >> timeout_penalty).clamp(MIN_PIPELINE_REQUESTS, MAX_PIPELINE_REQUESTS)
    }

    pub fn available_request_slots(&self) -> u16 {
        if self.choked && self.allowed_fast.is_empty() {
            return 0;
        }
        self.target_pipeline_requests()
            .saturating_sub(self.outstanding.len().try_into().unwrap_or(u16::MAX))
    }

    pub fn metrics(&self, now_ms: u64) -> PeerMetrics {
        let live_choked = self
            .choked_since_ms
            .map(|start| now_ms.saturating_sub(start))
            .unwrap_or_default();
        let observed = self.total_observed_ms.max(now_ms).max(1);
        let target = self.target_pipeline_requests();
        let requests = self.completed_requests + self.reject_events + self.timeout_events;
        PeerMetrics {
            rtt_ms: self.rtt_ms.map(|v| v.round() as u64),
            goodput_bytes_per_second: self.goodput_bps.round() as u64,
            choke_events: self.choke_events,
            choke_ratio: (self.total_choked_ms + live_choked) as f64 / observed as f64,
            reject_events: self.reject_events,
            reject_ratio: if requests == 0 {
                0.0
            } else {
                self.reject_events as f64 / requests as f64
            },
            timeout_events: self.timeout_events,
            consecutive_timeouts: self.consecutive_timeouts,
            available_pieces: self.available_pieces,
            total_pieces: self.total_pieces,
            availability_ratio: if self.total_pieces == 0 {
                0.0
            } else {
                self.available_pieces as f64 / self.total_pieces as f64
            },
            outstanding_requests: self.outstanding.len().try_into().unwrap_or(u16::MAX),
            outstanding_bytes: self.outstanding_bytes,
            target_pipeline_requests: target,
            target_pipeline_bytes: target as u64 * BLOCK_BYTES as u64,
            stalled_reassignments: self.stalled_reassignments,
            supports_fast_extension: self.supports_fast_extension,
            choked: self.choked,
        }
    }
}

fn ewma(previous: Option<f64>, sample: f64, alpha: f64) -> f64 {
    previous.map_or(sample, |old| old * (1.0 - alpha) + sample * alpha)
}

fn ewma_nonzero(previous: f64, sample: f64, alpha: f64) -> f64 {
    if previous == 0.0 {
        sample
    } else {
        previous * (1.0 - alpha) + sample * alpha
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EndgameConfig {
    pub enter_at_remaining_blocks: u32,
    pub max_copies_per_block: u8,
}

impl Default for EndgameConfig {
    fn default() -> Self {
        Self {
            enter_at_remaining_blocks: 32,
            max_copies_per_block: 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssignmentDecision {
    Primary,
    Duplicate,
    AtCapacity,
}

/// Torrent-wide bounded endgame ownership. `PeerKey` is assigned by the adapter.
pub struct EndgameCoordinator {
    config: EndgameConfig,
    remaining_blocks: u32,
    assignments: HashMap<Block, BTreeSet<u64>>,
}

impl EndgameCoordinator {
    pub fn new(config: EndgameConfig) -> Self {
        Self {
            config,
            remaining_blocks: u32::MAX,
            assignments: HashMap::new(),
        }
    }

    pub fn set_remaining_blocks(&mut self, remaining: u32) {
        self.remaining_blocks = remaining;
    }

    pub fn is_active(&self) -> bool {
        self.remaining_blocks <= self.config.enter_at_remaining_blocks
    }

    pub fn assign(&mut self, peer: u64, block: Block) -> AssignmentDecision {
        let endgame_active = self.is_active();
        let peers = self.assignments.entry(block).or_default();
        if peers.contains(&peer)
            || (!peers.is_empty() && !endgame_active)
            || peers.len() >= self.config.max_copies_per_block as usize
        {
            return AssignmentDecision::AtCapacity;
        }
        let decision = if peers.is_empty() {
            AssignmentDecision::Primary
        } else {
            AssignmentDecision::Duplicate
        };
        peers.insert(peer);
        decision
    }

    /// Completes a block and returns every other peer that must be cancelled immediately.
    pub fn complete(&mut self, winner: u64, block: Block) -> Vec<u64> {
        self.remaining_blocks = self.remaining_blocks.saturating_sub(1);
        self.assignments
            .remove(&block)
            .into_iter()
            .flatten()
            .filter(|peer| *peer != winner)
            .collect()
    }

    /// Completes the duplicated piece and returns every losing peer once. The backend uses this
    /// to cancel the rest of the piece immediately after the first useful block wins the race.
    pub fn complete_piece(&mut self, winner: u64, piece: u32) -> Vec<u64> {
        let blocks: Vec<_> = self
            .assignments
            .keys()
            .filter(|block| block.piece == piece)
            .copied()
            .collect();
        let mut losers = BTreeSet::new();
        for block in blocks {
            if let Some(peers) = self.assignments.remove(&block) {
                losers.extend(peers.into_iter().filter(|peer| *peer != winner));
            }
        }
        losers.into_iter().collect()
    }

    /// Removes a rejected/stalled assignment. The remaining assignment count drives reassignment.
    pub fn release(&mut self, peer: u64, block: Block) -> usize {
        let Some(peers) = self.assignments.get_mut(&block) else {
            return 0;
        };
        peers.remove(&peer);
        let remaining = peers.len();
        if remaining == 0 {
            self.assignments.remove(&block);
        }
        remaining
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn block(piece: u32, offset: u32) -> Block {
        Block {
            piece,
            offset,
            length: BLOCK_BYTES,
        }
    }

    #[test]
    fn adaptive_pipeline_tracks_bdp_and_penalizes_timeouts() {
        let mut scheduler = PeerScheduler::new(SchedulerMode::Adaptive, 100);
        scheduler.set_choked(false, 0);
        for n in 0..8 {
            let b = block(0, n * BLOCK_BYTES);
            assert!(scheduler.on_request(b, n as u64));
            scheduler.on_block_received(b, 101 + n as u64).unwrap();
        }
        let target = scheduler.target_pipeline_requests();
        assert!((COLD_PIPELINE_REQUESTS..=MAX_PIPELINE_REQUESTS).contains(&target));
        let stalled = block(1, 0);
        scheduler.on_request(stalled, 0);
        assert_eq!(scheduler.take_stalled(2_000), vec![stalled]);
        assert!(scheduler.target_pipeline_requests() <= target);
    }

    #[test]
    fn reject_releases_outstanding_immediately() {
        let mut scheduler = PeerScheduler::new(SchedulerMode::Adaptive, 10);
        let b = block(3, 0);
        scheduler.on_request(b, 10);
        assert!(scheduler.on_reject(b));
        let metrics = scheduler.metrics(11);
        assert_eq!(metrics.outstanding_bytes, 0);
        assert_eq!(metrics.reject_events, 1);
    }

    #[test]
    fn choked_peer_can_only_use_allowed_fast_set() {
        let mut scheduler = PeerScheduler::new(SchedulerMode::Adaptive, 10);
        scheduler.set_fast_extension(true);
        scheduler.allow_fast(4);
        assert!(scheduler.can_request_piece(4));
        assert!(!scheduler.can_request_piece(5));
        scheduler.set_choked(false, 5);
        assert!(scheduler.can_request_piece(5));
    }

    #[test]
    fn endgame_is_bounded_and_cancels_losers() {
        let mut endgame = EndgameCoordinator::new(EndgameConfig::default());
        let b = block(9, 0);
        endgame.set_remaining_blocks(2);
        assert_eq!(endgame.assign(1, b), AssignmentDecision::Primary);
        assert_eq!(endgame.assign(2, b), AssignmentDecision::Duplicate);
        assert_eq!(endgame.assign(3, b), AssignmentDecision::AtCapacity);
        assert_eq!(endgame.complete(2, b), vec![1]);
    }

    #[test]
    fn first_piece_block_cancels_all_duplicate_assignments() {
        let mut endgame = EndgameCoordinator::new(EndgameConfig::default());
        endgame.set_remaining_blocks(2);
        for b in [block(9, 0), block(9, BLOCK_BYTES)] {
            endgame.assign(1, b);
            endgame.assign(2, b);
        }
        assert_eq!(endgame.complete_piece(2, 9), vec![1]);
        assert!(endgame.assign(3, block(9, 0)) != AssignmentDecision::AtCapacity);
    }

    #[test]
    fn legacy_mode_stays_fixed_until_promotion() {
        let scheduler = PeerScheduler::new(SchedulerMode::Legacy, 1);
        assert_eq!(
            scheduler.target_pipeline_requests(),
            LEGACY_PIPELINE_REQUESTS
        );
    }
}
