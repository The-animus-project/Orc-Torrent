use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet},
    net::IpAddr,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use quick_xml::{events::Event, Reader};
use reqwest::{redirect::Policy, Client};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::sync::Semaphore;
use tracing::warn;
use url::Url;

mod dedup;
mod magnet;
mod movies;
pub mod secrets;
pub mod torznab;

pub use secrets::{
    create_default_secret_store, credential_ref_for_provider, InMemorySearchSecretStore,
    SearchSecretStore,
};
pub use torznab::{test_torznab_provider, TorznabProvider};

const QUERY_MIN_LEN: usize = 2;
const QUERY_MAX_LEN: usize = 200;
const CATEGORY_MAX_LEN: usize = 64;
const SOURCE_NAME_MAX_LEN: usize = 32;
const PROVIDER_LABEL_MAX_LEN: usize = 64;
const PROVIDER_URL_MAX_LEN: usize = 2048;
const DEFAULT_RESULT_LIMIT: u32 = 25;
pub const MAX_RESULT_LIMIT: u32 = 100;
const SEARCH_HTTP_TIMEOUT: Duration = Duration::from_secs(10);
pub(crate) const SEARCH_USER_AGENT: &str =
    "ORC-Torrent/2.2 (+https://github.com/The-Animus-Project/Orc-Torrent)";
const SAFETY_NOTE: &str = "Only use torrents you have the legal right to download.";
const ANIMUS_SAFETY_NOTE: &str =
    "Enter a title to search movie and TV providers. Only add torrents you have the legal right to download.";
const ALL_PROVIDERS_SOURCE: &str = "all";
const DEFAULT_PROVIDER_TIMEOUT_SECS: u64 = 10;
const MIN_PROVIDER_TIMEOUT_SECS: u64 = 2;
const MAX_PROVIDER_TIMEOUT_SECS: u64 = 60;
const MAX_CONCURRENT_PROVIDERS: usize = 8;
const MAX_SEARCH_RESPONSE_BYTES: u64 = 5 * 1024 * 1024;

pub const ANIMUS_EDITION: &str = "animus";

pub fn current_product_edition() -> String {
    std::env::var("ORC_TORRENT_EDITION")
        .unwrap_or_else(|_| String::new())
        .trim()
        .to_string()
}

