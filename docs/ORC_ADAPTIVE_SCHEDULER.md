# ORC adaptive request scheduler

ORC owns the request-scheduling contract in `crates/orc-scheduler`. The crate is independent of
the rqbit-derived backend and contains per-peer pipeline control plus the torrent-wide bounded
endgame coordinator.

The persisted modes are `legacy` and `adaptive`. `legacy` remains the default for this milestone.
Promotion requires the deterministic profiles below plus cross-platform transfer tests to show no
critical connectivity or throughput regression.

Run the deterministic comparison from `crates/`:

```text
cargo run -p orc-scheduler --bin scheduler-bench --release
```

The harness compares the fixed 128-request legacy pipeline with adaptive bandwidth-delay-product
windowing under four reproducible profiles: LAN seed, WAN seed, mobile partial seed, and lossy
endgame. It prints elapsed time, modeled throughput, final pipeline size, and timeout count as CSV.
It uses no network and no random input, so changes are directly comparable in CI.

Adaptive scheduling records request RTT, delivered goodput, choke and reject rates, timeout
history, availability, and outstanding bytes. A rejected or timed-out request is released
immediately. Endgame duplication begins at 32 remaining blocks, permits at most two copies of a
block, and cancels every losing request as soon as the first useful block wins.

BEP 6 support covers `suggest piece`, `have all`, `have none`, `reject request`, and `allowed fast`.
Suggestions are preferred during piece selection; `allowed fast` is the only way an advertised
piece may be requested while choked; and explicit rejection bypasses timeout-based recovery.
