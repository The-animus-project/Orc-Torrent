use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SeedingAction {
    StopTorrent,
}

impl Default for SeedingAction {
    fn default() -> Self {
        Self::StopTorrent
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SeedingSettings {
    #[serde(default)]
    pub ratio_limit_enabled: bool,
    #[serde(default = "default_ratio_limit")]
    pub ratio_limit: f64,
    #[serde(default)]
    pub seed_time_limit_enabled: bool,
    #[serde(default)]
    pub seed_time_minutes: u64,
    #[serde(default)]
    pub action: SeedingAction,
}

fn default_ratio_limit() -> f64 {
    2.0
}

impl Default for SeedingSettings {
    fn default() -> Self {
        Self {
            ratio_limit_enabled: false,
            ratio_limit: default_ratio_limit(),
            seed_time_limit_enabled: false,
            seed_time_minutes: 0,
            action: SeedingAction::default(),
        }
    }
}

impl SeedingSettings {
    pub fn validate(&self) -> anyhow::Result<()> {
        if self.ratio_limit_enabled && self.ratio_limit <= 0.0 {
            anyhow::bail!("ratio_limit must be positive when enabled");
        }
        Ok(())
    }
}

/// Returns true if seeding limits are met and torrent should be stopped.
pub fn seeding_limit_reached(
    policy: &SeedingSettings,
    uploaded_bytes: u64,
    downloaded_bytes: u64,
    seeding_started_at_ms: Option<u64>,
    now_ms: u64,
) -> Option<&'static str> {
    if policy.ratio_limit_enabled && downloaded_bytes > 0 {
        let ratio = uploaded_bytes as f64 / downloaded_bytes as f64;
        if ratio >= policy.ratio_limit {
            return Some("ratio limit reached");
        }
    }
    if policy.seed_time_limit_enabled && policy.seed_time_minutes > 0 {
        if let Some(started) = seeding_started_at_ms {
            let elapsed_min = now_ms.saturating_sub(started) / 60_000;
            if elapsed_min >= policy.seed_time_minutes {
                return Some("seed time limit reached");
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_limit_triggers_when_seeding() {
        let policy = SeedingSettings {
            ratio_limit_enabled: true,
            ratio_limit: 2.0,
            ..Default::default()
        };
        assert_eq!(
            seeding_limit_reached(&policy, 200, 100, Some(0), 1000),
            Some("ratio limit reached")
        );
    }

    #[test]
    fn ratio_limit_not_triggered_below_threshold() {
        let policy = SeedingSettings {
            ratio_limit_enabled: true,
            ratio_limit: 2.0,
            ..Default::default()
        };
        assert_eq!(
            seeding_limit_reached(&policy, 150, 100, Some(0), 1000),
            None
        );
    }

    #[test]
    fn seed_time_limit_triggers() {
        let policy = SeedingSettings {
            seed_time_limit_enabled: true,
            seed_time_minutes: 60,
            ..Default::default()
        };
        let started = 0u64;
        let now = 61 * 60_000;
        assert_eq!(
            seeding_limit_reached(&policy, 0, 100, Some(started), now),
            Some("seed time limit reached")
        );
    }

    #[test]
    fn zero_downloaded_skips_ratio() {
        let policy = SeedingSettings {
            ratio_limit_enabled: true,
            ratio_limit: 1.0,
            ..Default::default()
        };
        assert_eq!(seeding_limit_reached(&policy, 100, 0, Some(0), 1000), None);
    }
}
