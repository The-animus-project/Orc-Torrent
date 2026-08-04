use anyhow::{anyhow, Result};
use orc_engine::AddTorrentOptions;

use crate::TorrentFileEntry;

const MEDIA_EXTENSIONS: &[&str] = &[
    "mkv", "mp4", "avi", "mov", "wmv", "m4v", "webm", "mpg", "mpeg", "ts", "m2ts", "flv", "ogv",
    "3gp", "vob", "mp3", "flac", "aac", "ogg", "opus", "m4a", "wav", "wma", "ape",
];

const SUBTITLE_EXTENSIONS: &[&str] = &[
    "srt", "sub", "ssa", "ass", "vtt", "sup", "idx", "sbv", "smi", "mpl",
];

const ARCHIVE_EXTENSIONS: &[&str] = &["rar", "zip", "7z", "001"];

const EXECUTABLE_EXTENSIONS: &[&str] = &[
    "exe", "msi", "bat", "cmd", "com", "scr", "pif", "app", "deb", "rpm", "apk", "jar", "vbs",
    "ps1", "sh", "run", "pkg", "dmg", "dll", "sys", "drv", "cpl", "inf", "reg", "hta", "wsf",
    "lnk", "iso",
];

pub const MEDIA_ONLY_FILES_REGEX: &str = r"(?i)(\.(mkv|mp4|avi|mov|wmv|m4v|webm|mpg|mpeg|ts|m2ts|flv|ogv|3gp|vob|mp3|flac|aac|ogg|opus|m4a|wav|wma|ape|srt|sub|ssa|ass|vtt|sup|idx|sbv|smi|mpl|rar|zip|7z|001)|\.r\d{2})$";

pub fn build_add_torrent_options(output_folder: Option<String>) -> AddTorrentOptions {
    let mut opts = AddTorrentOptions {
        output_folder,
        overwrite: true,
        ..Default::default()
    };
    if media_download_policy_enabled() {
        opts.only_files_regex = Some(MEDIA_ONLY_FILES_REGEX.to_string());
    }
    opts
}

pub fn is_animus_product_edition() -> bool {
    std::env::var("ORC_TORRENT_EDITION")
        .map(|value| value.eq_ignore_ascii_case("animus"))
        .unwrap_or(false)
}

pub fn media_download_policy_enabled() -> bool {
    is_animus_product_edition()
}

fn file_name_from_path(path: &[String]) -> String {
    path.last()
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_default()
}

fn extension_of(file_name: &str) -> Option<String> {
    let base = file_name.rsplit('/').next().unwrap_or(file_name);
    let dot = base.rfind('.')?;
    if dot + 1 >= base.len() {
        return None;
    }
    Some(base[dot + 1..].to_ascii_lowercase())
}

fn is_rar_part_extension(ext: &str) -> bool {
    ext.len() == 3 && ext.starts_with('r') && ext.chars().skip(1).all(|ch| ch.is_ascii_digit())
}

pub fn is_download_allowed_for_path(path: &[String]) -> bool {
    let name = file_name_from_path(path);
    if name.is_empty() {
        return false;
    }

    let Some(ext) = extension_of(&name) else {
        return false;
    };

    if EXECUTABLE_EXTENSIONS.contains(&ext.as_str()) {
        return false;
    }
    if is_rar_part_extension(&ext) {
        return true;
    }

    if MEDIA_EXTENSIONS.contains(&ext.as_str())
        || SUBTITLE_EXTENSIONS.contains(&ext.as_str())
        || ARCHIVE_EXTENSIONS.contains(&ext.as_str())
    {
        return true;
    }

    false
}

pub fn download_block_reason(path: &[String]) -> Option<&'static str> {
    if is_download_allowed_for_path(path) {
        return None;
    }

    let name = file_name_from_path(path);
    let Some(ext) = extension_of(&name) else {
        return Some("files without a recognized media or subtitle extension are blocked");
    };

    if EXECUTABLE_EXTENSIONS.contains(&ext.as_str()) {
        return Some("executable and installer files are blocked");
    }

    Some("only movie, TV, subtitle, and common media archive files may be downloaded")
}

pub fn apply_media_download_policy(files: &mut [TorrentFileEntry]) {
    if !media_download_policy_enabled() {
        return;
    }

    for file in files.iter_mut() {
        if !is_download_allowed_for_path(&file.path) {
            file.priority = "skip".to_string();
        }
    }
}

pub fn validate_file_download_priority(path: &[String], priority: &str) -> Result<()> {
    if !media_download_policy_enabled() || priority == "skip" {
        return Ok(());
    }

    if is_download_allowed_for_path(path) {
        return Ok(());
    }

    let name = file_name_from_path(path);
    let reason = download_block_reason(path).unwrap_or("file type is blocked");
    Err(anyhow!(
        "AnimUS download policy blocked \"{name}\": {reason}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_string()).collect()
    }

    #[test]
    fn allows_video_and_subtitle_files() {
        assert!(is_download_allowed_for_path(&path(&["Movie", "Film.mkv"])));
        assert!(is_download_allowed_for_path(&path(&["subs", "Film.srt"])));
        assert!(is_download_allowed_for_path(&path(&["Film.ass"])));
    }

    #[test]
    fn blocks_executables_and_misc_files() {
        assert!(!is_download_allowed_for_path(&path(&["setup.exe"])));
        assert!(!is_download_allowed_for_path(&path(&["readme.txt"])));
        assert!(!is_download_allowed_for_path(&path(&["cover.jpg"])));
    }

    #[test]
    fn allows_common_media_archives() {
        assert!(is_download_allowed_for_path(&path(&["release.rar"])));
        assert!(is_download_allowed_for_path(&path(&["release.r00"])));
    }

    #[test]
    fn apply_policy_skips_blocked_files() {
        let mut files = vec![
            TorrentFileEntry {
                path: path(&["Film.mkv"]),
                size: 1,
                priority: "normal".to_string(),
                downloaded: false,
            },
            TorrentFileEntry {
                path: path(&["virus.exe"]),
                size: 1,
                priority: "normal".to_string(),
                downloaded: false,
            },
        ];

        std::env::set_var("ORC_TORRENT_EDITION", "animus");
        apply_media_download_policy(&mut files);
        std::env::remove_var("ORC_TORRENT_EDITION");

        assert_eq!(files[0].priority, "normal");
        assert_eq!(files[1].priority, "skip");
    }
}