pub fn is_animus_edition(edition: &str) -> bool {
    edition.eq_ignore_ascii_case(ANIMUS_EDITION)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SearchProviderSetting {
    pub name: String,
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub feed_url: Option<String>,
    #[serde(default)]
    pub format: SearchProviderFormat,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub categories: Vec<String>,
    /// Opaque reference into the secret store. Never holds the raw API key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_ref: Option<String>,
    /// Explicit consent for loopback/RFC1918 Torznab endpoints (Jackett/Prowlarr).
    #[serde(default)]
    pub allow_private_url: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SearchProviderFormat {
    #[default]
    OpenContentJson,
    RssAtom,
    Torznab,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSettings {
    #[serde(default = "default_search_enabled")]
    pub enabled: bool,
    #[serde(default = "default_provider_name")]
    pub default_provider: Option<String>,
    #[serde(default = "default_result_limit")]
    pub default_result_limit: u32,
    #[serde(default)]
    pub allow_private_remote_urls: bool,
    #[serde(default = "default_provider_settings")]
    pub providers: Vec<SearchProviderSetting>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchSettingsPatchRequest {
    pub enabled: Option<bool>,
    pub default_provider: Option<String>,
    pub default_result_limit: Option<u32>,
    pub allow_private_remote_urls: Option<bool>,
    pub providers: Option<Vec<SearchProviderSetting>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchSettingsResponse {
    pub enabled: bool,
    pub default_provider: Option<String>,
    pub default_result_limit: u32,
    pub allow_private_remote_urls: bool,
    pub providers: Vec<SearchProviderInfo>,
    pub safety_note: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchProviderInfo {
    pub name: String,
    pub label: String,
    pub enabled: bool,
    pub configured: bool,
    pub is_custom: bool,
    pub supports_browse: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_format: Option<SearchProviderFormat>,
    pub categories: Vec<String>,
    pub requires_feed_url: bool,
    pub description: String,
    #[serde(default)]
    pub has_credentials: bool,
    #[serde(default)]
    pub allow_private_url: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connection_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tested_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchQuery {
    pub query: String,
    pub category: Option<String>,
    pub limit: Option<u32>,
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub source: String,
    pub name: String,
    pub size_bytes: Option<u64>,
    pub seeders: Option<u32>,
    pub leechers: Option<u32>,
    pub magnet_uri: Option<String>,
    pub torrent_url: Option<String>,
    pub description_url: Option<String>,
    pub published_at: Option<String>,
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedSearchQuery {
    pub(crate) query: String,
    pub(crate) category: Option<String>,
    pub(crate) limit: u32,
    pub(crate) sources: Vec<String>,
    pub(crate) browse_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchProviderStatus {
    pub name: String,
    pub label: String,
    pub configured: bool,
    pub ok: bool,
    pub result_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(default)]
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub providers: Vec<SearchProviderStatus>,
    pub browse_mode: bool,
}

#[derive(Clone)]
pub(crate) struct SearchExecutionContext {
    pub(crate) http: SearchHttpClient,
    pub(crate) allow_private_remote_urls: bool,
    pub(crate) secrets: Arc<dyn SearchSecretStore>,
}

#[derive(Debug, Clone)]
pub(crate) struct SearchHttpClient {
    client: Client,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum OpenContentFeedResponse {
    Array(Vec<OpenContentFeedItem>),
    Object { items: Vec<OpenContentFeedItem> },
}

#[derive(Debug, Clone, Deserialize)]
struct OpenContentFeedItem {
    id: Option<String>,
    name: String,
    size_bytes: Option<u64>,
    seeders: Option<u32>,
    leechers: Option<u32>,
    magnet_uri: Option<String>,
    torrent_url: Option<String>,
    description_url: Option<String>,
    published_at: Option<String>,
    category: Option<String>,
}

#[async_trait]
pub(crate) trait SearchProvider: Send + Sync {
    fn name(&self) -> &str;
    fn label(&self) -> &str;
    fn description(&self) -> &str;
    fn categories(&self) -> Vec<String>;
    fn provider_format(&self) -> Option<SearchProviderFormat> {
        None
    }
    fn supports_browse(&self) -> bool {
        false
    }
    fn requires_feed_url(&self) -> bool {
        false
    }
    fn configured(&self, settings: &SearchSettings) -> bool;
    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>>;
}

struct MockSearchProvider;
struct OpenContentProvider;
struct InternetArchiveProvider {
    name: &'static str,
    label: &'static str,
    description: &'static str,
    categories: &'static [&'static str],
    base_query: &'static str,
}
struct CustomFeedProvider {
    name: String,
    label: String,
    categories: Vec<String>,
    format: SearchProviderFormat,
}

pub fn default_search_enabled() -> bool {
    true
}

pub fn default_provider_name() -> Option<String> {
    if is_animus_edition(&current_product_edition()) {
        return Some("yts".to_string());
    }
    Some("internet_archive".to_string())
}

pub fn default_provider_settings() -> Vec<SearchProviderSetting> {
    default_provider_settings_for_edition(&current_product_edition())
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn animus_media_provider_names() -> &'static [&'static str] {
    &["yts", "tpb_movies", "tpb_tv", "x1337_movies", "x1337_tv"]
}

pub fn media_provider_priority(name: &str) -> u8 {
    match name {
        "yts" => 0,
        "tpb_movies" | "tpb_tv" => 1,
        "x1337_movies" | "x1337_tv" => 2,
        _ => 50,
    }
}

fn compare_media_provider_priority(left: &str, right: &str) -> Ordering {
    media_provider_priority(left).cmp(&media_provider_priority(right))
}

pub fn animus_excluded_provider_names() -> &'static [&'static str] {
    &["internet_archive", "internet_archive_software"]
}

fn is_animus_blocked_provider(name: &str) -> bool {
    is_animus_edition(&current_product_edition())
        && animus_excluded_provider_names().contains(&name)
}

pub fn default_provider_settings_for_edition(edition: &str) -> Vec<SearchProviderSetting> {
    let animus = is_animus_edition(edition);
    vec![
        SearchProviderSetting {
            name: "mock".to_string(),
            enabled: false,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "internet_archive".to_string(),
            enabled: !animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "internet_archive_software".to_string(),
            enabled: false,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "open_content".to_string(),
            enabled: false,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "yts".to_string(),
            enabled: animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "tpb_movies".to_string(),
            enabled: animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "x1337_movies".to_string(),
            enabled: animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "tpb_tv".to_string(),
            enabled: animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
        SearchProviderSetting {
            name: "x1337_tv".to_string(),
            enabled: animus,
            label: None,
            feed_url: None,
            format: SearchProviderFormat::OpenContentJson,
            categories: Vec::new(),
            credential_ref: None,
            allow_private_url: false,
            timeout_seconds: None,
        },
    ]
}

/// Applies edition-specific search defaults to persisted settings.
/// Returns true when settings were modified.
pub fn apply_edition_search_defaults(settings: &mut SearchSettings) -> bool {
    apply_edition_search_defaults_for_edition(settings, &current_product_edition())
}

fn apply_edition_search_defaults_for_edition(settings: &mut SearchSettings, edition: &str) -> bool {
    if !is_animus_edition(edition) {
        return false;
    }

    let mut changed = false;

    if !settings.enabled {
        settings.enabled = true;
        changed = true;
    }

    let animus_defaults = default_provider_settings_for_edition(ANIMUS_EDITION);
    let mut saved_by_name = settings
        .providers
        .iter()
        .enumerate()
        .map(|(idx, provider)| (provider.name.clone(), idx))
        .collect::<BTreeMap<_, _>>();

    for default in animus_defaults {
        if !default.enabled {
            continue;
        }
        if let Some(idx) = saved_by_name.get(&default.name).copied() {
            if !settings.providers[idx].enabled {
                settings.providers[idx].enabled = true;
                changed = true;
            }
        } else {
            let name = default.name.clone();
            settings.providers.push(default);
            saved_by_name.insert(name, settings.providers.len() - 1);
            changed = true;
        }
    }

    for blocked in animus_excluded_provider_names() {
        if let Some(idx) = saved_by_name.get(*blocked).copied() {
            if settings.providers[idx].enabled {
                settings.providers[idx].enabled = false;
                changed = true;
            }
        }
    }

    let default_provider = settings.default_provider.as_deref();
    let should_set_movie_default = match default_provider {
        None | Some("internet_archive") => true,
        Some(name) => settings
            .providers
            .iter()
            .find(|provider| provider.name == name)
            .map(|provider| !provider.enabled)
            .unwrap_or(true),
    };
    if should_set_movie_default {
        settings.default_provider = Some("yts".to_string());
        changed = true;
    }

    changed
}

pub fn default_result_limit() -> u32 {
    DEFAULT_RESULT_LIMIT
}

impl Default for SearchSettings {
    fn default() -> Self {
        Self {
            enabled: default_search_enabled(),
            default_provider: default_provider_name(),
            default_result_limit: default_result_limit(),
            allow_private_remote_urls: false,
            providers: default_provider_settings(),
        }
    }
}

impl SearchSettings {
    pub fn validate(&self) -> Result<()> {
        if self.default_result_limit == 0 {
            return Err(anyhow!("default_result_limit must be at least 1"));
        }
        if self.default_result_limit > MAX_RESULT_LIMIT {
            return Err(anyhow!(
                "default_result_limit cannot exceed {}",
                MAX_RESULT_LIMIT
            ));
        }

        let providers = self.provider_map()?;
        if let Some(default_provider) = self.default_provider.as_deref() {
            validate_provider_name(default_provider)?;
            if is_animus_blocked_provider(default_provider) {
                return Err(anyhow!(
                    "default_provider {} is not available in AnimUS edition",
                    default_provider
                ));
            }
            let Some(provider) = providers.get(default_provider) else {
                return Err(anyhow!("default_provider must reference a known provider"));
            };
            if !provider.enabled {
                return Err(anyhow!("default_provider must be enabled"));
            }
        }

        if is_animus_edition(&current_product_edition()) {
            for name in animus_excluded_provider_names() {
                if let Some(provider) = providers.get(*name) {
                    if provider.enabled {
                        return Err(anyhow!(
                            "provider {} is not available in AnimUS edition",
                            name
                        ));
                    }
                }
            }
        }

        Ok(())
    }

    pub fn provider_map(&self) -> Result<BTreeMap<String, SearchProviderSetting>> {
        let mut merged = BTreeMap::new();
        for provider in default_provider_settings() {
            merged.insert(provider.name.clone(), provider);
        }

        let mut seen = BTreeSet::new();
        for provider in &self.providers {
            validate_provider_name(&provider.name)?;
            if !seen.insert(provider.name.clone()) {
                return Err(anyhow!("duplicate provider setting for {}", provider.name));
            }
            if provider.name.len() > SOURCE_NAME_MAX_LEN {
                return Err(anyhow!(
                    "provider name too long (max {} chars)",
                    SOURCE_NAME_MAX_LEN
                ));
            }
            let mut provider = provider.clone();
            if provider.format == SearchProviderFormat::Torznab {
                if provider.credential_ref.is_none() {
                    provider.credential_ref = Some(credential_ref_for_provider(&provider.name));
                }
                if let Some(timeout) = provider.timeout_seconds {
                    provider.timeout_seconds = Some(clamp_provider_timeout_seconds(timeout));
                }
            } else if provider.allow_private_url {
                return Err(anyhow!(
                    "allow_private_url is only valid for Torznab providers"
                ));
            }
            if let Some(feed_url) = provider.feed_url.as_deref() {
                validate_provider_feed_url(feed_url, provider.allow_private_url)?;
            }
            if let Some(label) = provider.label.as_deref() {
                validate_provider_label(label)?;
            }
            for category in &provider.categories {
                if provider.format == SearchProviderFormat::Torznab {
                    validate_torznab_category(category)?;
                } else {
                    validate_category_value(category)?;
                }
            }
            if !is_known_provider_name(&provider.name) {
                if provider.feed_url.is_none() {
                    return Err(anyhow!(
                        "custom provider {} must include a feed_url",
                        provider.name
                    ));
                }
                if provider
                    .label
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    return Err(anyhow!(
                        "custom provider {} must include a label",
                        provider.name
                    ));
                }
            }
            merged.insert(provider.name.clone(), provider);
        }

        Ok(merged)
    }

    pub(crate) fn provider_setting(&self, name: &str) -> Result<SearchProviderSetting> {
        let providers = self.provider_map()?;
        providers
            .get(name)
            .cloned()
            .ok_or_else(|| anyhow!("unknown provider {}", name))
    }

    fn enabled_provider_names(&self) -> Result<Vec<String>> {
        let mut enabled = self
            .provider_map()?
            .into_values()
            .filter(|provider| provider.enabled && !is_animus_blocked_provider(&provider.name))
            .map(|provider| provider.name)
            .collect::<Vec<_>>();
        if enabled.is_empty() {
            return Err(anyhow!("no enabled search providers are configured"));
        }
        enabled.sort_by(|left, right| {
            compare_media_provider_priority(left, right).then_with(|| left.cmp(right))
        });
        Ok(enabled)
    }
}

impl SearchSettingsPatchRequest {
    pub fn validate(&self) -> Result<()> {
        if let Some(default_provider) = self.default_provider.as_deref() {
            validate_provider_name(default_provider)?;
        }
        if let Some(default_result_limit) = self.default_result_limit {
            if default_result_limit == 0 || default_result_limit > MAX_RESULT_LIMIT {
                return Err(anyhow!(
                    "default_result_limit must be between 1 and {}",
                    MAX_RESULT_LIMIT
                ));
            }
        }
        if let Some(providers) = &self.providers {
            let mut names = BTreeSet::new();
            for provider in providers {
                validate_provider_name(&provider.name)?;
                if !names.insert(provider.name.clone()) {
                    return Err(anyhow!("duplicate provider setting for {}", provider.name));
                }
                if let Some(feed_url) = provider.feed_url.as_deref() {
                    validate_provider_feed_url(feed_url, provider.allow_private_url)?;
                }
                if let Some(timeout) = provider.timeout_seconds {
                    let _ = clamp_provider_timeout_seconds(timeout);
                }
            }
        }

        Ok(())
    }

    pub fn apply(&self, current: &SearchSettings) -> Result<SearchSettings> {
        let mut next = current.clone();
        if let Some(enabled) = self.enabled {
            next.enabled = enabled;
        }
        if let Some(default_provider) = self.default_provider.as_ref() {
            next.default_provider = Some(default_provider.clone());
        }
        if let Some(default_result_limit) = self.default_result_limit {
            next.default_result_limit = default_result_limit;
        }
        if let Some(allow_private_remote_urls) = self.allow_private_remote_urls {
            next.allow_private_remote_urls = allow_private_remote_urls;
        }
        if let Some(providers) = self.providers.as_ref() {
            next.providers = providers
                .iter()
                .map(|provider| {
                    let mut provider = provider.clone();
                    if provider.format == SearchProviderFormat::Torznab
                        && provider.credential_ref.is_none()
                    {
                        provider.credential_ref = Some(credential_ref_for_provider(&provider.name));
                    }
                    if let Some(timeout) = provider.timeout_seconds {
                        provider.timeout_seconds = Some(clamp_provider_timeout_seconds(timeout));
                    }
                    provider
                })
                .collect();
        }
        next.validate()?;
        Ok(next)
    }
}

impl SearchQuery {
    fn resolve(&self, settings: &SearchSettings) -> Result<ResolvedSearchQuery> {
        let trimmed_query = self.query.trim();
        let browse_mode = trimmed_query.is_empty();
        if browse_mode && is_animus_edition(&current_product_edition()) {
            return Err(anyhow!(
                "query is required for AnimUS search (enter at least {} characters)",
                QUERY_MIN_LEN
            ));
        }
        if !browse_mode && trimmed_query.len() < QUERY_MIN_LEN {
            return Err(anyhow!(
                "query must be at least {} characters",
                QUERY_MIN_LEN
            ));
        }
        if trimmed_query.len() > QUERY_MAX_LEN {
            return Err(anyhow!("query cannot exceed {} characters", QUERY_MAX_LEN));
        }

        let category = self
            .category
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| {
                if value.len() > CATEGORY_MAX_LEN {
                    Err(anyhow!(
                        "category cannot exceed {} characters",
                        CATEGORY_MAX_LEN
                    ))
                } else {
                    Ok(value.to_string())
                }
            })
            .transpose()?;

        let limit = self.limit.unwrap_or(settings.default_result_limit);
        if limit == 0 {
            return Err(anyhow!("limit must be at least 1"));
        }
        let limited = limit.min(MAX_RESULT_LIMIT);

        let sources = match self
            .source
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(source) if source.eq_ignore_ascii_case(ALL_PROVIDERS_SOURCE) => {
                settings.enabled_provider_names()?
            }
            Some(source) => {
                validate_provider_name(source)?;
                if is_animus_blocked_provider(source) {
                    return Err(anyhow!(
                        "provider {} is not available in AnimUS edition",
                        source
                    ));
                }
                let provider = settings.provider_setting(source)?;
                if !provider.enabled {
                    return Err(anyhow!("provider {} is disabled", source));
                }
                vec![source.to_string()]
            }
            None => settings.enabled_provider_names()?,
        };

        Ok(ResolvedSearchQuery {
            query: trimmed_query.to_string(),
            category,
            limit: limited,
            sources,
            browse_mode,
        })
    }
}

pub fn search_settings_response(settings: &SearchSettings) -> Result<SearchSettingsResponse> {
    settings.validate()?;
    let providers = available_providers(settings)?;
    let safety_note = if is_animus_edition(&current_product_edition()) {
        ANIMUS_SAFETY_NOTE.to_string()
    } else {
        SAFETY_NOTE.to_string()
    };
    Ok(SearchSettingsResponse {
        enabled: settings.enabled,
        default_provider: settings.default_provider.clone(),
        default_result_limit: settings.default_result_limit,
        allow_private_remote_urls: settings.allow_private_remote_urls,
        providers,
        safety_note,
    })
}

pub async fn search_settings_response_with_secrets(
    settings: &SearchSettings,
    secrets: &dyn SearchSecretStore,
) -> Result<SearchSettingsResponse> {
    let mut response = search_settings_response(settings)?;
    for provider in &mut response.providers {
        if provider.provider_format == Some(SearchProviderFormat::Torznab) {
            let reference = settings
                .provider_setting(&provider.name)
                .ok()
                .and_then(|setting| setting.credential_ref)
                .unwrap_or_else(|| credential_ref_for_provider(&provider.name));
            provider.has_credentials = secrets.has_secret(&reference).await.unwrap_or(false);
        }
    }
    Ok(response)
}

pub fn available_providers(settings: &SearchSettings) -> Result<Vec<SearchProviderInfo>> {
    settings.validate()?;
    let registry = SearchRegistry::new(settings, Arc::new(InMemorySearchSecretStore::new()));
    let mut providers = registry.describe(settings);
    if is_animus_edition(&current_product_edition()) {
        providers.retain(|provider| !is_animus_blocked_provider(&provider.name));
    }
    Ok(providers)
}

pub async fn available_providers_with_secrets(
    settings: &SearchSettings,
    secrets: Arc<dyn SearchSecretStore>,
) -> Result<Vec<SearchProviderInfo>> {
    settings.validate()?;
    let registry = SearchRegistry::new(settings, secrets.clone());
    let mut providers = registry.describe(settings);
    if is_animus_edition(&current_product_edition()) {
        providers.retain(|provider| !is_animus_blocked_provider(&provider.name));
    }
    for provider in &mut providers {
        if provider.provider_format == Some(SearchProviderFormat::Torznab) {
            let reference = settings
                .provider_setting(&provider.name)
                .ok()
                .and_then(|setting| setting.credential_ref)
                .unwrap_or_else(|| credential_ref_for_provider(&provider.name));
            provider.has_credentials = secrets.has_secret(&reference).await.unwrap_or(false);
        }
    }
    Ok(providers)
}

#[cfg_attr(not(test), allow(dead_code))]
pub async fn execute_search(
    settings: &SearchSettings,
    query: SearchQuery,
) -> Result<SearchResponse> {
    execute_search_with_secrets(settings, query, Arc::new(InMemorySearchSecretStore::new())).await
}

pub async fn execute_search_with_secrets(
    settings: &SearchSettings,
    query: SearchQuery,
    secrets: Arc<dyn SearchSecretStore>,
) -> Result<SearchResponse> {
    settings.validate()?;
    if !settings.enabled {
        return Err(anyhow!("search is disabled in settings"));
    }

    let resolved = query.resolve(settings)?;
    let registry = SearchRegistry::new(settings, secrets.clone());
    let ctx = SearchExecutionContext {
        http: SearchHttpClient::new()?,
        allow_private_remote_urls: settings.allow_private_remote_urls,
        secrets,
    };

    registry.search(&resolved, settings, &ctx).await
}

pub fn clamp_provider_timeout_seconds(value: u64) -> u64 {
    value.clamp(MIN_PROVIDER_TIMEOUT_SECS, MAX_PROVIDER_TIMEOUT_SECS)
}

pub fn removed_provider_credential_refs(
    before: &SearchSettings,
    after: &SearchSettings,
) -> Vec<String> {
    let before_map = before.provider_map().unwrap_or_default();
    let after_map = after.provider_map().unwrap_or_default();
    before_map
        .into_iter()
        .filter_map(|(name, setting)| {
            if after_map.contains_key(&name) {
                return None;
            }
            if setting.format != SearchProviderFormat::Torznab {
                return None;
            }
            Some(
                setting
                    .credential_ref
                    .unwrap_or_else(|| credential_ref_for_provider(&name)),
            )
        })
        .collect()
}

fn validate_provider_name(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider name cannot be empty"));
    }
    if trimmed.len() > SOURCE_NAME_MAX_LEN {
        return Err(anyhow!(
            "provider name cannot exceed {} characters",
            SOURCE_NAME_MAX_LEN
        ));
    }
    if !trimmed
        .chars()
        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
    {
        return Err(anyhow!(
            "provider name may only contain lowercase letters, numbers, underscores, and dashes"
        ));
    }
    Ok(())
}

fn validate_provider_feed_url(value: &str, allow_private_url: bool) -> Result<()> {
    if value.len() > PROVIDER_URL_MAX_LEN {
        return Err(anyhow!(
            "feed_url cannot exceed {} characters",
            PROVIDER_URL_MAX_LEN
        ));
    }
    let _ = validate_remote_url(value, allow_private_url)?;
    Ok(())
}

fn validate_torznab_category(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider categories cannot be empty"));
    }
    if trimmed.eq_ignore_ascii_case("all") {
        return Ok(());
    }
    if !trimmed.chars().all(|ch| ch.is_ascii_digit()) {
        return Err(anyhow!("Torznab categories must be numeric category IDs"));
    }
    if trimmed.len() > CATEGORY_MAX_LEN {
        return Err(anyhow!(
            "category cannot exceed {} characters",
            CATEGORY_MAX_LEN
        ));
    }
    Ok(())
}

fn validate_provider_label(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider label cannot be empty"));
    }
    if trimmed.len() > PROVIDER_LABEL_MAX_LEN {
        return Err(anyhow!(
            "provider label cannot exceed {} characters",
            PROVIDER_LABEL_MAX_LEN
        ));
    }
    Ok(())
}

fn validate_category_value(value: &str) -> Result<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("provider categories cannot be empty"));
    }
    if trimmed.len() > CATEGORY_MAX_LEN {
        return Err(anyhow!(
            "category cannot exceed {} characters",
            CATEGORY_MAX_LEN
        ));
    }
    Ok(())
}

