//! Native Torznab / Newznab provider (Jackett, Prowlarr, compatible services).

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use quick_xml::{events::Event, Reader};
use serde::Serialize;
use tracing::{info, warn};
use url::Url;

use crate::search::dedup::extract_btih_from_magnet;
use crate::search::secrets::{credential_ref_for_provider, SearchSecretStore};
use crate::search::{
    clamp_provider_timeout_seconds, redact_url_for_log, sanitize_result, validate_magnet_uri,
    validate_remote_url, ResolvedSearchQuery, SearchExecutionContext, SearchProvider,
    SearchProviderFormat, SearchResult, SearchSettings, MAX_RESULT_LIMIT, SEARCH_USER_AGENT,
};

pub const TORZNAB_MAX_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;
const SENSITIVE_QUERY_KEYS: &[&str] = &["apikey", "api_key", "passkey", "auth", "token"];

#[derive(Debug, Clone, Serialize)]
pub struct TorznabCapsTestResult {
    pub ok: bool,
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supports_search: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_count: Option<usize>,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct ProviderConnectionSnapshot {
    pub ok: bool,
    pub tested_at: String,
    pub latency_ms: Option<u64>,
    pub supports_search: Option<bool>,
    pub category_count: Option<usize>,
    pub last_error: Option<String>,
}

impl ProviderConnectionSnapshot {
    pub fn status_label(&self) -> String {
        if self.ok {
            match (self.supports_search, self.category_count, self.latency_ms) {
                (Some(true), Some(count), Some(ms)) => {
                    format!("connected ({count} categories, {ms} ms)")
                }
                (_, _, Some(ms)) => format!("connected ({ms} ms)"),
                _ => "connected".to_string(),
            }
        } else {
            "failed".to_string()
        }
    }
}

pub struct TorznabProvider {
    pub name: String,
    pub label: String,
    pub categories: Vec<String>,
    pub secrets: Arc<dyn SearchSecretStore>,
}

#[derive(Debug, Default)]
struct TorznabItem {
    title: Option<String>,
    guid: Option<String>,
    link: Option<String>,
    comments: Option<String>,
    pub_date: Option<String>,
    category: Option<String>,
    enclosure_url: Option<String>,
    enclosure_length: Option<u64>,
    enclosure_type: Option<String>,
    attrs: BTreeMap<String, String>,
}

#[derive(Debug, Clone)]
pub struct TorznabCaps {
    pub supports_search: bool,
    pub category_count: usize,
}

impl TorznabProvider {
    fn setting_timeout(&self, settings: &SearchSettings) -> Duration {
        let seconds = settings
            .provider_setting(&self.name)
            .ok()
            .and_then(|setting| setting.timeout_seconds)
            .map(clamp_provider_timeout_seconds)
            .unwrap_or(10);
        Duration::from_secs(seconds)
    }

    fn allow_private(&self, settings: &SearchSettings, ctx: &SearchExecutionContext) -> bool {
        let provider_allow = settings
            .provider_setting(&self.name)
            .map(|setting| setting.allow_private_url)
            .unwrap_or(false);
        ctx.allow_private_remote_urls || provider_allow
    }

    async fn api_key(&self, settings: &SearchSettings) -> Result<Option<String>> {
        let reference = settings
            .provider_setting(&self.name)?
            .credential_ref
            .unwrap_or_else(|| credential_ref_for_provider(&self.name));
        self.secrets.get_secret(&reference).await
    }
}

#[async_trait]
impl SearchProvider for TorznabProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn description(&self) -> &str {
        "Torznab-compatible indexer endpoint (Jackett, Prowlarr, or similar)."
    }

    fn categories(&self) -> Vec<String> {
        self.categories.clone()
    }

    fn provider_format(&self) -> Option<SearchProviderFormat> {
        Some(SearchProviderFormat::Torznab)
    }

    fn supports_browse(&self) -> bool {
        false
    }

    fn requires_feed_url(&self) -> bool {
        true
    }

    fn configured(&self, settings: &SearchSettings) -> bool {
        settings
            .provider_setting(&self.name)
            .ok()
            .and_then(|setting| setting.feed_url)
            .is_some_and(|url| !url.trim().is_empty())
    }

    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>> {
        if query.browse_mode {
            return Err(anyhow!("Torznab providers require a search query"));
        }

        let setting = settings.provider_setting(&self.name)?;
        let feed_url = setting
            .feed_url
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| anyhow!("Torznab provider is missing an endpoint URL"))?;

