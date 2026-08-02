use std::cmp::Ordering;
use std::collections::BTreeMap;

use url::Url;

use crate::search::SearchResult;

pub(crate) fn dedupe_results(results: Vec<SearchResult>) -> Vec<SearchResult> {
    let mut deduped: BTreeMap<String, SearchResult> = BTreeMap::new();
    for result in results {
        let key = search_result_dedupe_key(&result);
        match deduped.remove(&key) {
            Some(existing) => {
                deduped.insert(key, merge_search_results(existing, result));
            }
            None => {
                deduped.insert(key, ensure_sources(result));
            }
        }
    }
    deduped.into_values().collect()
}

pub(crate) fn compare_search_results(left: &SearchResult, right: &SearchResult) -> Ordering {
    compare_option_desc(left.seeders, right.seeders)
        .then_with(|| {
            let left_magnet = left.magnet_uri.as_ref().is_some_and(|v| !v.is_empty());
            let right_magnet = right.magnet_uri.as_ref().is_some_and(|v| !v.is_empty());
            right_magnet.cmp(&left_magnet)
        })
        .then_with(|| {
            compare_option_desc(
                left.published_at.as_deref().map(str::to_string),
                right.published_at.as_deref().map(str::to_string),
            )
        })
        .then_with(|| {
            left.name
                .to_ascii_lowercase()
                .cmp(&right.name.to_ascii_lowercase())
        })
}

fn ensure_sources(mut result: SearchResult) -> SearchResult {
    if result.sources.is_empty() {
        result.sources = vec![result.source.clone()];
    }
    result
}

fn merge_search_results(left: SearchResult, right: SearchResult) -> SearchResult {
    let left = ensure_sources(left);
    let right = ensure_sources(right);

    let mut sources = left.sources.clone();
    for source in &right.sources {
        if !sources.iter().any(|existing| existing == source) {
            sources.push(source.clone());
        }
    }
    if !sources.iter().any(|existing| existing == &right.source) {
        sources.push(right.source.clone());
    }

    let magnet_uri = left
        .magnet_uri
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| right.magnet_uri.clone().filter(|value| !value.is_empty()));

    let torrent_url =
        strongest_torrent_url(left.torrent_url.as_deref(), right.torrent_url.as_deref());

    let description_url = left
        .description_url
        .clone()
        .filter(|value| !value.is_empty())
        .or_else(|| {
            right
                .description_url
                .clone()
                .filter(|value| !value.is_empty())
        });

    let seeders = max_option(left.seeders, right.seeders);
    let leechers = max_option(left.leechers, right.leechers);
    let size_bytes = left.size_bytes.or(right.size_bytes);
    let published_at =
        earliest_published_at(left.published_at.as_deref(), right.published_at.as_deref());
    let category = left.category.clone().or(right.category.clone());

    // Prefer the higher-seeded result for primary source/name/id display.
    let prefer_right = compare_search_results(&right, &left) == Ordering::Less;
    let primary = if prefer_right { &right } else { &left };

    SearchResult {
        id: primary.id.clone(),
        source: primary.source.clone(),
        name: primary.name.clone(),
        size_bytes,
        seeders,
        leechers,
        magnet_uri,
        torrent_url,
        description_url,
        published_at,
        category,
        sources,
    }
}

fn strongest_torrent_url(left: Option<&str>, right: Option<&str>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => {
            let left_score = torrent_url_score(left);
            let right_score = torrent_url_score(right);
            if right_score > left_score {
                Some(right.to_string())
            } else {
                Some(left.to_string())
            }
        }
        (Some(left), None) => Some(left.to_string()),
        (None, Some(right)) => Some(right.to_string()),
        (None, None) => None,
    }
}

fn torrent_url_score(url: &str) -> u8 {
    let lower = url.to_ascii_lowercase();
    if lower.ends_with(".torrent") {
        2
    } else if lower.starts_with("http://") || lower.starts_with("https://") {
        1
    } else {
        0
    }
}