fn is_known_provider_name(name: &str) -> bool {
    matches!(
        name,
        "mock"
            | "open_content"
            | "internet_archive"
            | "internet_archive_software"
            | "yts"
            | "tpb_movies"
            | "tpb_tv"
            | "x1337_movies"
            | "x1337_tv"
    )
}

pub(crate) fn validate_remote_url(raw: &str, allow_private_remote_urls: bool) -> Result<Url> {
    let url = Url::parse(raw).context("invalid URL")?;
    match url.scheme() {
        "http" | "https" => {}
        _ => return Err(anyhow!("URL scheme must be http or https")),
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err(anyhow!(
            "URLs containing embedded credentials are not allowed"
        ));
    }

    let host = url
        .host_str()
        .ok_or_else(|| anyhow!("URL must include a host"))?;
    if host.len() > PROVIDER_LABEL_MAX_LEN {
        return Err(anyhow!(
            "URL host cannot exceed {} characters",
            PROVIDER_LABEL_MAX_LEN
        ));
    }

    if !allow_private_remote_urls {
        if host.eq_ignore_ascii_case("localhost")
            || host.eq_ignore_ascii_case("localhost.localdomain")
            || host.ends_with(".local")
            || host.ends_with(".internal")
            || host.ends_with(".localhost")
        {
            return Err(anyhow!("private or localhost hosts are blocked"));
        }

        if let Ok(ip) = host.parse::<IpAddr>() {
            if is_private_ip(ip) {
                return Err(anyhow!("private or localhost IP addresses are blocked"));
            }
        }
    }

    Ok(url)
}

pub fn validate_magnet_uri(raw: &str) -> Result<()> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("magnet URI cannot be empty"));
    }
    if trimmed.len() > 4096 {
        return Err(anyhow!("magnet URI is too long"));
    }
    let url = Url::parse(trimmed).context("invalid magnet URI")?;
    if url.scheme() != "magnet" {
        return Err(anyhow!("magnet URI must use the magnet scheme"));
    }
    let xt_values: Vec<_> = url.query_pairs().filter(|(key, _)| key == "xt").collect();
    if xt_values.is_empty() {
        return Err(anyhow!("magnet URI must include an xt parameter"));
    }

    let has_btih = xt_values.iter().any(|(_, value)| {
        let value = value.as_ref();
        value
            .strip_prefix("urn:btih:")
            .map(|hash| {
                let is_hex = hash.len() == 40 && hash.chars().all(|ch| ch.is_ascii_hexdigit());
                let is_base32 = hash.len() == 32
                    && hash
                        .chars()
                        .all(|ch| matches!(ch, 'A'..='Z' | 'a'..='z' | '2'..='7'));
                is_hex || is_base32
            })
            .unwrap_or(false)
    });

    if !has_btih {
        return Err(anyhow!("magnet URI must include a valid btih hash"));
    }

    Ok(())
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            ipv4.is_private()
                || ipv4.is_loopback()
                || ipv4.is_link_local()
                || ipv4.is_broadcast()
                || ipv4.is_unspecified()
                || ipv4.octets()[0] == 0
                || ipv4.octets()[0] == 169 && ipv4.octets()[1] == 254
                || ipv4.octets()[0] >= 224
        }
        IpAddr::V6(ipv6) => {
            ipv6.is_loopback()
                || ipv6.is_unspecified()
                || ipv6.is_multicast()
                || ipv6.is_unique_local()
                || ipv6.is_unicast_link_local()
        }
    }
}

pub(crate) fn redact_url_for_log(url: &Url) -> String {
    // Strip the query string entirely so API keys never appear in diagnostics.
    let mut cloned = url.clone();
    cloned.set_query(None);
    cloned.set_fragment(None);
    cloned.to_string()
}

pub(crate) fn sanitize_result(
    result: SearchResult,
    allow_private_remote_urls: bool,
) -> Result<SearchResult> {
    let name = result.name.trim();
    if name.is_empty() {
        return Err(anyhow!("search results must include a name"));
    }
    if name.len() > 500 {
        return Err(anyhow!("search result names cannot exceed 500 characters"));
    }

    let magnet_uri = match result
        .magnet_uri
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            validate_magnet_uri(value)?;
            Some(value.to_string())
        }
        None => None,
    };

    let torrent_url = match result
        .torrent_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(validate_remote_url(value, allow_private_remote_urls)?.to_string()),
        None => None,
    };

    let description_url = match result
        .description_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(validate_remote_url(value, allow_private_remote_urls)?.to_string()),
        None => None,
    };

    let sources = if result.sources.is_empty() {
        vec![result.source.clone()]
    } else {
        result.sources
    };

    Ok(SearchResult {
        id: result.id,
        source: result.source,
        name: name.to_string(),
        size_bytes: result.size_bytes,
        seeders: result.seeders,
        leechers: result.leechers,
        magnet_uri,
        torrent_url,
        description_url,
        published_at: result.published_at,
        category: result.category.filter(|value| !value.trim().is_empty()),
        sources,
    })
}