        let allow_private = self.allow_private(settings, ctx);
        let _ = validate_remote_url(feed_url, allow_private)?;

        let api_key = self.api_key(settings).await?;
        let categories = if setting.categories.is_empty() {
            &self.categories
        } else {
            &setting.categories
        };
        let limit = query.limit.min(MAX_RESULT_LIMIT);
        let request_url = build_torznab_search_url(
            feed_url,
            &query.query,
            limit,
            categories,
            api_key.as_deref(),
        )?;
        let timeout = self.setting_timeout(settings);
        let redacted = redact_torznab_url(&request_url);

        let started = Instant::now();
        let body = ctx
            .http
            .get_text_limited(
                request_url.as_str(),
                allow_private,
                Some(timeout),
                TORZNAB_MAX_RESPONSE_BYTES,
                Some(SEARCH_USER_AGENT),
                Some(feed_url),
            )
            .await
            .map_err(classify_provider_error)?;

        let (results, skipped) = parse_torznab_results(&body, &self.name)?;
        let mut sanitized = Vec::new();
        for result in results {
            match sanitize_result(result, allow_private) {
                Ok(result) => sanitized.push(result),
                Err(err) => {
                    warn!(
                        provider = %self.name,
                        error = %err,
                        "dropping invalid Torznab search result"
                    );
                }
            }
        }

        info!(
            provider = %self.name,
            format = "torznab",
            duration_ms = started.elapsed().as_millis() as u64,
            result_count = sanitized.len(),
            skipped,
            endpoint = %redacted,
            "torznab search completed"
        );

        Ok(sanitized)
    }
}

pub async fn test_torznab_provider(
    settings: &SearchSettings,
    provider_name: &str,
    secrets: Arc<dyn SearchSecretStore>,
    ctx: &SearchExecutionContext,
) -> Result<TorznabCapsTestResult> {
    let setting = settings.provider_setting(provider_name)?;
    if setting.format != SearchProviderFormat::Torznab {
        return Ok(TorznabCapsTestResult {
            ok: false,
            provider: provider_name.to_string(),
            latency_ms: None,
            supports_search: None,
            category_count: None,
            message: "Provider is not configured as Torznab".to_string(),
        });
    }

    let feed_url = setting
        .feed_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Torznab provider is missing an endpoint URL"))?;

    let allow_private = ctx.allow_private_remote_urls || setting.allow_private_url;
    let _ = validate_remote_url(feed_url, allow_private)?;

    let reference = setting
        .credential_ref
        .clone()
        .unwrap_or_else(|| credential_ref_for_provider(provider_name));
    let api_key = secrets.get_secret(&reference).await?;

    let request_url = build_torznab_caps_url(feed_url, api_key.as_deref())?;
    let timeout = Duration::from_secs(
        setting
            .timeout_seconds
            .map(clamp_provider_timeout_seconds)
            .unwrap_or(10),
    );

    let started = Instant::now();
    let body = match ctx
        .http
        .get_text_limited(
            request_url.as_str(),
            allow_private,
            Some(timeout),
            TORZNAB_MAX_RESPONSE_BYTES,
            Some(SEARCH_USER_AGENT),
            Some(feed_url),
        )
        .await
    {
        Ok(body) => body,
        Err(err) => {
            let classified = classify_provider_error(err);
            return Ok(TorznabCapsTestResult {
                ok: false,
                provider: provider_name.to_string(),
                latency_ms: Some(started.elapsed().as_millis() as u64),
                supports_search: None,
                category_count: None,
                message: sanitised_failure_message(&classified),
            });
        }
    };

    let latency_ms = started.elapsed().as_millis() as u64;
    match parse_torznab_caps(&body) {
        Ok(caps) => Ok(TorznabCapsTestResult {
            ok: true,
            provider: provider_name.to_string(),
            latency_ms: Some(latency_ms),
            supports_search: Some(caps.supports_search),
            category_count: Some(caps.category_count),
            message: "Connection successful".to_string(),
        }),
        Err(err) => Ok(TorznabCapsTestResult {
            ok: false,
            provider: provider_name.to_string(),
            latency_ms: Some(latency_ms),
            supports_search: None,
            category_count: None,
            message: sanitised_failure_message(&err),
        }),
    }
}