fn earliest_published_at(left: Option<&str>, right: Option<&str>) -> Option<String> {
    match (left, right) {
        (Some(left), Some(right)) => {
            if left <= right {
                Some(left.to_string())
            } else {
                Some(right.to_string())
            }
        }
        (Some(left), None) => Some(left.to_string()),
        (None, Some(right)) => Some(right.to_string()),
        (None, None) => None,
    }
}

fn max_option<T: Ord>(left: Option<T>, right: Option<T>) -> Option<T> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn compare_option_desc<T: Ord>(left: Option<T>, right: Option<T>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => right.cmp(&left),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

pub(crate) fn search_result_dedupe_key(result: &SearchResult) -> String {
    if let Some(info_hash) = result
        .id
        .strip_prefix("btih:")
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| is_info_hash(value))
    {
        return format!("btih:{info_hash}");
    }

    if let Some(magnet_uri) = result.magnet_uri.as_deref() {
        if let Some(info_hash) = extract_btih_from_magnet(magnet_uri) {
            return format!("btih:{info_hash}");
        }
    }

    if let Some(torrent_url) = result.torrent_url.as_deref() {
        if let Ok(url) = Url::parse(torrent_url) {
            let mut canonical = url.clone();
            canonical.set_fragment(None);
            return format!("torrent:{}", canonical.as_str().to_ascii_lowercase());
        }
        return format!("torrent:{}", torrent_url.to_ascii_lowercase());
    }

    format!(
        "name:{}:{}",
        result.name.to_ascii_lowercase(),
        result.size_bytes.unwrap_or_default()
    )
}

pub(crate) fn extract_btih_from_magnet(raw: &str) -> Option<String> {
    let url = Url::parse(raw).ok()?;
    url.query_pairs().find_map(|(key, value)| {
        if key != "xt" {
            return None;
        }
        value
            .strip_prefix("urn:btih:")
            .map(|hash| hash.to_ascii_lowercase())
            .filter(|hash| is_info_hash(hash))
    })
}

fn is_info_hash(value: &str) -> bool {
    let is_hex = value.len() == 40 && value.chars().all(|ch| ch.is_ascii_hexdigit());
    let is_base32 = value.len() == 32
        && value
            .chars()
            .all(|ch| matches!(ch, 'A'..='Z' | 'a'..='z' | '2'..='7'));
    is_hex || is_base32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(name: &str, source: &str) -> SearchResult {
        SearchResult {
            id: name.to_string(),
            source: source.to_string(),
            name: name.to_string(),
            size_bytes: Some(100),
            seeders: Some(10),
            leechers: Some(1),
            magnet_uri: None,
            torrent_url: None,
            description_url: None,
            published_at: None,
            category: None,
            sources: vec![],
        }
    }

    #[test]
    fn dedupes_by_magnet_info_hash_and_merges_sources() {
        let mut a = sample("Release A", "jackett");
        a.magnet_uri =
            Some("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=A".to_string());
        a.seeders = Some(5);
        let mut b = sample("Release A alt", "prowlarr");
        b.magnet_uri =
            Some("magnet:?xt=urn:btih:0123456789ABCDEF0123456789ABCDEF01234567&dn=B".to_string());
        b.seeders = Some(40);
        b.torrent_url = Some("https://example.com/a.torrent".to_string());

        let deduped = dedupe_results(vec![a, b]);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].seeders, Some(40));
        assert!(deduped[0].magnet_uri.is_some());
        assert_eq!(
            deduped[0].torrent_url.as_deref(),
            Some("https://example.com/a.torrent")
        );
        assert!(deduped[0].sources.contains(&"jackett".to_string()));
        assert!(deduped[0].sources.contains(&"prowlarr".to_string()));
    }

    #[test]
    fn sort_prefers_seeders_then_magnet() {
        let mut with_magnet = sample("b", "a");
        with_magnet.seeders = Some(10);
        with_magnet.magnet_uri =
            Some("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567".to_string());
        let mut no_magnet = sample("a", "b");
        no_magnet.seeders = Some(10);
        no_magnet.torrent_url = Some("https://example.com/x.torrent".to_string());

        assert_eq!(
            compare_search_results(&with_magnet, &no_magnet),
            Ordering::Less
        );
    }
}