impl SearchExecutionContext {
    pub(super) async fn get_json_with_user_agent<T: DeserializeOwned>(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
    ) -> Result<T> {
        self.http
            .get_json_with_user_agent(raw_url, allow_private_remote_urls)
            .await
    }

    pub(super) async fn get_text_with_user_agent(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
    ) -> Result<String> {
        self.http
            .get_text_with_user_agent(raw_url, allow_private_remote_urls)
            .await
    }
}

impl SearchHttpClient {
    pub(crate) fn new() -> Result<Self> {
        // Manual redirect handling is applied in fetch helpers so each hop can be
        // re-validated (SSRF / private-host pinning).
        let client = Client::builder()
            .timeout(SEARCH_HTTP_TIMEOUT)
            .redirect(Policy::none())
            .build()
            .context("failed to build search HTTP client")?;
        Ok(Self { client })
    }

    async fn get_json<T: DeserializeOwned>(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
    ) -> Result<T> {
        let body = self
            .get_text_limited(
                raw_url,
                allow_private_remote_urls,
                None,
                MAX_SEARCH_RESPONSE_BYTES,
                None,
                None,
            )
            .await?;
        serde_json::from_str(&body).context("provider returned invalid JSON")
    }

    async fn get_text(&self, raw_url: &str, allow_private_remote_urls: bool) -> Result<String> {
        self.get_text_limited(
            raw_url,
            allow_private_remote_urls,
            None,
            MAX_SEARCH_RESPONSE_BYTES,
            None,
            None,
        )
        .await
    }

    pub(crate) async fn get_json_with_user_agent<T: DeserializeOwned>(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
    ) -> Result<T> {
        let body = self
            .get_text_limited(
                raw_url,
                allow_private_remote_urls,
                None,
                MAX_SEARCH_RESPONSE_BYTES,
                Some(SEARCH_USER_AGENT),
                None,
            )
            .await?;
        serde_json::from_str(&body).context("provider returned invalid JSON")
    }

    pub(crate) async fn get_text_with_user_agent(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
    ) -> Result<String> {
        self.get_text_limited(
            raw_url,
            allow_private_remote_urls,
            None,
            MAX_SEARCH_RESPONSE_BYTES,
            Some(SEARCH_USER_AGENT),
            None,
        )
        .await
    }

    /// Fetch text with optional timeout, body limit, UA, and private-redirect host pinning.
    pub(crate) async fn get_text_limited(
        &self,
        raw_url: &str,
        allow_private_remote_urls: bool,
        timeout: Option<Duration>,
        max_bytes: u64,
        user_agent: Option<&str>,
        approved_private_origin: Option<&str>,
    ) -> Result<String> {
        let approved_host = approved_private_origin
            .and_then(|value| Url::parse(value).ok())
            .and_then(|url| url.host_str().map(|host| host.to_ascii_lowercase()));

        let mut current = validate_remote_url(raw_url, allow_private_remote_urls)?;
        let timeout = timeout.unwrap_or(SEARCH_HTTP_TIMEOUT);

        for _ in 0..6 {
            let redacted = redact_url_for_log(&current);
            let mut request = self.client.get(current.clone()).timeout(timeout);
            if let Some(user_agent) = user_agent {
                request = request.header("User-Agent", user_agent);
            }

            let response = request
                .send()
                .await
                .with_context(|| format!("failed to fetch {}", redacted))?;

            let status = response.status();
            if status.is_redirection() {
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                    .ok_or_else(|| anyhow!("provider returned a redirect without Location"))?;
                let next = current
                    .join(location)
                    .context("provider returned an invalid redirect URL")?;
                validate_redirect_url(
                    &current,
                    &next,
                    allow_private_remote_urls,
                    approved_host.as_deref(),
                )?;
                current = next;
                continue;
            }

            let response = response
                .error_for_status()
                .with_context(|| format!("provider responded with an error for {}", redacted))?;

            let bytes = response
                .bytes()
                .await
                .with_context(|| format!("provider returned invalid text for {}", redacted))?;
            if bytes.len() as u64 > max_bytes {
                return Err(anyhow!(
                    "response_too_large: provider response exceeded size limit"
                ));
            }
            return String::from_utf8(bytes.to_vec())
                .context("provider returned invalid UTF-8 text");
        }

        Err(anyhow!("provider exceeded redirect limit"))
    }
}

fn validate_redirect_url(
    from: &Url,
    to: &Url,
    allow_private_remote_urls: bool,
    approved_private_host: Option<&str>,
) -> Result<()> {
    match to.scheme() {
        "http" | "https" => {}
        _ => return Err(anyhow!("URL scheme must be http or https")),
    }
    if !to.username().is_empty() || to.password().is_some() {
        return Err(anyhow!(
            "URLs containing embedded credentials are not allowed"
        ));
    }

    let host = to
        .host_str()
        .ok_or_else(|| anyhow!("URL must include a host"))?
        .to_ascii_lowercase();

    let host_is_private = host_looks_private(&host);
    if host_is_private {
        if !allow_private_remote_urls {
            return Err(anyhow!("private or localhost hosts are blocked"));
        }
        // Private redirects must stay on the provider's approved host.
        if let Some(approved) = approved_private_host {
            if host != approved {
                return Err(anyhow!("redirect to unrelated private host is not allowed"));
            }
        } else if let Some(from_host) = from.host_str() {
            if !host.eq_ignore_ascii_case(from_host) {
                return Err(anyhow!("redirect to unrelated private host is not allowed"));
            }
        }
    }

    Ok(())
}

fn host_looks_private(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("localhost.localdomain")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".localhost")
    {
        return true;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_private_ip(ip);
    }
    false
}

#[derive(Debug, Default)]
struct XmlFeedItem {
    id: Option<String>,
    title: Option<String>,
    link: Option<String>,
    enclosure_url: Option<String>,
    enclosure_length: Option<u64>,
    published_at: Option<String>,
    category: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum XmlFeedField {
    Title,
    Link,
    Guid,
    Id,
    PublishedAt,
    Category,
}

fn parse_custom_xml_feed(feed: &str, source: &str) -> Result<Vec<SearchResult>> {
    let mut reader = Reader::from_str(feed);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut current_item: Option<XmlFeedItem> = None;
    let mut current_field: Option<XmlFeedField> = None;
    let mut results = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(event)) => match xml_local_name(event.name().as_ref()) {
                b"item" | b"entry" => {
                    current_item = Some(XmlFeedItem::default());
                    current_field = None;
                }
                _ if current_item.is_some() => {
                    let event_name = event.name();
                    let name = xml_local_name(event_name.as_ref());
                    current_field = xml_field_for_name(name);
                    if name == b"link" {
                        if let Some(item) = current_item.as_mut() {
                            apply_xml_link_attributes(item, &event, false);
                        }
                    } else if name == b"enclosure" {
                        if let Some(item) = current_item.as_mut() {
                            apply_xml_link_attributes(item, &event, true);
                        }
                        current_field = None;
                    } else if name == b"category" {
                        if let Some(item) = current_item.as_mut() {
                            if let Some(term) = xml_attribute_value(&event, b"term") {
                                set_xml_category(item, term);
                            }
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(event)) => {
                if current_item.is_some() {
                    let event_name = event.name();
                    let name = xml_local_name(event_name.as_ref());
                    if name == b"link" {
                        if let Some(item) = current_item.as_mut() {
                            apply_xml_link_attributes(item, &event, false);
                        }
                    } else if name == b"enclosure" {
                        if let Some(item) = current_item.as_mut() {
                            apply_xml_link_attributes(item, &event, true);
                        }
                    } else if name == b"category" {
                        if let Some(item) = current_item.as_mut() {
                            if let Some(term) = xml_attribute_value(&event, b"term") {
                                set_xml_category(item, term);
                            }
                        }
                    }
                }
            }
            Ok(Event::Text(event)) => {
                if let (Some(item), Some(field)) = (current_item.as_mut(), current_field) {
                    apply_xml_text_field(item, field, decode_xml_text(event.as_ref()));
                }
            }
            Ok(Event::CData(event)) => {
                if let (Some(item), Some(field)) = (current_item.as_mut(), current_field) {
                    apply_xml_text_field(
                        item,
                        field,
                        String::from_utf8_lossy(event.as_ref()).trim().to_string(),
                    );
                }
            }
            Ok(Event::End(event)) => {
                let event_name = event.name();
                match xml_local_name(event_name.as_ref()) {
                    b"item" | b"entry" => {
                        if let Some(item) = current_item.take() {
                            if let Some(result) = xml_item_to_search_result(item, source) {
                                results.push(result);
                            }
                        }
                        current_field = None;
                    }
                    name if current_field == xml_field_for_name(name) => {
                        current_field = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(anyhow!("provider returned invalid XML feed: {}", error)),
            _ => {}
        }
        buf.clear();
    }

    Ok(results)
}

fn xml_local_name<'a>(name: &'a [u8]) -> &'a [u8] {
    name.rsplit(|byte| *byte == b':').next().unwrap_or(name)
}

fn xml_field_for_name(name: &[u8]) -> Option<XmlFeedField> {
    match name {
        b"title" => Some(XmlFeedField::Title),
        b"link" => Some(XmlFeedField::Link),
        b"guid" => Some(XmlFeedField::Guid),
        b"id" => Some(XmlFeedField::Id),
        b"pubDate" | b"published" | b"updated" => Some(XmlFeedField::PublishedAt),
        b"category" => Some(XmlFeedField::Category),
        _ => None,
    }
}

fn xml_attribute_value(event: &quick_xml::events::BytesStart<'_>, key: &[u8]) -> Option<String> {
    event
        .attributes()
        .flatten()
        .find(|attr| xml_local_name(attr.key.as_ref()) == key)
        .map(|attr| {
            String::from_utf8_lossy(attr.value.as_ref())
                .trim()
                .to_string()
        })
        .filter(|value| !value.is_empty())
}

fn apply_xml_link_attributes(
    item: &mut XmlFeedItem,
    event: &quick_xml::events::BytesStart<'_>,
    prefer_download: bool,
) {
    let href = xml_attribute_value(event, b"href")
        .or_else(|| xml_attribute_value(event, b"url"))
        .filter(|value| !value.is_empty());

    if let Some(length) = xml_attribute_value(event, b"length").and_then(|value| value.parse().ok())
    {
        item.enclosure_length = Some(length);
    }

    let rel = xml_attribute_value(event, b"rel")
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_else(|| {
            if prefer_download {
                "enclosure".to_string()
            } else {
                String::new()
            }
        });

    if let Some(url) = href {
        let prefer_download_url = prefer_download || rel == "enclosure";
        assign_xml_url(item, url, prefer_download_url);
    }
}

fn apply_xml_text_field(item: &mut XmlFeedItem, field: XmlFeedField, value: String) {
    if value.is_empty() {
        return;
    }
    match field {
        XmlFeedField::Title => item.title = Some(value),
        XmlFeedField::Link => assign_xml_url(item, value, false),
        XmlFeedField::Guid => item.id = Some(value),
        XmlFeedField::Id => item.id = Some(value),
        XmlFeedField::PublishedAt => item.published_at = Some(value),
        XmlFeedField::Category => set_xml_category(item, value),
    }
}

fn assign_xml_url(item: &mut XmlFeedItem, raw_url: String, prefer_download: bool) {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return;
    }

    if trimmed.starts_with("magnet:?") {
        if item.enclosure_url.is_none() {
            item.enclosure_url = Some(trimmed.to_string());
        }
        return;
    }

    let is_torrent_url = Url::parse(trimmed)
        .ok()
        .map(|url| url.path().to_ascii_lowercase().ends_with(".torrent"))
        .unwrap_or_else(|| trimmed.to_ascii_lowercase().ends_with(".torrent"));

    if prefer_download || is_torrent_url {
        if item.enclosure_url.is_none() {
            item.enclosure_url = Some(trimmed.to_string());
        }
        return;
    }

    if item.link.is_none() {
        item.link = Some(trimmed.to_string());
    }
}

fn set_xml_category(item: &mut XmlFeedItem, value: String) {
    let trimmed = value.trim();
    if !trimmed.is_empty() && item.category.is_none() {
        item.category = Some(trimmed.to_string());
    }
}

fn xml_item_to_search_result(item: XmlFeedItem, source: &str) -> Option<SearchResult> {
    let name = item.title?.trim().to_string();
    if name.is_empty() {
        return None;
    }

    let (magnet_uri, torrent_url) = match item.enclosure_url {
        Some(url) if url.starts_with("magnet:?") => (Some(url), None),
        Some(url) => (None, Some(url)),
        None => (None, None),
    };

    Some(SearchResult {
        id: item
            .id
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("{}-{}", source, slugify(&name))),
        source: source.to_string(),
        name,
        size_bytes: item.enclosure_length,
        seeders: None,
        leechers: None,
        magnet_uri,
        torrent_url,
        description_url: item.link,
        published_at: item.published_at,
        category: item.category,
        sources: Vec::new(),
    })
}

