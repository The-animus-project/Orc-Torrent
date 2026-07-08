use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;
use url::Url;

use crate::search::magnet::build_magnet_uri;
use crate::search::{
    ResolvedSearchQuery, SearchExecutionContext, SearchProvider, SearchResult, SearchSettings,
};

const YTS_HOSTS: [&str; 3] = ["yts.mx", "yts.am", "yts.rs"];

#[derive(Debug, Clone, Deserialize)]
struct YtsTorrent {
    hash: Option<String>,
    quality: Option<String>,
    #[serde(rename = "type")]
    torrent_type: Option<String>,
    size_bytes: Option<u64>,
    seeds: Option<u32>,
    peers: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
struct YtsMovie {
    title_long: Option<String>,
    title: Option<String>,
    date_uploaded_unix: Option<i64>,
    torrents: Option<Vec<YtsTorrent>>,
}

#[derive(Debug, Clone, Deserialize)]
struct YtsData {
    movies: Option<Vec<YtsMovie>>,
}

#[derive(Debug, Clone, Deserialize)]
struct YtsResponse {
    data: Option<YtsData>,
}

pub(crate) struct YtsSearchProvider;

fn yts_quality_filter(category: Option<&str>) -> Option<&'static str> {
    match category.unwrap_or("all").to_ascii_lowercase().as_str() {
        "720p" => Some("720p"),
        "1080p" => Some("1080p"),
        "2160p" => Some("2160p"),
        "3d" => Some("3D"),
        _ => None,
    }
}

fn unix_to_published_at(secs: i64) -> Option<String> {
    if secs > 0 {
        Some(secs.to_string())
    } else {
        None
    }
}

async fn fetch_yts_movies(
    params: &[(String, String)],
    ctx: &SearchExecutionContext,
) -> Result<YtsResponse> {
    let mut last_error: Option<anyhow::Error> = None;
    for host in YTS_HOSTS {
        let mut url = Url::parse(&format!("https://{host}/api/v2/list_movies.json"))
            .map_err(anyhow::Error::from)?;
        {
            let mut query = url.query_pairs_mut();
            for (key, value) in params {
                query.append_pair(key, value);
            }
        }

        match ctx
            .get_json_with_user_agent(url.as_str(), ctx.allow_private_remote_urls)
            .await
        {
            Ok(response) => return Ok(response),
            Err(err) => last_error = Some(err),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("YTS unreachable")))
}

#[async_trait]
impl SearchProvider for YtsSearchProvider {
    fn name(&self) -> &str {
        "yts"
    }

    fn label(&self) -> &str {
        "YTS"
    }

    fn description(&self) -> &str {
        "Search movie torrents from YTS (YIFY) mirrors."
    }

    fn categories(&self) -> Vec<String> {
        vec![
            "all".to_string(),
            "720p".to_string(),
            "1080p".to_string(),
            "2160p".to_string(),
            "3d".to_string(),
        ]
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
        let mut params = vec![("limit".to_string(), query.limit.to_string())];
        if query.browse_mode {
            params.push(("sort_by".to_string(), "date_added".to_string()));
        } else {
            params.push(("query_term".to_string(), query.query.clone()));
        }
        if let Some(quality) = yts_quality_filter(query.category.as_deref()) {
            params.push(("quality".to_string(), quality.to_string()));
        }

        let response = fetch_yts_movies(&params, ctx).await?;
        let mut results = Vec::new();

        for movie in response
            .data
            .and_then(|data| data.movies)
            .unwrap_or_default()
        {
            let base = movie
                .title_long
                .or(movie.title)
                .unwrap_or_else(|| "Unknown".to_string());
            let published_at = movie.date_uploaded_unix.and_then(unix_to_published_at);

            for torrent in movie.torrents.unwrap_or_default() {
                let Some(hash) = torrent.hash else {
                    continue;
                };
                let info_hash = hash.trim().to_ascii_lowercase();
                if info_hash.len() != 40 {
                    continue;
                }

                let tag = [torrent.quality.as_deref(), torrent.torrent_type.as_deref()]
                    .into_iter()
                    .flatten()
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                let name = if tag.is_empty() {
                    base.clone()
                } else {
                    format!("{base} [{tag}]")
                };
                let quality = torrent.quality.clone();
                let magnet_uri = build_magnet_uri(&info_hash, &name);

                results.push(SearchResult {
                    id: format!("yts-{}-{}", info_hash, slugify(&name)),
                    source: self.name().to_string(),
                    name,
                    size_bytes: torrent.size_bytes,
                    seeders: torrent.seeds,
                    leechers: torrent.peers,
                    magnet_uri: Some(magnet_uri),
                    torrent_url: None,
                    description_url: None,
                    published_at: published_at.clone(),
                    category: quality,
                });
            }
        }

        results.truncate(query.limit as usize);
        Ok(results)
    }
}

fn slugify(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::{unix_to_published_at, yts_quality_filter};

    #[test]
    fn quality_filter_maps_categories() {
        assert_eq!(yts_quality_filter(Some("1080p")), Some("1080p"));
        assert_eq!(yts_quality_filter(Some("3d")), Some("3D"));
        assert_eq!(yts_quality_filter(Some("all")), None);
    }

    #[test]
    fn unix_timestamp_to_published_at() {
        assert_eq!(
            unix_to_published_at(1_700_000_000),
            Some("1700000000".to_string())
        );
        assert_eq!(unix_to_published_at(0), None);
    }
}