pub fn build_torznab_search_url(
    endpoint: &str,
    query: &str,
    limit: u32,
    categories: &[String],
    api_key: Option<&str>,
) -> Result<Url> {
    let mut url = Url::parse(endpoint).context("invalid Torznab endpoint URL")?;
    replace_query_params(
        &mut url,
        &[
            ("t", Some("search")),
            ("q", Some(query)),
            ("limit", Some(&limit.to_string())),
            ("offset", Some("0")),
            ("apikey", api_key),
            ("cat", categories_param(categories).as_deref()),
        ],
    );
    Ok(url)
}

pub fn build_torznab_caps_url(endpoint: &str, api_key: Option<&str>) -> Result<Url> {
    let mut url = Url::parse(endpoint).context("invalid Torznab endpoint URL")?;
    replace_query_params(
        &mut url,
        &[
            ("t", Some("caps")),
            ("apikey", api_key),
            ("q", None),
            ("limit", None),
            ("offset", None),
            ("cat", None),
        ],
    );
    Ok(url)
}

pub fn redact_torznab_url(url: &Url) -> String {
    // Prefer query-key redaction when a query string is present so diagnostics
    // can retain non-sensitive parameters without exposing API keys.
    if url.query().is_some() {
        redact_url_query_secrets(url)
    } else {
        redact_url_for_log(url)
    }
}

fn categories_param(categories: &[String]) -> Option<String> {
    let cats: Vec<&str> = categories
        .iter()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty() && !value.eq_ignore_ascii_case("all"))
        .collect();
    if cats.is_empty() {
        None
    } else {
        Some(cats.join(","))
    }
}

fn replace_query_params(url: &mut Url, updates: &[(&str, Option<&str>)]) {
    let mut pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .filter(|(key, _)| {
            !updates
                .iter()
                .any(|(update_key, _)| update_key.eq_ignore_ascii_case(key))
        })
        .collect();

    for (key, value) in updates {
        if let Some(value) = value {
            pairs.push(((*key).to_string(), value.to_string()));
        }
    }

    if pairs.is_empty() {
        url.set_query(None);
    } else {
        url.query_pairs_mut()
            .clear()
            .extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
}

pub fn parse_torznab_results(xml: &str, source: &str) -> Result<(Vec<SearchResult>, usize)> {
    if looks_like_html(xml) {
        return Err(anyhow!("unsupported_response: provider returned HTML"));
    }

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut current: Option<TorznabItem> = None;
    let mut current_field: Option<&'static str> = None;
    let mut results = Vec::new();
    let mut skipped = 0usize;
    let mut saw_rss = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => {
                let raw_name = event.name();
                let name = local_name_owned(raw_name.as_ref());
                if name == b"rss" || name == b"feed" {
                    saw_rss = true;
                }
                if name == b"item" {
                    current = Some(TorznabItem::default());
                    current_field = None;
                    continue;
                }
                if current.is_none() {
                    continue;
                }
                match name.as_slice() {
                    b"title" => current_field = Some("title"),
                    b"guid" => current_field = Some("guid"),
                    b"link" => current_field = Some("link"),
                    b"comments" => current_field = Some("comments"),
                    b"pubDate" | b"published" | b"updated" => current_field = Some("pubDate"),
                    b"category" => current_field = Some("category"),
                    b"enclosure" => {
                        if let Some(item) = current.as_mut() {
                            apply_enclosure(item, &event);
                        }
                        current_field = None;
                    }
                    b"attr" => {
                        if let Some(item) = current.as_mut() {
                            apply_torznab_attr(item, &event);
                        }
                        current_field = None;
                    }
                    _ => current_field = None,
                }
            }
            Ok(Event::Empty(event)) => {
                if current.is_none() {
                    continue;
                }
                let raw_name = event.name();
                let name = local_name_owned(raw_name.as_ref());
                if name.as_slice() == b"enclosure" {
                    if let Some(item) = current.as_mut() {
                        apply_enclosure(item, &event);
                    }
                } else if name.as_slice() == b"attr" {
                    if let Some(item) = current.as_mut() {
                        apply_torznab_attr(item, &event);
                    }
                }
            }
            Ok(Event::Text(event)) => {
                if let (Some(item), Some(field)) = (current.as_mut(), current_field) {
                    apply_text(item, field, decode_text(event.as_ref()));
                }
            }
            Ok(Event::CData(event)) => {
                if let (Some(item), Some(field)) = (current.as_mut(), current_field) {
                    apply_text(
                        item,
                        field,
                        String::from_utf8_lossy(event.as_ref()).trim().to_string(),
                    );
                }
            }
            Ok(Event::End(event)) => {
                let raw_name = event.name();
                let name = local_name_owned(raw_name.as_ref());
                if matches!(
                    name.as_slice(),
                    b"title"
                        | b"guid"
                        | b"link"
                        | b"comments"
                        | b"pubDate"
                        | b"published"
                        | b"updated"
                        | b"category"
                ) {
                    current_field = None;
                }
                if name.as_slice() == b"item" {
                    if let Some(item) = current.take() {
                        match item_to_result(item, source) {
                            Ok(result) => results.push(result),
                            Err(_) => skipped += 1,
                        }
                    }
                }
            }
            Ok(Event::Eof) => {
                if current.is_some() {
                    return Err(anyhow!("invalid_xml: truncated feed"));
                }
                break;
            }
            Err(err) => return Err(anyhow!("invalid_xml: {err}")),
            _ => {}
        }
        buf.clear();
    }

    if !saw_rss && results.is_empty() {
        return Err(anyhow!("invalid_xml: missing rss channel"));
    }

    Ok((results, skipped))
}