fn decode_xml_text(raw: &[u8]) -> String {
    String::from_utf8_lossy(raw).trim().to_string()
}

struct SearchRegistry {
    providers: BTreeMap<String, Box<dyn SearchProvider>>,
}

impl SearchRegistry {
    fn new(settings: &SearchSettings, secrets: Arc<dyn SearchSecretStore>) -> Self {
        let mut providers: BTreeMap<String, Box<dyn SearchProvider>> = BTreeMap::new();
        providers.insert("mock".to_string(), Box::new(MockSearchProvider));
        providers.insert(
            "internet_archive".to_string(),
            Box::new(InternetArchiveProvider {
                name: "internet_archive",
                label: "Internet Archive",
                description: "Search legal torrents from the Internet Archive catalog.",
                categories: &["all", "texts", "audio", "movies", "software", "image"],
                base_query: "",
            }),
        );
        providers.insert(
            "internet_archive_software".to_string(),
            Box::new(InternetArchiveProvider {
                name: "internet_archive_software",
                label: "Internet Archive Software",
                description: "Focus on software, Linux media, and computer history torrents from Internet Archive.",
                categories: &["all", "software"],
                base_query: "mediatype:software",
            }),
        );
        providers.insert("open_content".to_string(), Box::new(OpenContentProvider));
        providers.insert("yts".to_string(), Box::new(movies::YtsSearchProvider));
        providers.insert(
            "tpb_movies".to_string(),
            Box::new(movies::TpbMoviesSearchProvider),
        );
        providers.insert(
            "x1337_movies".to_string(),
            Box::new(movies::X1337MoviesSearchProvider),
        );
        providers.insert("tpb_tv".to_string(), Box::new(movies::TpbTvSearchProvider));
        providers.insert(
            "x1337_tv".to_string(),
            Box::new(movies::X1337TvSearchProvider),
        );
        if let Ok(provider_map) = settings.provider_map() {
            for provider in provider_map.values() {
                if is_known_provider_name(&provider.name) {
                    continue;
                }
                let label = provider
                    .label
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or(&provider.name)
                    .to_string();
                let categories = if provider.categories.is_empty() {
                    vec!["all".to_string()]
                } else {
                    let mut categories = vec!["all".to_string()];
                    categories.extend(
                        provider
                            .categories
                            .iter()
                            .map(|value| value.trim().to_string())
                            .filter(|value| {
                                !value.eq_ignore_ascii_case("all") && !value.is_empty()
                            }),
                    );
                    categories
                };
                if provider.format == SearchProviderFormat::Torznab {
                    providers.insert(
                        provider.name.clone(),
                        Box::new(TorznabProvider {
                            name: provider.name.clone(),
                            label,
                            categories,
                            secrets: secrets.clone(),
                        }),
                    );
                } else {
                    providers.insert(
                        provider.name.clone(),
                        Box::new(CustomFeedProvider {
                            name: provider.name.clone(),
                            label,
                            categories,
                            format: provider.format,
                        }),
                    );
                }
            }
        }
        Self { providers }
    }

    fn describe(&self, settings: &SearchSettings) -> Vec<SearchProviderInfo> {
        let mut providers = self
            .providers
            .values()
            .map(|provider| {
                let setting = settings.provider_setting(provider.name()).ok();
                SearchProviderInfo {
                    name: provider.name().to_string(),
                    label: provider.label().to_string(),
                    enabled: setting.as_ref().map(|item| item.enabled).unwrap_or(false),
                    configured: provider.configured(settings),
                    is_custom: !is_known_provider_name(provider.name()),
                    supports_browse: provider.supports_browse(),
                    feed_url: setting.as_ref().and_then(|item| item.feed_url.clone()),
                    provider_format: provider.provider_format(),
                    categories: provider.categories(),
                    requires_feed_url: provider.requires_feed_url(),
                    description: provider.description().to_string(),
                    has_credentials: false,
                    allow_private_url: setting
                        .as_ref()
                        .map(|item| item.allow_private_url)
                        .unwrap_or(false),
                    timeout_seconds: setting.as_ref().and_then(|item| item.timeout_seconds),
                    connection_status: None,
                    last_tested_at: None,
                    last_error: None,
                }
            })
            .collect::<Vec<_>>();
        providers.sort_by(|left, right| {
            compare_media_provider_priority(&left.name, &right.name)
                .then_with(|| left.label.cmp(&right.label))
        });
        providers
    }

    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<SearchResponse> {
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_PROVIDERS));
        let mut join_set = tokio::task::JoinSet::new();

        for source in query.sources.clone() {
            let provider = self
                .providers
                .get(&source)
                .ok_or_else(|| anyhow!("unknown provider {}", source))?;
            let name = provider.name().to_string();
            let label = provider.label().to_string();
            let configured = provider.configured(settings);
            let supports_browse = provider.supports_browse();

            if query.browse_mode && !supports_browse {
                // Record synchronously; no network work.
                // Collected after the concurrent fan-out below.
                join_set.spawn(async move {
                    (
                        source,
                        SearchProviderStatus {
                            name,
                            label,
                            configured,
                            ok: false,
                            result_count: 0,
                            error: Some(
                                "Browse mode is not supported by this provider".to_string(),
                            ),
                            latency_ms: None,
                            timed_out: false,
                        },
                        Vec::new(),
                    )
                });
                continue;
            }

            // SearchProvider is not dyn-cloneable; run sequentially-named lookups on the
            // shared registry by re-entering through a per-source closure that captures
            // cloned settings/query/context and calls the boxed provider via a local match
            // on source name after spawning. Because trait objects cannot move into tasks
            // easily without Arc, wrap provider invocation in an async block using
            // references that are 'static via Arc settings clones.
            let settings = settings.clone();
            let query = query.clone();
            let ctx = ctx.clone();
            let permit_semaphore = semaphore.clone();
            // We need the provider callable inside the task. Reconstruct a one-off registry
            // for this source only would be expensive; instead call through a helper that
            // uses the concrete dispatch already registered. Use Arc of the provider map
            // by searching again via execute_single_provider.
            let provider_name = source.clone();
            join_set.spawn(async move {
                let _permit = match permit_semaphore.acquire_owned().await {
                    Ok(permit) => permit,
                    Err(_) => {
                        return (
                            provider_name.clone(),
                            SearchProviderStatus {
                                name: provider_name.clone(),
                                label: provider_name.clone(),
                                configured: false,
                                ok: false,
                                result_count: 0,
                                error: Some("Search concurrency limiter closed".to_string()),
                                latency_ms: None,
                                timed_out: false,
                            },
                            Vec::new(),
                        );
                    }
                };

                let started = Instant::now();
                let registry = SearchRegistry::new(&settings, ctx.secrets.clone());
                let Some(provider) = registry.providers.get(&provider_name) else {
                    return (
                        provider_name.clone(),
                        SearchProviderStatus {
                            name: provider_name.clone(),
                            label: provider_name.clone(),
                            configured: false,
                            ok: false,
                            result_count: 0,
                            error: Some("unknown provider".to_string()),
                            latency_ms: None,
                            timed_out: false,
                        },
                        Vec::new(),
                    );
                };

                let provider_timeout = settings
                    .provider_setting(&provider_name)
                    .ok()
                    .and_then(|setting| setting.timeout_seconds)
                    .map(clamp_provider_timeout_seconds)
                    .unwrap_or(DEFAULT_PROVIDER_TIMEOUT_SECS);
                let timeout = Duration::from_secs(provider_timeout);

                let search_future = provider.search(&query, &settings, &ctx);
                let outcome = tokio::time::timeout(timeout, search_future).await;
                let latency_ms = started.elapsed().as_millis() as u64;

                match outcome {
                    Ok(Ok(provider_results)) => {
                        let allow_private = settings
                            .provider_setting(&provider_name)
                            .map(|setting| {
                                ctx.allow_private_remote_urls || setting.allow_private_url
                            })
                            .unwrap_or(ctx.allow_private_remote_urls);
                        let mut sanitized = Vec::new();
                        for result in provider_results {
                            match sanitize_result(result, allow_private) {
                                Ok(result) => sanitized.push(result),
                                Err(err) => {
                                    warn!(
                                        "dropping invalid search result from {}: {}",
                                        provider_name, err
                                    )
                                }
                            }
                        }
                        (
                            provider_name.clone(),
                            SearchProviderStatus {
                                name: provider.name().to_string(),
                                label: provider.label().to_string(),
                                configured: provider.configured(&settings),
                                ok: true,
                                result_count: sanitized.len(),
                                error: None,
                                latency_ms: Some(latency_ms),
                                timed_out: false,
                            },
                            sanitized,
                        )
                    }
                    Ok(Err(err)) => {
                        let message = sanitise_provider_status_error(&err);
                        (
                            provider_name.clone(),
                            SearchProviderStatus {
                                name: provider.name().to_string(),
                                label: provider.label().to_string(),
                                configured: provider.configured(&settings),
                                ok: false,
                                result_count: 0,
                                error: Some(message),
                                latency_ms: Some(latency_ms),
                                timed_out: false,
                            },
                            Vec::new(),
                        )
                    }
                    Err(_) => (
                        provider_name.clone(),
                        SearchProviderStatus {
                            name: provider.name().to_string(),
                            label: provider.label().to_string(),
                            configured: provider.configured(&settings),
                            ok: false,
                            result_count: 0,
                            error: Some(format!(
                                "Connection timed out after {provider_timeout} seconds"
                            )),
                            latency_ms: Some(latency_ms),
                            timed_out: true,
                        },
                        Vec::new(),
                    ),
                }
            });
        }

        let mut provider_statuses = Vec::new();
        let mut merged_results = Vec::new();
        while let Some(joined) = join_set.join_next().await {
            match joined {
                Ok((_source, status, results)) => {
                    merged_results.extend(results);
                    provider_statuses.push(status);
                }
                Err(err) => {
                    warn!("search provider task failed: {err}");
                }
            }
        }

        provider_statuses.sort_by(|left, right| {
            compare_media_provider_priority(&left.name, &right.name)
                .then_with(|| left.name.cmp(&right.name))
        });

        let mut deduped = dedup::dedupe_results(merged_results);
        deduped.sort_by(dedup::compare_search_results);
        deduped.truncate(query.limit as usize);

        Ok(SearchResponse {
            results: deduped,
            providers: provider_statuses,
            browse_mode: query.browse_mode,
        })
    }
}

