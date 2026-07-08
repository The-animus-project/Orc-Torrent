use anyhow::{anyhow, Result};
use regex::Regex;
use serde::Deserialize;
use std::sync::LazyLock;

use crate::search::SearchExecutionContext;

pub(crate) const ZERO_HASH: &str = "0000000000000000000000000000000000000000";

const APIBAY_BASE: &str = "https://apibay.org";

/// TPB proxy mirrors that serve classic HTML (usable when apibay.org is down).
const TPB_PROXY_HOSTS: [&str; 4] = [
    "thepiratebay.zone",
    "thepiratebay0.org",
    "tpb.party",
    "thehiddenbay.com",
];

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct ApibayItem {
    pub id: Option<String>,
    pub name: Option<String>,
    pub info_hash: Option<String>,
    pub seeders: Option<String>,
    pub leechers: Option<String>,
    pub size: Option<String>,
    pub added: Option<String>,
    pub category: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct TpbTorrent {
    pub name: String,
    pub info_hash: String,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    pub size_bytes: Option<u64>,
    pub added: Option<String>,
    pub category: Option<String>,
    pub magnet_uri: Option<String>,
    pub description_url: Option<String>,
}

static DET_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="detLink"[^>]*>([^<]+)</a>"#).expect("regex"));
static MAGNET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"href="(magnet:\?[^"]+)"#).expect("regex"));
static DET_DESC_SIZE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)Size\s+([\d.]+\s*(?:&nbsp;)?[KMGT]?i?B)").expect("regex")
});
static ALIGN_RIGHT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"align="right">(\d+)</td>"#).expect("regex"));
static BTIH_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)btih:([a-f0-9]{40})").expect("regex"));
static HTML_CATEGORY_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"browse/(\d+)"#).expect("regex")
});
static HTML_DESCRIPTION_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"href="(https?://[^"]+/torrent/\d+[^"]*)""#).expect("regex")
});

pub(crate) fn urlencoding_encode(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

pub(crate) fn apibay_search_urls(query: &str, categories: &[u32]) -> Vec<String> {
    let encoded = urlencoding_encode(query);
    let cat = categories
        .iter()
        .map(|code| code.to_string())
        .collect::<Vec<_>>()
        .join(",");
    vec![
        format!("{APIBAY_BASE}/q.php?q={encoded}&cat={cat}"),
        format!("{APIBAY_BASE}/q.php?q={encoded}"),
    ]
}

pub(crate) fn apibay_browse_urls(primary_category: u32) -> Vec<String> {
    vec![
        format!("{APIBAY_BASE}/precompiled/data_top100_{primary_category}.json"),
        format!("{APIBAY_BASE}/precompiled/data_top100_48h_{primary_category}.json"),
        format!("{APIBAY_BASE}/precompiled/data_top100_recent.json"),
        format!(
            "{APIBAY_BASE}/q.php?q=category:{primary_category}"
        ),
    ]
}

pub(crate) fn tpb_html_search_path(query: &str, category: u32) -> String {
    let encoded = query.replace(' ', "+");
    format!("/search/{encoded}/1/99/{category}")
}

pub(crate) fn tpb_html_browse_path(category: u32) -> String {
    format!("/top/{category}")
}

fn parse_size(raw: &str) -> u64 {
    static SIZE_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)([\d.]+)\s*([kmgt]?i?b)").expect("regex"));
    let normalized = raw.replace("&nbsp;", " ");
    let Some(caps) = SIZE_RE.captures(&normalized) else {
        return 0;
    };
    let value: f64 = caps
        .get(1)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0.0);
    let unit = caps
        .get(2)
        .map(|m| m.as_str().to_ascii_uppercase())
        .unwrap_or_default();
    let multiplier = match unit.as_str() {
        "B" => 1.0,
        "KIB" => 1024.0,
        "MIB" => 1024.0_f64.powi(2),
        "GIB" => 1024.0_f64.powi(3),
        "TIB" => 1024.0_f64.powi(4),
        "KB" => 1_000.0,
        "MB" => 1_000_000.0,
        "GB" => 1_000_000_000.0,
        "TB" => 1_000_000_000_000.0,
        _ => 1.0,
    };
    (value * multiplier).round() as u64
}