pub fn parse_torznab_caps(xml: &str) -> Result<TorznabCaps> {
    if looks_like_html(xml) {
        return Err(anyhow!("unsupported_response: provider returned HTML"));
    }
    if xml.to_ascii_lowercase().contains("unauthorized")
        || xml.to_ascii_lowercase().contains("invalid apikey")
        || xml.to_ascii_lowercase().contains("authentication")
            && xml.to_ascii_lowercase().contains("error")
    {
        // Heuristic for common auth failure payloads before XML parse.
        if xml.contains("<error") || xml.contains("\"error\"") {
            return Err(anyhow!("authentication_failed"));
        }
    }

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut buf = Vec::new();
    let mut saw_caps = false;
    let mut supports_search = false;
    let mut category_count = 0usize;
    let mut in_searching = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) | Ok(Event::Empty(event)) => {
                let raw_name = event.name();
                let name = local_name_owned(raw_name.as_ref());
                match name.as_slice() {
                    b"caps" => saw_caps = true,
                    b"error" => {
                        let code = attribute_value(&event, b"code");
                        let description =
                            attribute_value(&event, b"description").unwrap_or_default();
                        if description.to_ascii_lowercase().contains("auth")
                            || code.as_deref() == Some("100")
                            || code.as_deref() == Some("101")
                        {
                            return Err(anyhow!("authentication_failed"));
                        }
                        return Err(anyhow!("provider_error"));
                    }
                    b"searching" => in_searching = true,
                    b"search"
                        if in_searching
                            && attribute_value(&event, b"available")
                                .map(|value| value == "yes" || value == "true" || value == "1")
                                .unwrap_or(false) =>
                    {
                        supports_search = true;
                    }
                    b"category" => category_count += 1,
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                let raw_name = event.name();
                if local_name_owned(raw_name.as_ref()).as_slice() == b"searching" {
                    in_searching = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(anyhow!("invalid_xml: {err}")),
            _ => {}
        }
        buf.clear();
    }

    if !saw_caps {
        return Err(anyhow!(
            "unsupported_response: endpoint did not return Torznab capabilities"
        ));
    }

    Ok(TorznabCaps {
        supports_search,
        category_count,
    })
}