fn sanitise_provider_status_error(err: &anyhow::Error) -> String {
    let text = err.to_string();
    if let Some((_, message)) = text.split_once(": ") {
        if message.len() <= 160 {
            return message.to_string();
        }
    }
    if text.to_ascii_lowercase().contains("timed out") {
        return "Connection timed out".to_string();
    }
    if text.len() > 160 {
        "Provider request failed".to_string()
    } else {
        text
    }
}

#[async_trait]
impl SearchProvider for MockSearchProvider {
    fn name(&self) -> &str {
        "mock"
    }

    fn label(&self) -> &str {
        "Mock Provider"
    }

    fn description(&self) -> &str {
        "Development-only sample search results for UI and flow testing."
    }

    fn categories(&self) -> Vec<String> {
        vec![
            "all".to_string(),
            "books".to_string(),
            "linux".to_string(),
            "music".to_string(),
            "video".to_string(),
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
        _ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>> {
        let needle = query.query.to_lowercase();
        let category = query.category.as_deref().unwrap_or("all");
        let results = vec![
            SearchResult {
                id: "mock-linux-1".to_string(),
                source: self.name().to_string(),
                name: "Mock Ubuntu Archive Mirror".to_string(),
                size_bytes: Some(2_684_354_560),
                seeders: Some(144),
                leechers: Some(9),
                magnet_uri: Some("magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Mock%20Ubuntu%20Archive".to_string()),
                torrent_url: None,
                description_url: Some("https://example.com/open-content/ubuntu-archive".to_string()),
                published_at: Some("2026-01-01T00:00:00Z".to_string()),
                category: Some("linux".to_string()),
                sources: Vec::new(),
            },
            SearchResult {
                id: "mock-book-1".to_string(),
                source: self.name().to_string(),
                name: "Mock Public Domain Book Bundle".to_string(),
                size_bytes: Some(734_003_200),
                seeders: Some(36),
                leechers: Some(4),
                magnet_uri: None,
                torrent_url: Some("https://example.com/open-content/public-domain-book-bundle.torrent".to_string()),
                description_url: Some("https://example.com/open-content/books".to_string()),
                published_at: Some("2026-02-14T00:00:00Z".to_string()),
                category: Some("books".to_string()),
                sources: Vec::new(),
            },
            SearchResult {
                id: "mock-music-1".to_string(),
                source: self.name().to_string(),
                name: "Mock Creative Commons Audio Pack".to_string(),
                size_bytes: Some(182_452_224),
                seeders: Some(18),
                leechers: Some(2),
                magnet_uri: Some("magnet:?xt=urn:btih:89abcdef0123456789abcdef0123456789abcdef&dn=Mock%20Creative%20Commons%20Audio".to_string()),
                torrent_url: None,
                description_url: Some("https://example.com/open-content/audio".to_string()),
                published_at: Some("2026-03-20T00:00:00Z".to_string()),
                category: Some("music".to_string()),
                sources: Vec::new(),
            },
        ];

        Ok(results
            .into_iter()
            .filter(|result| {
                let name_matches = result.name.to_lowercase().contains(&needle);
                let category_matches = category.eq_ignore_ascii_case("all")
                    || result
                        .category
                        .as_deref()
                        .map(|value| value.eq_ignore_ascii_case(category))
                        .unwrap_or(false);
                name_matches && category_matches
            })
            .take(query.limit as usize)
            .collect())
    }
}

#[async_trait]
impl SearchProvider for OpenContentProvider {
    fn name(&self) -> &str {
        "open_content"
    }

    fn label(&self) -> &str {
        "Open Content Feed"
    }

    fn description(&self) -> &str {
        "Strict JSON feed for public-domain and openly licensed torrent catalogs."
    }

    fn categories(&self) -> Vec<String> {
        vec![
            "all".to_string(),
            "books".to_string(),
            "linux".to_string(),
            "music".to_string(),
            "video".to_string(),
            "software".to_string(),
        ]
    }

    fn provider_format(&self) -> Option<SearchProviderFormat> {
        Some(SearchProviderFormat::OpenContentJson)
    }

    fn supports_browse(&self) -> bool {
        true
    }

    fn requires_feed_url(&self) -> bool {
        true
    }

    fn configured(&self, settings: &SearchSettings) -> bool {
        settings
            .provider_setting(self.name())
            .ok()
            .and_then(|provider| provider.feed_url)
            .is_some()
    }

    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>> {
        let provider_setting = settings.provider_setting(self.name())?;
        let Some(feed_url) = provider_setting.feed_url.as_deref() else {
            return Ok(Vec::new());
        };

        let feed: OpenContentFeedResponse = ctx
            .http
            .get_json(feed_url, ctx.allow_private_remote_urls)
            .await?;
        let items = match feed {
            OpenContentFeedResponse::Array(items) => items,
            OpenContentFeedResponse::Object { items } => items,
        };

        let needle = query.query.to_lowercase();
        let requested_category = query.category.as_deref().unwrap_or("all");

        Ok(items
            .into_iter()
            .filter(|item| query.browse_mode || item.name.to_lowercase().contains(&needle))
            .filter(|item| {
                requested_category.eq_ignore_ascii_case("all")
                    || item
                        .category
                        .as_deref()
                        .map(|value| value.eq_ignore_ascii_case(requested_category))
                        .unwrap_or(false)
            })
            .map(|item| SearchResult {
                id: item
                    .id
                    .unwrap_or_else(|| format!("open-content-{}", slugify(&item.name))),
                source: self.name().to_string(),
                name: item.name,
                size_bytes: item.size_bytes,
                seeders: item.seeders,
                leechers: item.leechers,
                magnet_uri: item.magnet_uri,
                torrent_url: item.torrent_url,
                description_url: item.description_url,
                published_at: item.published_at,
                category: item.category,
                sources: Vec::new(),
            })
            .take(query.limit as usize)
            .collect())
    }
}

#[derive(Debug, Clone, Deserialize)]
struct InternetArchiveResponse {
    response: InternetArchiveDocs,
}

#[derive(Debug, Clone, Deserialize)]
struct InternetArchiveDocs {
    docs: Vec<InternetArchiveDoc>,
}

#[derive(Debug, Clone, Deserialize)]
struct InternetArchiveDoc {
    identifier: String,
    title: Option<String>,
    mediatype: Option<String>,
    publicdate: Option<String>,
    item_size: Option<u64>,
}

impl InternetArchiveProvider {
    fn category_filter(&self, requested_category: Option<&str>) -> Option<&'static str> {
        match requested_category
            .unwrap_or("all")
            .to_ascii_lowercase()
            .as_str()
        {
            "all" => None,
            "texts" => Some("mediatype:texts"),
            "audio" => Some("mediatype:audio"),
            "movies" => Some("mediatype:movies"),
            "software" => Some("mediatype:software"),
            "image" => Some("mediatype:image"),
            _ => None,
        }
    }

    fn build_query(&self, query: &ResolvedSearchQuery) -> String {
        let mut parts = Vec::new();
        if !self.base_query.is_empty() {
            parts.push(self.base_query.to_string());
        }
        if let Some(filter) = self.category_filter(query.category.as_deref()) {
            parts.push(filter.to_string());
        }
        if !query.browse_mode {
            parts.push(query.query.clone());
        }
        parts.push("format:\"Archive BitTorrent\"".to_string());
        parts.join(" AND ")
    }
}

#[async_trait]
impl SearchProvider for InternetArchiveProvider {
    fn name(&self) -> &str {
        self.name
    }

