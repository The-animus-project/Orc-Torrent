use anyhow::{anyhow, Result};
use async_trait::async_trait;
use regex::Regex;
use std::sync::LazyLock;

use crate::search::{
    ResolvedSearchQuery, SearchExecutionContext, SearchProvider, SearchResult, SearchSettings,
};

const X1337_HOSTS: [&str; 4] = ["1337x.to", "1337x.st", "x1337x.ws", "1337xx.to"];
const MAX_DETAILS: usize = 8;

static ROW_LINK_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"href="(/torrent/[^"]+)"[^>]*>([^<]+)</a>"#).expect("regex"));
static ROW_SIZE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"class="coll-4 size[^"]*">\s*([\d.]+\s*[KMGT]i?B)"#).expect("regex")
});
static ROW_SEEDS_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="coll-2 seeds[^"]*">\s*(\d+)"#).expect("regex"));
static ROW_LEECHES_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="coll-3 leeches[^"]*">\s*(\d+)"#).expect("regex"));
static MAGNET_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"magnet:\?xt=urn:btih:[^"'<>\s]+"#).expect("regex"));
static UPLOAD_DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Date uploaded</strong>\s*<span>\s*([A-Za-z]{3})\.?\s+(\d{1,2})[a-z]{2}\s*'(\d{2})")
        .expect("regex")
});

#[derive(Debug, Clone)]
pub(crate) struct X1337Row {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) seeders: u32,
    pub(crate) leechers: u32,
    pub(crate) size_bytes: u64,
}

pub(crate) struct X1337MoviesSearchProvider;

fn parse_size(raw: &str) -> u64 {
    static SIZE_RE: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?i)([\d.]+)\s*([kmgt]?i?b)").expect("regex"));
    let Some(caps) = SIZE_RE.captures(raw) else {
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

fn unescape_entities(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

pub(crate) fn parse_x1337_rows(html: &str) -> Vec<X1337Row> {
    let Some(start) = html.find("table-list") else {
        return Vec::new();
    };

    let mut rows = Vec::new();
    for chunk in html[start..].split("<tr").skip(1) {
        let Some(link_caps) = ROW_LINK_RE.captures(chunk) else {
            continue;
        };
        let path = link_caps
            .get(1)
            .map(|m| m.as_str())
            .unwrap_or_default()
            .to_string();
        let name = unescape_entities(
            link_caps
                .get(2)
                .map(|m| m.as_str().trim())
                .unwrap_or_default(),
        );
        if name.is_empty() {
            continue;
        }

        let size_bytes = ROW_SIZE_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).map(|m| parse_size(m.as_str())))
            .unwrap_or(0);
        let seeders = ROW_SEEDS_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).and_then(|m| m.as_str().parse().ok()))
            .unwrap_or(0);
        let leechers = ROW_LEECHES_RE
            .captures(chunk)
            .and_then(|caps| caps.get(1).and_then(|m| m.as_str().parse().ok()))
            .unwrap_or(0);

        rows.push(X1337Row {
            name,
            path,
            seeders,
            leechers,
            size_bytes,
        });
    }

    rows
}

fn parse_x1337_upload_date(html: &str) -> Option<String> {
    let caps = UPLOAD_DATE_RE.captures(html)?;
    let month_name = caps.get(1)?.as_str().to_ascii_lowercase();
    let day: u32 = caps.get(2)?.as_str().parse().ok()?;
    let year_suffix: u32 = caps.get(3)?.as_str().parse().ok()?;
    let year = 2000 + year_suffix;

    let month = match month_name.as_str() {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    };

    Some(format!("{year:04}-{month:02}-{day:02}"))
}

fn extract_magnet_from_html(html: &str) -> Option<String> {
    MAGNET_RE.find(html).map(|m| unescape_entities(m.as_str()))
}

pub(crate) fn filter_rows(rows: Vec<X1337Row>, query: &str) -> Vec<X1337Row> {
    let tokens: Vec<&str> = query.split_whitespace().collect();
    if tokens.is_empty() {
        return rows;
    }

    const STOP: [&str; 7] = ["the", "a", "an", "of", "and", "or", "to"];
    let meaningful: Vec<&str> = tokens
        .iter()
        .copied()
        .filter(|token| !STOP.contains(&token.to_ascii_lowercase().as_str()))
        .collect();
    let need = if meaningful.is_empty() {
        tokens
    } else {
        meaningful
    };

    rows.into_iter()
        .filter(|row| {
            let name = row.name.to_ascii_lowercase();
            need.iter()
                .all(|token| name.contains(&token.to_ascii_lowercase()))
        })
        .collect()
}

