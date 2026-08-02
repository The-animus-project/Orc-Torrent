use anyhow::Result;
use async_trait::async_trait;

use super::x1337::{
    fetch_detail, fetch_x1337_html, filter_rows, parse_x1337_rows, url_encode_query,
};
use crate::search::{
    ResolvedSearchQuery, SearchExecutionContext, SearchProvider, SearchResult, SearchSettings,
};

const MAX_DETAILS: usize = 8;

pub(crate) struct X1337TvSearchProvider;

#[async_trait]
impl SearchProvider for X1337TvSearchProvider {
    fn name(&self) -> &str {
        "x1337_tv"
    }

    fn label(&self) -> &str {
        "1337x (TV)"
    }

    fn description(&self) -> &str {
        "Search TV torrents from 1337x mirrors."
    }

    fn categories(&self) -> Vec<String> {
        vec!["all".to_string(), "tv".to_string()]
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
            "/popular-tv".to_string()
        } else {
            format!("/category-search/{}/TV/1/", url_encode_query(&query.query))
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
                id: format!("x1337_tv-{}", row.path.trim_start_matches('/')),
                source: self.name().to_string(),
                name: row.name,
                size_bytes: Some(row.size_bytes),
                seeders: Some(row.seeders),
                leechers: Some(row.leechers),
                magnet_uri: Some(magnet_uri),
                torrent_url: None,
                description_url: Some(format!("{}{}", base, row.path)),
                published_at,
                category: Some("tv".to_string()),
                sources: Vec::new(),
            });
        }

        Ok(results)
    }
}
