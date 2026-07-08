use chrono::{Datelike, Local, NaiveTime, Weekday};
use serde::{Deserialize, Serialize};
use std::num::NonZeroU32;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BandwidthProfile {
    Normal,
    Limited,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BandwidthSettings {
    #[serde(default)]
    pub normal_download_bps: Option<u32>,
    #[serde(default)]
    pub normal_upload_bps: Option<u32>,
    #[serde(default)]
    pub limited_download_bps: Option<u32>,
    #[serde(default)]
    pub limited_upload_bps: Option<u32>,
    #[serde(default)]
    pub schedule_enabled: bool,
    #[serde(default = "default_schedule_start")]
    pub schedule_start: String,
    #[serde(default = "default_schedule_end")]
    pub schedule_end: String,
    #[serde(default = "default_schedule_days")]
    pub schedule_days: Vec<u8>,
}

fn default_schedule_start() -> String {
    "22:00".to_string()
}

fn default_schedule_end() -> String {
    "07:00".to_string()
}

fn default_schedule_days() -> Vec<u8> {
    vec![0, 1, 2, 3, 4, 5, 6]
}

impl Default for BandwidthSettings {
    fn default() -> Self {
        Self {
            normal_download_bps: None,
            normal_upload_bps: None,
            limited_download_bps: None,
            limited_upload_bps: None,
            schedule_enabled: false,
            schedule_start: default_schedule_start(),
            schedule_end: default_schedule_end(),
            schedule_days: default_schedule_days(),
        }
    }
}

impl BandwidthSettings {
    pub fn validate(&self) -> anyhow::Result<()> {
        for (label, bps) in [
            ("normal_download_bps", self.normal_download_bps),
            ("normal_upload_bps", self.normal_upload_bps),
            ("limited_download_bps", self.limited_download_bps),
            ("limited_upload_bps", self.limited_upload_bps),
        ] {
            if let Some(v) = bps {
                if v == 0 {
                    anyhow::bail!("{label} must be positive or null");
                }
            }
        }
        parse_time_hhmm(&self.schedule_start)?;
        parse_time_hhmm(&self.schedule_end)?;
        if self.schedule_enabled && self.schedule_days.is_empty() {
            anyhow::bail!("schedule_days must not be empty when schedule is enabled");
        }
        for d in &self.schedule_days {
            if *d > 6 {
                anyhow::bail!("schedule_days values must be 0-6 (Sun-Sat)");
            }
        }
        Ok(())
    }

    pub fn limits_for_profile(
        &self,
        profile: BandwidthProfile,
    ) -> (Option<NonZeroU32>, Option<NonZeroU32>) {
        let (dl, ul) = match profile {
            BandwidthProfile::Normal => (self.normal_download_bps, self.normal_upload_bps),
            BandwidthProfile::Limited => (self.limited_download_bps, self.limited_upload_bps),
        };
        (dl.and_then(NonZeroU32::new), ul.and_then(NonZeroU32::new))
    }
}

pub fn parse_time_hhmm(s: &str) -> anyhow::Result<NaiveTime> {
    NaiveTime::parse_from_str(s.trim(), "%H:%M")
        .map_err(|_| anyhow::anyhow!("invalid time '{s}', expected HH:MM"))
}

pub fn weekday_to_u8(wd: Weekday) -> u8 {
    match wd {
        Weekday::Sun => 0,
        Weekday::Mon => 1,
        Weekday::Tue => 2,
        Weekday::Wed => 3,
        Weekday::Thu => 4,
        Weekday::Fri => 5,
        Weekday::Sat => 6,
    }
}

/// Determine active bandwidth profile from local time and schedule settings.
pub fn active_bandwidth_profile(
    settings: &BandwidthSettings,
    now: chrono::DateTime<Local>,
) -> BandwidthProfile {
    if !settings.schedule_enabled {
        return BandwidthProfile::Normal;
    }
    if !settings
        .schedule_days
        .contains(&weekday_to_u8(now.weekday()))
    {
        return BandwidthProfile::Normal;
    }
    let start = parse_time_hhmm(&settings.schedule_start)
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(22, 0, 0).unwrap());
    let end = parse_time_hhmm(&settings.schedule_end)
        .unwrap_or_else(|_| NaiveTime::from_hms_opt(7, 0, 0).unwrap());
    let t = now.time();
    let in_window = if start <= end {
        t >= start && t < end
    } else {
        // overnight e.g. 22:00 - 07:00
        t >= start || t < end
    };
    if in_window {
        BandwidthProfile::Limited
    } else {
        BandwidthProfile::Normal
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn local_at(weekday: Weekday, hour: u32, minute: u32) -> chrono::DateTime<Local> {
        // pick a known date for each weekday
        let date = match weekday {
            Weekday::Mon => (2024, 1, 1),
            Weekday::Tue => (2024, 1, 2),
            Weekday::Wed => (2024, 1, 3),
            Weekday::Thu => (2024, 1, 4),
            Weekday::Fri => (2024, 1, 5),
            Weekday::Sat => (2024, 1, 6),
            Weekday::Sun => (2024, 1, 7),
        };
        Local
            .with_ymd_and_hms(date.0, date.1, date.2, hour, minute, 0)
            .unwrap()
    }

    #[test]
    fn schedule_disabled_always_normal() {
        let s = BandwidthSettings::default();
        let now = local_at(Weekday::Mon, 23, 0);
        assert_eq!(active_bandwidth_profile(&s, now), BandwidthProfile::Normal);
    }

    #[test]
    fn overnight_window_limited_at_night() {
        let s = BandwidthSettings {
            schedule_enabled: true,
            schedule_start: "22:00".into(),
            schedule_end: "07:00".into(),
            schedule_days: vec![weekday_to_u8(Weekday::Mon)],
            ..Default::default()
        };
        assert_eq!(
            active_bandwidth_profile(&s, local_at(Weekday::Mon, 23, 0)),
            BandwidthProfile::Limited
        );
    }

    #[test]
    fn overnight_window_normal_morning_after_end() {
        let s = BandwidthSettings {
            schedule_enabled: true,
            schedule_start: "22:00".into(),
            schedule_end: "07:00".into(),
            schedule_days: vec![weekday_to_u8(Weekday::Mon)],
            ..Default::default()
        };
        assert_eq!(
            active_bandwidth_profile(&s, local_at(Weekday::Mon, 8, 0)),
            BandwidthProfile::Normal
        );
    }

    #[test]
    fn same_day_window() {
        let s = BandwidthSettings {
            schedule_enabled: true,
            schedule_start: "09:00".into(),
            schedule_end: "17:00".into(),
            schedule_days: vec![weekday_to_u8(Weekday::Wed)],
            ..Default::default()
        };
        assert_eq!(
            active_bandwidth_profile(&s, local_at(Weekday::Wed, 12, 0)),
            BandwidthProfile::Limited
        );
        assert_eq!(
            active_bandwidth_profile(&s, local_at(Weekday::Wed, 18, 0)),
            BandwidthProfile::Normal
        );
    }

    #[test]
    fn wrong_day_is_normal() {
        let s = BandwidthSettings {
            schedule_enabled: true,
            schedule_start: "22:00".into(),
            schedule_end: "07:00".into(),
            schedule_days: vec![weekday_to_u8(Weekday::Tue)],
            ..Default::default()
        };
        assert_eq!(
            active_bandwidth_profile(&s, local_at(Weekday::Mon, 23, 0)),
            BandwidthProfile::Normal
        );
    }
}
