use orc_scheduler::{Block, PeerScheduler, SchedulerMode, BLOCK_BYTES};

#[derive(Clone, Copy)]
struct Profile {
    name: &'static str,
    rtt_ms: u64,
    bytes_per_second: u64,
    timeout_every: Option<u32>,
}

fn simulate(profile: Profile, mode: SchedulerMode) -> (u64, u64, u16, u64) {
    let mut scheduler = PeerScheduler::new(mode, 1_000);
    scheduler.set_choked(false, 0);
    let mut now = 0u64;
    let mut sequence = 0u32;
    const TOTAL_BLOCKS: u32 = 4_096;
    while sequence < TOTAL_BLOCKS {
        let window = scheduler
            .target_pipeline_requests()
            .min((TOTAL_BLOCKS - sequence) as u16) as u32;
        let sent_at = now;
        let batch: Vec<_> = (0..window)
            .map(|index| {
                let id = sequence + index;
                let block = Block {
                    piece: id / 16,
                    offset: (id % 16) * BLOCK_BYTES,
                    length: BLOCK_BYTES,
                };
                scheduler.on_request(block, sent_at);
                block
            })
            .collect();
        let serialization_ms =
            window as u64 * BLOCK_BYTES as u64 * 1_000 / profile.bytes_per_second.max(1);
        now += profile.rtt_ms + serialization_ms.max(1);
        for (index, block) in batch.into_iter().enumerate() {
            let id = sequence + index as u32;
            if profile
                .timeout_every
                .is_some_and(|each| id > 0 && id.is_multiple_of(each))
            {
                continue;
            }
            scheduler.on_block_received(block, now);
        }
        if scheduler.metrics(now).outstanding_requests > 0 {
            now = now.max(sent_at + scheduler.stall_timeout_ms());
            scheduler.take_stalled(now);
        }
        sequence += window;
    }
    let metrics = scheduler.metrics(now);
    (
        now,
        TOTAL_BLOCKS as u64 * BLOCK_BYTES as u64 * 1_000 / now.max(1),
        metrics.target_pipeline_requests,
        metrics.timeout_events,
    )
}

fn main() {
    let profiles = [
        Profile {
            name: "lan_seed",
            rtt_ms: 2,
            bytes_per_second: 200_000_000,
            timeout_every: None,
        },
        Profile {
            name: "wan_seed",
            rtt_ms: 80,
            bytes_per_second: 25_000_000,
            timeout_every: None,
        },
        Profile {
            name: "mobile_partial",
            rtt_ms: 180,
            bytes_per_second: 3_000_000,
            timeout_every: Some(17),
        },
        Profile {
            name: "lossy_endgame",
            rtt_ms: 120,
            bytes_per_second: 8_000_000,
            timeout_every: Some(7),
        },
    ];
    println!("profile,mode,elapsed_ms,throughput_bytes_per_second,target_requests,timeouts");
    for profile in profiles {
        for mode in [SchedulerMode::Legacy, SchedulerMode::Adaptive] {
            let (elapsed_ms, throughput, target, timeouts) = simulate(profile, mode);
            println!(
                "{},{:?},{},{},{},{}",
                profile.name, mode, elapsed_ms, throughput, target, timeouts
            );
        }
    }
}