fn unescape_html(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn info_hash_from_magnet(magnet: &str) -> Option<String> {
    BTIH_RE
        .captures(magnet)
        .and_then(|caps| caps.get(1).map(|m| m.as_str().to_ascii_lowercase()))
}

pub(crate) fn is_valid_apibay_items(items: &[ApibayItem]) -> bool {
    items.iter().any(|item| {
        let info_hash = item
            .info_hash
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_ascii_lowercase();
        !info_hash.is_empty()
            && info_hash != ZERO_HASH
            && item.id.as_deref() != Some("0")
    })
}

pub(crate) fn apibay_item_to_torrent(item: &ApibayItem) -> Option<TpbTorrent> {
    let info_hash = item.info_hash.as_deref()?.trim().to_ascii_lowercase();
    if info_hash.is_empty() || info_hash == ZERO_HASH || item.id.as_deref() == Some("0") {
        return None;
    }

    let name = item
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Unknown")
        .to_string();

    Some(TpbTorrent {
        name,
        info_hash,
        seeders: item.seeders.as_deref().and_then(|value| value.parse().ok()),
        leechers: item
            .leechers
            .as_deref()
            .and_then(|value| value.parse().ok()),
        size_bytes: item.size.as_deref().and_then(|value| value.parse().ok()),
        added: item.added.clone(),
        category: item.category.clone(),
        magnet_uri: None,
        description_url: None,
    })
}

pub(crate) fn parse_tpb_html_rows(html: &str) -> Vec<TpbTorrent> {
    let Some(start) = html.find("id=\"searchResult\"") else {
        return Vec::new();
    };

    let mut rows = Vec::new();
    for chunk in html[start..].split("<tr").skip(2) {
        let Some(name_caps) = DET_LINK_RE.captures(chunk) else {
            continue;
        };
        let name = unescape_html(
            name_caps
                .get(1)
                .map(|m| m.as_str().trim())
                .unwrap_or_default(),
        );
        if name.is_empty() {
            continue;
        }

        let magnet_uri = MAGNET_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).map(|m| unescape_html(m.as_str())));
        let Some(magnet_uri) = magnet_uri else {
            continue;
        };
        let Some(info_hash) = info_hash_from_magnet(&magnet_uri) else {
            continue;
        };

        let size_bytes = DET_DESC_SIZE_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).map(|m| parse_size(m.as_str())))
            .filter(|size| *size > 0);

        let counts: Vec<u32> = ALIGN_RIGHT_RE
            .captures_iter(chunk)
            .filter_map(|caps| caps.get(1).and_then(|m| m.as_str().parse().ok()))
            .collect();
        let (seeders, leechers) = match counts.as_slice() {
            [seeders, leechers] => (Some(*seeders), Some(*leechers)),
            [seeders] => (Some(*seeders), None),
            _ => (None, None),
        };

        let category = HTML_CATEGORY_RE
            .captures_iter(chunk)
            .filter_map(|caps| caps.get(1).map(|m| m.as_str().to_string()))
            .last();

        let description_url = HTML_DESCRIPTION_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).map(|m| unescape_html(m.as_str())));

        rows.push(TpbTorrent {
            name,
            info_hash,
            seeders,
            leechers,
            size_bytes,
            added: None,
            category,
            magnet_uri: Some(magnet_uri),
            description_url,
        });
    }

    rows
}

async fn fetch_apibay_items(
    ctx: &SearchExecutionContext,
    urls: &[String],
) -> Result<Vec<ApibayItem>> {
    let mut last_error: Option<anyhow::Error> = None;
    for url in urls {
        match ctx
            .get_json_with_user_agent::<Vec<ApibayItem>>(url, ctx.allow_private_remote_urls)
            .await
        {
            Ok(items) if is_valid_apibay_items(&items) => return Ok(items),
            Ok(_) => last_error = Some(anyhow!("apibay returned no usable results for {url}")),
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("apibay unreachable")))
}

async fn fetch_tpb_html_torrents(
    ctx: &SearchExecutionContext,
    paths: &[String],
) -> Result<Vec<TpbTorrent>> {
    let mut last_error: Option<anyhow::Error> = None;
    for host in TPB_PROXY_HOSTS {
        for path in paths {
            let url = format!("https://{host}{path}");
            match ctx
                .get_text_with_user_agent(&url, ctx.allow_private_remote_urls)
                .await
            {
                Ok(html) => {
                    let rows = parse_tpb_html_rows(&html);
                    if !rows.is_empty() {
                        return Ok(rows);
                    }
                    last_error = Some(anyhow!("tpb html mirror returned no rows for {url}"));
                }
                Err(err) => last_error = Some(err),
            }
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("tpb html mirrors unreachable")))
}

