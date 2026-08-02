use anyhow::Result;
use async_trait::async_trait;

use crate::search::magnet::build_magnet_uri;
use crate::search::{
    ResolvedSearchQuery, SearchExecutionContext, SearchProvider, SearchResult, SearchSettings,
};

use super::tpb_common::{
    apibay_browse_urls, apibay_search_urls, fetch_tpb_torrents, tpb_html_browse_path,
    tpb_html_search_path, TpbTorrent,
};

const TV_CATEGORIES: [u32; 2] = [205, 208];
const TV_BROWSE_CATEGORY: u32 = 205;

pub(crate) struct TpbTvSearchProvider;

fn is_tv_category(category: Option<&str>) -> bool {
    category
        .and_then(|value| value.parse::<u32>().ok())
        .map(|code| TV_CATEGORIES.contains(&code))
        .unwrap_or(false)
}

fn torrent_to_result(torrent: &TpbTorrent) -> SearchResult {
    let magnet_uri = torrent
        .magnet_uri
        .clone()
        .unwrap_or_else(|| build_magnet_uri(&torrent.info_hash, &torrent.name));

    SearchResult {
        id: format!("tpb_tv-{}", torrent.info_hash),
        source: "tpb_tv".to_string(),
        name: torrent.name.clone(),
        size_bytes: torrent.size_bytes,
        seeders: torrent.seeders,
        leechers: torrent.leechers,
        magnet_uri: Some(magnet_uri),
        torrent_url: None,
        description_url: torrent.description_url.clone(),
        published_at: torrent.added.clone(),
        category: Some("tv".to_string()),
        sources: Vec::new(),
    }
}

#[async_trait]
impl SearchProvider for TpbTvSearchProvider {
    fn name(&self) -> &str {
        "tpb_tv"
    }

    fn label(&self) -> &str {
        "The Pirate Bay (TV)"
    }

    fn description(&self) -> &str {
        "Search TV torrents from The Pirate Bay via apibay.org with HTML mirror fallback."
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
        let (api_urls, html_paths) = if query.browse_mode {
            (
                apibay_browse_urls(TV_BROWSE_CATEGORY),
                vec![tpb_html_browse_path(TV_BROWSE_CATEGORY)],
            )
        } else {
            (
                apibay_search_urls(&query.query, &TV_CATEGORIES),
                vec![tpb_html_search_path(&query.query, TV_BROWSE_CATEGORY)],
            )
        };

        let torrents = fetch_tpb_torrents(ctx, &api_urls, &html_paths).await?;

        let mut results = Vec::new();
        for torrent in torrents {
            if !is_tv_category(torrent.category.as_deref()) {
                continue;
            }
            results.push(torrent_to_result(&torrent));
        }

        results.truncate(query.limit as usize);
        Ok(results)
    }
}

#[cfg(test)]
mod tests {
    use super::is_tv_category;

    #[test]
    fn tv_category_filter() {
        assert!(is_tv_category(Some("205")));
        assert!(is_tv_category(Some("208")));
        assert!(!is_tv_category(Some("207")));
    }
}