    fn label(&self) -> &str {
        self.label
    }

    fn description(&self) -> &str {
        self.description
    }

    fn categories(&self) -> Vec<String> {
        self.categories
            .iter()
            .map(|value| value.to_string())
            .collect()
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
        let search_query = self.build_query(query);
        let mut url =
            Url::parse("https://archive.org/advancedsearch.php").context("invalid archive URL")?;
        {
            let mut params = url.query_pairs_mut();
            params.append_pair("q", &search_query);
            params.append_pair("fl[]", "identifier");
            params.append_pair("fl[]", "title");
            params.append_pair("fl[]", "publicdate");
            params.append_pair("fl[]", "mediatype");
            params.append_pair("fl[]", "item_size");
            params.append_pair("rows", &query.limit.to_string());
            params.append_pair("page", "1");
            params.append_pair("output", "json");
            params.append_pair(
                "sort[]",
                if query.browse_mode {
                    "publicdate desc"
                } else {
                    "downloads desc"
                },
            );
        }

        let response: InternetArchiveResponse = ctx
            .http
            .get_json(url.as_str(), ctx.allow_private_remote_urls)
            .await?;

        Ok(response
            .response
            .docs
            .into_iter()
            .map(|doc| {
                let title = doc.title.unwrap_or_else(|| doc.identifier.clone());
                let category = doc.mediatype.clone();
                SearchResult {
                    id: format!("{}-{}", self.name, doc.identifier),
                    source: self.name.to_string(),
                    name: title,
                    size_bytes: doc.item_size,
                    seeders: None,
                    leechers: None,
                    magnet_uri: None,
                    torrent_url: Some(format!(
                        "https://archive.org/download/{0}/{0}_archive.torrent",
                        doc.identifier
                    )),
                    description_url: Some(format!(
                        "https://archive.org/details/{}",
                        doc.identifier
                    )),
                    published_at: doc.publicdate,
                    category,
                    sources: Vec::new(),
                }
            })
            .collect())
    }
}

#[async_trait]
impl SearchProvider for CustomFeedProvider {
    fn name(&self) -> &str {
        &self.name
    }

    fn label(&self) -> &str {
        &self.label
    }

    fn description(&self) -> &str {
        match self.format {
            SearchProviderFormat::OpenContentJson => {
                "Custom JSON feed for legal and open-content torrents."
            }
            SearchProviderFormat::RssAtom => {
                "Custom RSS or Atom torrent feed for legal and open-content catalogs."
            }
            SearchProviderFormat::Torznab => {
                "Torznab-compatible indexer endpoint (Jackett, Prowlarr, or similar)."
            }
        }
    }

    fn categories(&self) -> Vec<String> {
        self.categories.clone()
    }

    fn provider_format(&self) -> Option<SearchProviderFormat> {
        Some(self.format)
    }

    fn supports_browse(&self) -> bool {
        true
    }

    fn requires_feed_url(&self) -> bool {
        true
    }

    fn configured(&self, settings: &SearchSettings) -> bool {
        settings
            .provider_setting(&self.name)
            .ok()
            .and_then(|provider| provider.feed_url)
            .is_some()
    }