pub(crate) async fn fetch_tpb_torrents(
    ctx: &SearchExecutionContext,
    api_urls: &[String],
    html_paths: &[String],
) -> Result<Vec<TpbTorrent>> {
    if let Ok(items) = fetch_apibay_items(ctx, api_urls).await {
        let torrents = items
            .iter()
            .filter_map(apibay_item_to_torrent)
            .collect::<Vec<_>>();
        if !torrents.is_empty() {
            return Ok(torrents);
        }
    }

    fetch_tpb_html_torrents(ctx, html_paths).await
}

#[cfg(test)]
mod tests {
    use super::{
        apibay_browse_urls, apibay_item_to_torrent, apibay_search_urls, is_valid_apibay_items,
        parse_tpb_html_rows, tpb_html_browse_path, tpb_html_search_path, ApibayItem,
    };

    #[test]
    fn apibay_search_urls_include_category_filter() {
        let urls = apibay_search_urls("matrix", &[201, 207]);
        assert!(urls[0].contains("q=matrix"));
        assert!(urls[0].contains("cat=201,207"));
        assert!(urls[1].contains("q=matrix"));
        assert!(!urls[1].contains("cat="));
    }

    #[test]
    fn apibay_browse_urls_include_fallbacks() {
        let urls = apibay_browse_urls(207);
        assert!(urls[0].contains("data_top100_207.json"));
        assert!(urls[1].contains("data_top100_48h_207.json"));
        assert!(urls[2].contains("data_top100_recent.json"));
        assert!(urls[3].contains("q=category:207"));
    }

    #[test]
    fn html_paths_use_expected_routes() {
        assert_eq!(tpb_html_search_path("foo bar", 200), "/search/foo+bar/1/99/200");
        assert_eq!(tpb_html_browse_path(205), "/top/205");
    }

    #[test]
    fn apibay_validity_rejects_placeholder_rows() {
        let empty: Vec<ApibayItem> = vec![];
        assert!(!is_valid_apibay_items(&empty));

        let placeholder = vec![ApibayItem {
            id: Some("0".to_string()),
            name: Some("No results returned".to_string()),
            info_hash: Some("0000000000000000000000000000000000000000".to_string()),
            seeders: None,
            leechers: None,
            size: None,
            added: None,
            category: None,
        }];
        assert!(!is_valid_apibay_items(&placeholder));
    }

    #[test]
    fn apibay_item_maps_to_torrent() {
        let item = ApibayItem {
            id: Some("123".to_string()),
            name: Some("Example".to_string()),
            info_hash: Some("0123456789abcdef0123456789abcdef01234567".to_string()),
            seeders: Some("10".to_string()),
            leechers: Some("2".to_string()),
            size: Some("1048576".to_string()),
            added: Some("1700000000".to_string()),
            category: Some("207".to_string()),
        };
        let torrent = apibay_item_to_torrent(&item).expect("valid item");
        assert_eq!(torrent.seeders, Some(10));
        assert_eq!(torrent.category.as_deref(), Some("207"));
    }

    #[test]
    fn parse_html_rows_from_search_page() {
        let html = r#"
            <table id="searchResult">
              <tr class="header"><th>Name</th></tr>
              <tr>
                <td class="vertTh"><a href="/browse/200">Video</a><br>(<a href="/browse/207">HD - Movies</a>)</td>
                <td>
                  <div class="detName"><a href="https://thepiratebay.zone/torrent/1/example" class="detLink">Example Movie</a></div>
                  <a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example+Movie">magnet</a>
                  <font class="detDesc">Uploaded 03-13&nbsp;11:06, Size 1.46&nbsp;GiB, ULed by user</font>
                </td>
                <td align="right">42</td>
                <td align="right">3</td>
              </tr>
            </table>
        "#;
        let rows = parse_tpb_html_rows(html);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Example Movie");
        assert_eq!(rows[0].seeders, Some(42));
        assert_eq!(rows[0].leechers, Some(3));
        assert_eq!(
            rows[0].info_hash,
            "0123456789abcdef0123456789abcdef01234567"
        );
        assert!(rows[0].magnet_uri.is_some());
        assert_eq!(rows[0].category.as_deref(), Some("207"));
    }
}