fn item_to_result(item: TorznabItem, source: &str) -> Result<SearchResult> {
    let title = item
        .title
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("missing title"))?
        .to_string();

    let magnet_uri = item
        .attrs
        .get("magneturl")
        .cloned()
        .or_else(|| {
            item.link
                .as_ref()
                .filter(|value| value.trim().to_ascii_lowercase().starts_with("magnet:"))
                .cloned()
        })
        .or_else(|| {
            item.guid
                .as_ref()
                .filter(|value| value.trim().to_ascii_lowercase().starts_with("magnet:"))
                .cloned()
        });

    if let Some(magnet) = magnet_uri.as_deref() {
        validate_magnet_uri(magnet)?;
    }

    let torrent_url = item
        .enclosure_url
        .as_ref()
        .filter(|url| {
            let lower = url.to_ascii_lowercase();
            lower.starts_with("http://") || lower.starts_with("https://")
        })
        .cloned()
        .or_else(|| {
            item.link.as_ref().and_then(|link| {
                let lower = link.to_ascii_lowercase();
                if lower.starts_with("http://") || lower.starts_with("https://") {
                    if lower.contains(".torrent")
                        || item
                            .enclosure_type
                            .as_deref()
                            .is_some_and(|value| value.contains("bittorrent"))
                    {
                        Some(link.clone())
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            // Generic Torznab download link when enclosure is absent.
            item.link.as_ref().and_then(|link| {
                let lower = link.to_ascii_lowercase();
                if (lower.starts_with("http://") || lower.starts_with("https://"))
                    && magnet_uri.is_none()
                {
                    Some(link.clone())
                } else {
                    None
                }
            })
        });

    if magnet_uri.is_none() && torrent_url.is_none() {
        return Err(anyhow!("result has neither magnet nor torrent URL"));
    }

    let size_bytes = item
        .attrs
        .get("size")
        .and_then(|value| value.parse::<u64>().ok())
        .or(item.enclosure_length);

    let seeders = parse_u32_attr(&item.attrs, "seeders");
    let leechers = parse_u32_attr(&item.attrs, "leechers").or_else(|| {
        let peers = parse_u32_attr(&item.attrs, "peers")?;
        let seeders = seeders?;
        if peers >= seeders {
            Some(peers - seeders)
        } else {
            None
        }
    });

    let info_hash = item
        .attrs
        .get("infohash")
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .or_else(|| magnet_uri.as_deref().and_then(extract_btih_from_magnet));

    let id = info_hash
        .as_ref()
        .map(|hash| format!("btih:{hash}"))
        .or_else(|| item.guid.clone())
        .unwrap_or_else(|| format!("{source}:{}", slugify(&title)));

    let description_url = item
        .comments
        .as_ref()
        .filter(|value| {
            let lower = value.to_ascii_lowercase();
            lower.starts_with("http://") || lower.starts_with("https://")
        })
        .cloned()
        .or_else(|| {
            item.link.as_ref().and_then(|link| {
                let lower = link.to_ascii_lowercase();
                if (lower.starts_with("http://") || lower.starts_with("https://"))
                    && torrent_url.as_deref() != Some(link.as_str())
                {
                    Some(link.clone())
                } else {
                    None
                }
            })
        });

    let category = item
        .attrs
        .get("category")
        .cloned()
        .or(item.category)
        .filter(|value| !value.trim().is_empty());

    let published_at = item.pub_date.as_deref().and_then(normalise_pub_date);

    Ok(SearchResult {
        id,
        source: source.to_string(),
        name: title,
        size_bytes,
        seeders,
        leechers,
        magnet_uri,
        torrent_url,
        description_url,
        published_at,
        category,
        sources: vec![source.to_string()],
    })
}

fn apply_enclosure(item: &mut TorznabItem, event: &quick_xml::events::BytesStart<'_>) {
    if let Some(url) = attribute_value(event, b"url") {
        item.enclosure_url = Some(url);
    }
    if let Some(length) = attribute_value(event, b"length").and_then(|value| value.parse().ok()) {
        item.enclosure_length = Some(length);
    }
    if let Some(content_type) = attribute_value(event, b"type") {
        item.enclosure_type = Some(content_type);
    }
}

fn apply_torznab_attr(item: &mut TorznabItem, event: &quick_xml::events::BytesStart<'_>) {
    let Some(name) = attribute_value(event, b"name") else {
        return;
    };
    let Some(value) = attribute_value(event, b"value") else {
        return;
    };
    item.attrs.insert(name.to_ascii_lowercase(), value);
}

fn apply_text(item: &mut TorznabItem, field: &str, value: String) {
    if value.is_empty() {
        return;
    }
    match field {
        "title" => item.title = Some(value),
        "guid" => item.guid = Some(value),
        "link" => item.link = Some(value),
        "comments" => item.comments = Some(value),
        "pubDate" => item.pub_date = Some(value),
        "category" if item.category.is_none() => item.category = Some(value),
        _ => {}
    }
}

fn parse_u32_attr(attrs: &BTreeMap<String, String>, key: &str) -> Option<u32> {
    attrs.get(key)?.parse::<u32>().ok()
}

fn normalise_pub_date(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Accept already-ISO timestamps.
    if trimmed.contains('T') && (trimmed.ends_with('Z') || trimmed.contains('+')) {
        return Some(trimmed.to_string());
    }
    // Best-effort RFC 2822-ish pass-through when parseable as digits/ISO date.
    if trimmed.len() >= 10 && trimmed.as_bytes()[4] == b'-' && trimmed.as_bytes()[7] == b'-' {
        return Some(trimmed.to_string());
    }
    // Keep original when it looks like an HTTP-date; UI can display raw.
    if trimmed.len() <= 64 {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn looks_like_html(body: &str) -> bool {
    let lower = body.trim_start().to_ascii_lowercase();
    lower.starts_with("<!doctype html") || lower.starts_with("<html")
}

fn local_name_owned(name: &[u8]) -> Vec<u8> {
    name.rsplit(|byte| *byte == b':')
        .next()
        .unwrap_or(name)
        .to_vec()
}

fn attribute_value(event: &quick_xml::events::BytesStart<'_>, key: &[u8]) -> Option<String> {
    event
        .attributes()
        .filter_map(|attr| attr.ok())
        .find_map(|attr| {
            if local_name_owned(attr.key.as_ref()).as_slice() == key {
                Some(String::from_utf8_lossy(&attr.value).trim().to_string())
            } else {
                None
            }
        })
}

fn decode_text(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).trim().to_string()
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
        .chars()
        .take(80)
        .collect()
}

pub fn classify_provider_error(err: anyhow::Error) -> anyhow::Error {
    let message = err.to_string().to_ascii_lowercase();
    if message.contains("timed out") || message.contains("timeout") {
        return anyhow!("timeout: Connection timed out");
    }
    if message.contains("connection refused") {
        return anyhow!("connection_refused: Connection refused");
    }
    if message.contains("dns")
        || message.contains("no such host")
        || message.contains("name resolution")
    {
        return anyhow!("dns_failed: DNS lookup failed");
    }
    if message.contains("response_too_large") || message.contains("too large") {
        return anyhow!("response_too_large: Provider response exceeded size limit");
    }
    if message.contains("401") || message.contains("403") || message.contains("authentication") {
        return anyhow!("authentication_failed: Authentication failed");
    }
    if message.contains("invalid_xml") {
        return anyhow!("invalid_xml: Provider returned invalid XML");
    }
    if message.contains("private or localhost") {
        return anyhow!("invalid_configuration: Private endpoint blocked");
    }
    if message.contains("missing") && message.contains("credential") {
        return anyhow!("missing_credentials: API key is not configured");
    }
    anyhow!("provider_error: Provider request failed")
}

fn sanitised_failure_message(err: &anyhow::Error) -> String {
    let text = err.to_string();
    if let Some((_, message)) = text.split_once(": ") {
        message.to_string()
    } else if text.contains("authentication_failed") {
        "Authentication failed".to_string()
    } else {
        "Provider connection failed".to_string()
    }
}

/// Extend URL redaction to strip sensitive query keys while keeping host/path.
pub fn redact_url_query_secrets(url: &Url) -> String {
    let mut cloned = url.clone();
    let pairs: Vec<(String, String)> = cloned
        .query_pairs()
        .map(|(key, value)| {
            if SENSITIVE_QUERY_KEYS
                .iter()
                .any(|sensitive| key.eq_ignore_ascii_case(sensitive))
            {
                (key.into_owned(), "REDACTED".to_string())
            } else {
                (key.into_owned(), value.into_owned())
            }
        })
        .collect();
    if pairs.is_empty() {
        cloned.set_query(None);
    } else {
        cloned
            .query_pairs_mut()
            .clear()
            .extend_pairs(pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())));
    }
    cloned.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_search_url_with_escaped_query_and_categories() {
        let url = build_torznab_search_url(
            "http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/",
            "ubuntu 24.04",
            25,
            &["2000".to_string(), "5000".to_string()],
            Some("secret-key"),
        )
        .unwrap();
        let query = url.query().unwrap_or_default();
        assert!(query.contains("t=search"));
        assert!(query.contains("q=ubuntu+24.04") || query.contains("q=ubuntu%2024.04"));
        assert!(query.contains("limit=25"));
        assert!(query.contains("cat=2000%2C5000") || query.contains("cat=2000,5000"));
        assert!(query.contains("apikey=secret-key"));
        assert!(url
            .path()
            .contains("/api/v2.0/indexers/all/results/torznab"));
    }

    #[test]
    fn redacts_api_key_from_diagnostics_url() {
        let url = build_torznab_search_url(
            "https://indexer.example/torznab",
            "debian",
            10,
            &[],
            Some("super-secret"),
        )
        .unwrap();
        let redacted = redact_url_query_secrets(&url);
        assert!(!redacted.contains("super-secret"));
        assert!(redacted.contains("REDACTED"));
    }

    #[test]
    fn parses_standard_torznab_item() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
          <channel>
            <item>
              <title>Ubuntu 24.04 Desktop</title>
              <guid>abc</guid>
              <link>https://example.com/ubuntu</link>
              <comments>https://example.com/ubuntu</comments>
              <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
              <enclosure url="https://example.com/ubuntu.torrent" length="12345" type="application/x-bittorrent" />
              <torznab:attr name="seeders" value="42" />
              <torznab:attr name="peers" value="50" />
              <torznab:attr name="size" value="12345" />
              <torznab:attr name="infohash" value="0123456789abcdef0123456789abcdef01234567" />
              <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567" />
              <torznab:attr name="category" value="2000" />
            </item>
          </channel>
        </rss>"#;
        let (results, skipped) = parse_torznab_results(xml, "local_jackett").unwrap();
        assert_eq!(skipped, 0);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Ubuntu 24.04 Desktop");
        assert_eq!(results[0].seeders, Some(42));
        assert_eq!(results[0].leechers, Some(8));
        assert_eq!(results[0].size_bytes, Some(12345));
        assert!(results[0].magnet_uri.is_some());
        assert_eq!(results[0].category.as_deref(), Some("2000"));
        assert_eq!(
            results[0].id,
            "btih:0123456789abcdef0123456789abcdef01234567"
        );
    }

    #[test]
    fn parses_newznab_namespace_attrs() {
        let xml = r#"<?xml version="1.0"?>
        <rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
          <channel>
            <item>
              <title>OpenSUSE</title>
              <link>magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</link>
              <newznab:attr name="seeders" value="3" />
              <newznab:attr name="size" value="999" />
            </item>
          </channel>
        </rss>"#;
        let (results, _) = parse_torznab_results(xml, "prowlarr").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].seeders, Some(3));
        assert!(results[0].magnet_uri.is_some());
    }

    #[test]
    fn skips_item_without_magnet_or_torrent() {
        let xml = r#"<?xml version="1.0"?><rss><channel>
            <item><title>No links</title></item>
            <item>
              <title>Has torrent</title>
              <enclosure url="https://example.com/a.torrent" length="1" type="application/x-bittorrent" />
            </item>
        </channel></rss>"#;
        let (results, skipped) = parse_torznab_results(xml, "x").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(skipped, 1);
    }

    #[test]
    fn rejects_malformed_xml() {
        assert!(parse_torznab_results("<rss><channel><item>", "x").is_err());
    }

    #[test]
    fn parses_caps_document() {
        let xml = r#"<?xml version="1.0"?>
        <caps>
          <searching>
            <search available="yes" />
            <tv-search available="no" />
          </searching>
          <categories>
            <category id="2000" name="Movies" />
            <category id="5000" name="TV" />
          </categories>
        </caps>"#;
        let caps = parse_torznab_caps(xml).unwrap();
        assert!(caps.supports_search);
        assert_eq!(caps.category_count, 2);
    }

    #[test]
    fn caps_detects_auth_error() {
        let xml = r#"<?xml version="1.0"?><error code="100" description="Invalid API key" />"#;
        let err = parse_torznab_caps(xml).unwrap_err().to_string();
        assert!(err.contains("authentication_failed"));
    }
}