pub(crate) async fn fetch_x1337_html(
    path: &str,
    ctx: &SearchExecutionContext,
) -> Result<(String, String)> {
    let mut last_error: Option<anyhow::Error> = None;
    for host in X1337_HOSTS {
        let base = format!("https://{host}");
        let url = format!("{base}{path}");
        match ctx
            .get_text_with_user_agent(&url, ctx.allow_private_remote_urls)
            .await
        {
            Ok(html) => return Ok((base, html)),
            Err(err) => last_error = Some(err),
        }
    }
    Err(last_error.unwrap_or_else(|| anyhow!("1337x unreachable")))
}

pub(crate) async fn fetch_detail(
    base: &str,
    path: &str,
    ctx: &SearchExecutionContext,
) -> Option<(String, Option<String>)> {
    let url = format!("{base}{path}");
    let html = ctx
        .get_text_with_user_agent(&url, ctx.allow_private_remote_urls)
        .await
        .ok()?;
    let magnet = extract_magnet_from_html(&html)?;
    let published_at = parse_x1337_upload_date(&html);
    Some((magnet, published_at))
}

#[async_trait]
impl SearchProvider for X1337MoviesSearchProvider {
    fn name(&self) -> &str {
        "x1337_movies"
    }

    fn label(&self) -> &str {
        "1337x (Movies)"
    }

    fn description(&self) -> &str {
        "Search movie torrents from 1337x mirrors."
    }

    fn categories(&self) -> Vec<String> {
        vec!["all".to_string(), "movies".to_string()]
    }

    fn supports_browse(&self) -> bool {
        true
    }

    fn configured(&self, _settings: &SearchSettings) -> bool {
        true
    }

    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        _settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>> {
        let path = if query.browse_mode {
            "/popular-movies".to_string()
        } else {
            format!(
                "/category-search/{}/Movies/1/",
                url_encode_query(&query.query)
            )
        };

        let (base, html) = fetch_x1337_html(&path, ctx).await?;
        let mut rows = parse_x1337_rows(&html);
        if !query.browse_mode {
            rows = filter_rows(rows, &query.query);
        }
        rows.sort_by(|left, right| right.seeders.cmp(&left.seeders));
        rows.truncate(MAX_DETAILS);

        let mut results = Vec::new();
        for row in rows {
            let Some((magnet_uri, published_at)) = fetch_detail(&base, &row.path, ctx).await else {
                continue;
            };

            results.push(SearchResult {
                id: format!("x1337_movies-{}", row.path.trim_start_matches('/')),
                source: self.name().to_string(),
                name: row.name,
                size_bytes: Some(row.size_bytes),
                seeders: Some(row.seeders),
                leechers: Some(row.leechers),
                magnet_uri: Some(magnet_uri),
                torrent_url: None,
                description_url: Some(format!("{}{}", base, row.path)),
                published_at,
                category: Some("movies".to_string()),
                sources: Vec::new(),
            });
        }

        Ok(results)
    }
}

pub(crate) fn url_encode_query(query: &str) -> String {
    url::form_urlencoded::byte_serialize(query.as_bytes())
        .collect::<String>()
        .replace("%20", "+")
}

#[cfg(test)]
mod tests {
    use super::{parse_size, parse_x1337_rows, parse_x1337_upload_date};

    #[test]
    fn parse_size_units() {
        assert_eq!(parse_size("1.5 GB"), 1_500_000_000);
        assert_eq!(parse_size("512 MiB"), 536_870_912);
    }

    #[test]
    fn parse_rows_from_html() {
        let html = r#"
            <table class="table-list">
              <tr>
                <td><a href="/torrent/123/example-movie/">Example Movie (2024)</a></td>
                <td class="coll-2 seeds">42</td>
                <td class="coll-3 leeches">3</td>
                <td class="coll-4 size">1.2 GB</td>
              </tr>
            </table>
        "#;
        let rows = parse_x1337_rows(html);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "Example Movie (2024)");
        assert_eq!(rows[0].seeders, 42);
        assert_eq!(rows[0].path, "/torrent/123/example-movie/");
    }

    #[test]
    fn parse_upload_date_from_detail_html() {
        let html = r#"<ul class="list"><li><strong>Date uploaded</strong><span>Jun. 26th  '26</span> </li></ul>"#;
        let published_at = parse_x1337_upload_date(html).expect("date");
        assert_eq!(published_at, "2026-06-26");
    }

    #[test]
    fn parse_upload_date_returns_none_for_invalid_input() {
        assert!(parse_x1337_upload_date("<div>no date</div>").is_none());
    }
}