    async fn search(
        &self,
        query: &ResolvedSearchQuery,
        settings: &SearchSettings,
        ctx: &SearchExecutionContext,
    ) -> Result<Vec<SearchResult>> {
        let provider_setting = settings.provider_setting(&self.name)?;
        let Some(feed_url) = provider_setting.feed_url.as_deref() else {
            return Ok(Vec::new());
        };

        match provider_setting.format {
            SearchProviderFormat::OpenContentJson => {
                let feed: OpenContentFeedResponse = ctx
                    .http
                    .get_json(feed_url, ctx.allow_private_remote_urls)
                    .await?;
                let items = match feed {
                    OpenContentFeedResponse::Array(items) => items,
                    OpenContentFeedResponse::Object { items } => items,
                };

                let needle = query.query.to_lowercase();
                let requested_category = query.category.as_deref().unwrap_or("all");

                Ok(items
                    .into_iter()
                    .filter(|item| query.browse_mode || item.name.to_lowercase().contains(&needle))
                    .filter(|item| {
                        requested_category.eq_ignore_ascii_case("all")
                            || item
                                .category
                                .as_deref()
                                .map(|value| value.eq_ignore_ascii_case(requested_category))
                                .unwrap_or(false)
                    })
                    .map(|item| SearchResult {
                        id: item
                            .id
                            .unwrap_or_else(|| format!("{}-{}", self.name, slugify(&item.name))),
                        source: self.name.clone(),
                        name: item.name,
                        size_bytes: item.size_bytes,
                        seeders: item.seeders,
                        leechers: item.leechers,
                        magnet_uri: item.magnet_uri,
                        torrent_url: item.torrent_url,
                        description_url: item.description_url,
                        published_at: item.published_at,
                        category: item.category,
                        sources: Vec::new(),
                    })
                    .take(query.limit as usize)
                    .collect())
            }
            SearchProviderFormat::RssAtom => {
                let feed = ctx
                    .http
                    .get_text(feed_url, ctx.allow_private_remote_urls)
                    .await?;
                let items = parse_custom_xml_feed(&feed, &self.name)?;
                let needle = query.query.to_lowercase();
                let requested_category = query.category.as_deref().unwrap_or("all");

                Ok(items
                    .into_iter()
                    .filter(|item| query.browse_mode || item.name.to_lowercase().contains(&needle))
                    .filter(|item| {
                        requested_category.eq_ignore_ascii_case("all")
                            || item
                                .category
                                .as_deref()
                                .map(|value| value.eq_ignore_ascii_case(requested_category))
                                .unwrap_or(false)
                    })
                    .take(query.limit as usize)
                    .collect())
            }
            SearchProviderFormat::Torznab => Err(anyhow!(
                "Torznab providers must use the native Torznab implementation"
            )),
        }
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
    use std::cmp::Ordering;
    use std::sync::Mutex;

    use super::dedup::compare_search_results;
    use super::{
        animus_excluded_provider_names, animus_media_provider_names,
        apply_edition_search_defaults_for_edition, available_providers, default_provider_settings,
        default_provider_settings_for_edition, execute_search, media_provider_priority,
        parse_custom_xml_feed, validate_magnet_uri, validate_remote_url, SearchProviderFormat,
        SearchProviderSetting, SearchQuery, SearchResult, SearchSettings,
        SearchSettingsPatchRequest, MAX_RESULT_LIMIT,
    };

    static EDITION_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn magnet_validation_accepts_btih_hex() {
        let magnet = "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Example";
        assert!(validate_magnet_uri(magnet).is_ok());
    }

    #[test]
    fn magnet_validation_rejects_non_magnet_scheme() {
        assert!(validate_magnet_uri("https://example.com/file.torrent").is_err());
    }

    #[test]
    fn remote_url_validation_blocks_localhost() {
        assert!(validate_remote_url("http://localhost/test.json", false).is_err());
    }

    #[test]
    fn remote_url_validation_blocks_private_ipv4() {
        assert!(validate_remote_url("http://192.168.1.44/feed.json", false).is_err());
    }

    #[test]
    fn remote_url_validation_allows_public_https() {
        let url = validate_remote_url("https://example.com/feed.json", false).unwrap();
        assert_eq!(url.host_str(), Some("example.com"));
    }

    #[test]
    fn media_provider_priority_orders_movie_and_tv_first() {
        assert!(media_provider_priority("yts") < media_provider_priority("tpb_tv"));
        assert!(media_provider_priority("tpb_movies") < media_provider_priority("x1337_tv"));
        assert!(
            media_provider_priority("x1337_movies") < media_provider_priority("internet_archive")
        );
    }

    #[test]
    fn compare_search_results_orders_by_name_when_seeders_equal() {
        let movie = SearchResult {
            id: "yts-1".to_string(),
            source: "yts".to_string(),
            name: "Movie".to_string(),
            size_bytes: None,
            seeders: Some(10),
            leechers: None,
            magnet_uri: None,
            torrent_url: None,
            description_url: None,
            published_at: None,
            category: Some("movies".to_string()),
            sources: Vec::new(),
        };
        let archive = SearchResult {
            id: "ia-1".to_string(),
            source: "internet_archive".to_string(),
            name: "Archive".to_string(),
            size_bytes: None,
            seeders: Some(10),
            leechers: None,
            magnet_uri: None,
            torrent_url: None,
            description_url: None,
            published_at: None,
            category: None,
            sources: Vec::new(),
        };
        // Seeders equal and no magnets: deterministic name ascending.
        assert_eq!(compare_search_results(&archive, &movie), Ordering::Less);
    }

    #[test]
    fn animus_defaults_enable_media_providers() {
        let providers = default_provider_settings_for_edition("animus");
        for name in animus_media_provider_names() {
            let provider = providers
                .iter()
                .find(|provider| provider.name == *name)
                .unwrap_or_else(|| panic!("missing animus provider {name}"));
            assert!(provider.enabled, "{name} should be enabled for animus");
        }
    }

    #[test]
    fn animus_defaults_disable_internet_archive_providers() {
        let providers = default_provider_settings_for_edition("animus");
        for name in animus_excluded_provider_names() {
            let provider = providers
                .iter()
                .find(|provider| provider.name == *name)
                .unwrap_or_else(|| panic!("missing provider {name}"));
            assert!(!provider.enabled, "{name} should be disabled for animus");
        }
    }

    #[test]
    fn standard_defaults_keep_internet_archive_enabled() {
        let providers = default_provider_settings_for_edition("standard");
        let archive = providers
            .iter()
            .find(|provider| provider.name == "internet_archive")
            .expect("internet_archive provider");
        assert!(archive.enabled);
    }

    #[test]
    fn apply_edition_search_defaults_enables_animus_movie_providers() {
        let mut settings = SearchSettings {
            enabled: false,
            default_provider: Some("internet_archive".to_string()),
            default_result_limit: 25,
            allow_private_remote_urls: false,
            providers: vec![
                SearchProviderSetting {
                    name: "yts".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                SearchProviderSetting {
                    name: "tpb_movies".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                SearchProviderSetting {
                    name: "internet_archive".to_string(),
                    enabled: true,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
            ],
        };

        let changed = apply_edition_search_defaults_for_edition(&mut settings, "animus");
        assert!(changed);
        assert!(settings.enabled);
        assert_eq!(settings.default_provider.as_deref(), Some("yts"));

        let providers = settings.provider_map().unwrap();
        for name in animus_media_provider_names() {
            assert!(
                providers
                    .get(*name)
                    .is_some_and(|provider| provider.enabled),
                "{name} should be enabled after animus migration"
            );
        }

        for name in animus_excluded_provider_names() {
            assert!(
                providers
                    .get(*name)
                    .is_some_and(|provider| !provider.enabled),
                "{name} should be disabled after animus migration"
            );
        }
    }

    #[test]
    fn animus_internet_archive_is_fully_blocked() {
        let _guard = EDITION_ENV_LOCK.lock().unwrap();
        std::env::set_var("ORC_TORRENT_EDITION", "animus");

        let settings = SearchSettings::default();
        let providers = available_providers(&settings).expect("animus providers");
        assert!(!providers
            .iter()
            .any(|provider| provider.name == "internet_archive"));
        assert!(!providers
            .iter()
            .any(|provider| provider.name == "internet_archive_software"));

        let query = SearchQuery {
            query: "ubuntu".to_string(),
            category: None,
            limit: Some(10),
            source: Some("internet_archive".to_string()),
        };
        let err = query
            .resolve(&settings)
            .expect_err("internet_archive blocked");
        assert!(err.to_string().contains("not available in AnimUS edition"));

        let mut invalid_settings = settings.clone();
        if let Some(provider) = invalid_settings
            .providers
            .iter_mut()
            .find(|provider| provider.name == "internet_archive")
        {
            provider.enabled = true;
        }
        let err = invalid_settings
            .validate()
            .expect_err("enabled internet_archive rejected");
        assert!(err.to_string().contains("not available in AnimUS edition"));

        std::env::remove_var("ORC_TORRENT_EDITION");
    }

    #[test]
    fn apply_edition_search_defaults_is_noop_for_standard_edition() {
        let mut settings = SearchSettings {
            enabled: false,
            default_provider: None,
            default_result_limit: 25,
            allow_private_remote_urls: false,
            providers: Vec::new(),
        };

        assert!(!apply_edition_search_defaults_for_edition(
            &mut settings,
            "standard"
        ));
        assert!(!settings.enabled);
    }

    #[test]
    fn provider_registry_uses_default_entries() {
        let settings = SearchSettings::default();
        let providers = available_providers(&settings).unwrap();
        assert_eq!(providers.len(), default_provider_settings().len());
        assert!(providers.iter().any(|provider| provider.name == "mock"));
        assert!(providers
            .iter()
            .any(|provider| provider.name == "open_content"));
        assert!(providers.iter().any(|provider| provider.supports_browse));
    }

    #[test]
    fn patch_validation_rejects_duplicate_providers() {
        let patch = SearchSettingsPatchRequest {
            enabled: None,
            default_provider: None,
            default_result_limit: None,
            allow_private_remote_urls: None,
            providers: Some(vec![
                super::SearchProviderSetting {
                    name: "mock".to_string(),
                    enabled: true,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "mock".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
            ]),
        };
        assert!(patch.validate().is_err());
    }

    #[tokio::test]
    async fn disabled_provider_cannot_be_queried() {
        let settings = SearchSettings {
            enabled: true,
            default_provider: Some("mock".to_string()),
            default_result_limit: 10,
            allow_private_remote_urls: false,
            providers: vec![
                super::SearchProviderSetting {
                    name: "mock".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "open_content".to_string(),
                    enabled: true,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
            ],
        };
        let query = SearchQuery {
            query: "ubuntu".to_string(),
            category: None,
            limit: Some(10),
            source: Some("mock".to_string()),
        };
        assert!(execute_search(&settings, query).await.is_err());
    }

    #[tokio::test]
    async fn result_limit_is_capped() {
        let settings = SearchSettings {
            enabled: true,
            default_provider: Some("mock".to_string()),
            default_result_limit: 10,
            allow_private_remote_urls: false,
            providers: vec![
                super::SearchProviderSetting {
                    name: "mock".to_string(),
                    enabled: true,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "internet_archive".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "internet_archive_software".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "open_content".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
            ],
        };
        let query = SearchQuery {
            query: "mock".to_string(),
            category: None,
            limit: Some(MAX_RESULT_LIMIT + 25),
            source: Some("mock".to_string()),
        };
        let results = execute_search(&settings, query).await.unwrap();
        assert!(results.results.len() <= MAX_RESULT_LIMIT as usize);
    }

    #[tokio::test]
    async fn empty_query_browse_mode_returns_provider_status() {
        let settings = {
            let _guard = EDITION_ENV_LOCK.lock().unwrap();
            std::env::remove_var("ORC_TORRENT_EDITION");
            SearchSettings::default()
        };
        let query = SearchQuery {
            query: "".to_string(),
            category: None,
            limit: Some(10),
            source: Some("all".to_string()),
        };
        let response = execute_search(&settings, query).await.unwrap();
        assert!(response.browse_mode);
        assert!(!response.providers.is_empty());
    }

    #[tokio::test]
    async fn omitted_source_queries_all_enabled_providers() {
        let settings = SearchSettings {
            enabled: true,
            default_provider: Some("mock".to_string()),
            default_result_limit: 10,
            allow_private_remote_urls: false,
            providers: vec![
                super::SearchProviderSetting {
                    name: "mock".to_string(),
                    enabled: true,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "internet_archive".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "internet_archive_software".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
                super::SearchProviderSetting {
                    name: "open_content".to_string(),
                    enabled: false,
                    label: None,
                    feed_url: None,
                    format: SearchProviderFormat::OpenContentJson,
                    categories: Vec::new(),
                    credential_ref: None,
                    allow_private_url: false,
                    timeout_seconds: None,
                },
            ],
        };
        let query = SearchQuery {
            query: "mock".to_string(),
            category: None,
            limit: Some(10),
            source: None,
        };
        let response = execute_search(&settings, query).await.unwrap();
        assert_eq!(response.providers.len(), 1);
        assert_eq!(response.providers[0].name, "mock");
    }

    #[test]
    fn parses_rss_feed_items_into_search_results() {
        let feed = r#"
            <rss version="2.0">
              <channel>
                <item>
                  <title>Example Linux ISO</title>
                  <link>https://catalog.example/items/linux-iso</link>
                  <enclosure url="https://catalog.example/files/linux-iso.torrent" length="2048" type="application/x-bittorrent" />
                  <guid>linux-iso</guid>
                  <pubDate>Thu, 03 Jul 2026 10:00:00 GMT</pubDate>
                  <category>linux</category>
                </item>
              </channel>
            </rss>
        "#;

        let results = parse_custom_xml_feed(feed, "custom_feed_1").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Example Linux ISO");
        assert_eq!(
            results[0].torrent_url.as_deref(),
            Some("https://catalog.example/files/linux-iso.torrent")
        );
        assert_eq!(results[0].size_bytes, Some(2048));
        assert_eq!(results[0].category.as_deref(), Some("linux"));
    }

    #[test]
    fn parses_atom_feed_magnet_links_into_search_results() {
        let feed = r#"
            <feed xmlns="http://www.w3.org/2005/Atom">
              <entry>
                <title>Creative Commons Film Pack</title>
                <id>film-pack</id>
                <updated>2026-07-03T10:00:00Z</updated>
                <link rel="alternate" href="https://catalog.example/items/film-pack" />
                <link rel="enclosure" href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&amp;dn=Creative%20Commons%20Film%20Pack" />
                <category term="video" />
              </entry>
            </feed>
        "#;

        let results = parse_custom_xml_feed(feed, "custom_feed_2").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].name, "Creative Commons Film Pack");
        assert!(results[0]
            .magnet_uri
            .as_deref()
            .is_some_and(|value| value.starts_with("magnet:?xt=urn:btih:")));
        assert_eq!(
            results[0].description_url.as_deref(),
            Some("https://catalog.example/items/film-pack")
        );
        assert_eq!(results[0].category.as_deref(), Some("video"));
    }

    #[test]
    fn legacy_provider_settings_deserialize_without_torznab_fields() {
        let json = r#"{
            "enabled": true,
            "default_provider": "internet_archive",
            "default_result_limit": 25,
            "allow_private_remote_urls": false,
            "providers": [
                {
                    "name": "custom_feed_1",
                    "enabled": true,
                    "label": "Legacy feed",
                    "feed_url": "https://example.com/feed.json",
                    "format": "open_content_json",
                    "categories": ["books"]
                }
            ]
        }"#;
        let settings: SearchSettings = serde_json::from_str(json).unwrap();
        let provider = &settings.providers[0];
        assert_eq!(provider.format, SearchProviderFormat::OpenContentJson);
        assert!(!provider.allow_private_url);
        assert!(provider.credential_ref.is_none());
        assert!(provider.timeout_seconds.is_none());
        let encoded = serde_json::to_string(provider).unwrap();
        assert!(!encoded.contains("api_key"));
        assert!(!encoded.contains("secret"));
    }

    #[test]
    fn loopback_feed_url_requires_explicit_private_consent() {
        assert!(validate_remote_url("http://127.0.0.1:9117/torznab", false).is_err());
        assert!(validate_remote_url("http://127.0.0.1:9117/torznab", true).is_ok());
    }

    #[test]
    fn torznab_provider_settings_assign_credential_ref() {
        let settings = SearchSettings {
            enabled: true,
            default_provider: None,
            default_result_limit: 25,
            allow_private_remote_urls: false,
            providers: vec![SearchProviderSetting {
                name: "local_jackett".to_string(),
                enabled: false,
                label: Some("Local Jackett".to_string()),
                feed_url: Some("https://indexer.example/torznab".to_string()),
                format: SearchProviderFormat::Torznab,
                categories: vec!["2000".to_string()],
                credential_ref: None,
                allow_private_url: false,
                timeout_seconds: Some(120),
            }],
        };
        let mapped = settings.provider_map().unwrap();
        let provider = mapped.get("local_jackett").unwrap();
        assert_eq!(
            provider.credential_ref.as_deref(),
            Some("search-provider:local_jackett")
        );
        assert_eq!(provider.timeout_seconds, Some(60));
    }
}
