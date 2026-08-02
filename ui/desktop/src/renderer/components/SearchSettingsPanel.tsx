import React, { useEffect, useMemo, useState } from "react";
import type {
  SearchFeatureSettings,
  SearchProviderFormat,
  SearchProviderSetting,
  SearchSettingsPatchRequest,
} from "../types";
import {
  deleteSearchProvider,
  deleteSearchProviderCredentials,
  getSearchSettings,
  putSearchProviderCredentials,
  testSearchProvider,
  updateSearchSettings,
} from "../utils/searchApi";
import {
  PRIVATE_ENDPOINT_WARNING,
  TORZNAB_TIMEOUT_DEFAULT,
  createEmptyTorznabProvider,
  isTorznabFormat,
  nextTorznabProviderName,
  parseTorznabCategories,
  providerConnectionLabel,
  shouldSendApiKey,
  validateProviderName,
  validateTorznabCategories,
  validateTorznabEndpoint,
  validateTorznabTimeout,
} from "../utils/torznabSettings";

interface SearchSettingsPanelProps {
  online: boolean;
  settings: SearchFeatureSettings | null;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onSettingsChanged: (settings: SearchFeatureSettings) => void;
}

type ApiKeyDrafts = Record<string, string>;
type TestingState = Record<string, boolean>;

function buildProviderFormState(settings: SearchFeatureSettings): SearchProviderSetting[] {
  return settings.providers.map((provider) => ({
    name: provider.name,
    enabled: provider.enabled,
    label: provider.is_custom ? provider.label : null,
    feed_url: provider.requires_feed_url ? (provider.feed_url ?? "") : null,
    format: provider.provider_format ?? "open_content_json",
    categories: provider.is_custom ? provider.categories.filter((value) => value !== "all") : [],
    allow_private_url: provider.allow_private_url ?? false,
    timeout_seconds: provider.timeout_seconds ?? null,
  }));
}

function getCustomProviderDescription(format: SearchProviderFormat): string {
  switch (format) {
    case "rss_atom":
      return "Custom RSS or Atom torrent feed for legal and open-content catalogs.";
    case "torznab":
      return "Torznab-compatible indexer endpoint (Jackett, Prowlarr, or similar).";
    case "open_content_json":
    default:
      return "Custom JSON feed for legal and open-content torrents.";
  }
}

function getProviderUrlLabel(format: SearchProviderFormat): string {
  if (format === "torznab") {
    return "Torznab endpoint URL";
  }
  return format === "rss_atom" ? "RSS or Atom feed URL" : "JSON feed URL";
}

function getProviderUrlPlaceholder(format: SearchProviderFormat): string {
  if (format === "torznab") {
    return "http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/";
  }
  return format === "rss_atom"
    ? "https://example.com/open-content-feed.xml"
    : "https://example.com/open-content-feed.json";
}

function nextCustomProviderName(providers: SearchProviderSetting[]): string {
  let index = 1;
  while (providers.some((provider) => provider.name === `custom_feed_${index}`)) {
    index += 1;
  }
  return `custom_feed_${index}`;
}

export function SearchSettingsPanel({
  online,
  settings,
  onError,
  onSuccess,
  onSettingsChanged,
}: SearchSettingsPanelProps) {
  const [enabled, setEnabled] = useState(false);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultLimit, setDefaultLimit] = useState("25");
  const [allowPrivateRemoteUrls, setAllowPrivateRemoteUrls] = useState(false);
  const [providers, setProviders] = useState<SearchProviderSetting[]>([]);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<ApiKeyDrafts>({});
  const [testing, setTesting] = useState<TestingState>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setEnabled(settings.enabled);
    setDefaultProvider(settings.default_provider ?? "");
    setDefaultLimit(String(settings.default_result_limit));
    setAllowPrivateRemoteUrls(settings.allow_private_remote_urls);
    setProviders(buildProviderFormState(settings));
    setApiKeyDrafts({});
  }, [settings]);

  const enabledProviderOptions = useMemo(() => providers.filter((provider) => provider.enabled), [providers]);
  const providerInfoMap = useMemo(
    () => new Map(settings?.providers.map((provider) => [provider.name, provider]) ?? []),
    [settings]
  );

  const updateProvider = (name: string, patch: Partial<SearchProviderSetting>) => {
    setProviders((current) =>
      current.map((provider) => (provider.name === name ? { ...provider, ...patch } : provider))
    );
  };

  const removeProviderLocal = (name: string) => {
    setProviders((current) => current.filter((provider) => provider.name !== name));
    setDefaultProvider((current) => (current === name ? "" : current));
    setApiKeyDrafts((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  };

  const handleAddCustomProvider = () => {
    setProviders((current) => [
      ...current,
      {
        name: nextCustomProviderName(current),
        enabled: true,
        label: "My custom feed",
        feed_url: "",
        format: "open_content_json",
        categories: [],
        allow_private_url: false,
        timeout_seconds: null,
      },
    ]);
  };

  const handleAddTorznabProvider = () => {
    setProviders((current) => [...current, createEmptyTorznabProvider(nextTorznabProviderName(current))]);
  };

  const handleRemoveProvider = async (name: string) => {
    const info = providerInfoMap.get(name);
    if (!info?.is_custom && !name.startsWith("custom_feed_") && !name.startsWith("torznab_")) {
      removeProviderLocal(name);
      return;
    }
    if (!window.confirm(`Remove provider "${info?.label ?? name}"? Stored API keys for this provider will be deleted.`)) {
      return;
    }
    if (!settings?.providers.some((provider) => provider.name === name)) {
      removeProviderLocal(name);
      return;
    }
    try {
      await deleteSearchProvider(name);
      const refreshed = await getSearchSettings();
      onSettingsChanged(refreshed);
      onSuccess("Provider removed");
    } catch (error) {
      // Fall back to local removal for unsaved drafts.
      removeProviderLocal(name);
      onError(error instanceof Error ? error.message : "Failed to remove provider");
    }
  };

  const handleTestProvider = async (name: string) => {
    setTesting((current) => ({ ...current, [name]: true }));
    try {
      const draftKey = apiKeyDrafts[name]?.trim();
      if (draftKey) {
        await putSearchProviderCredentials(name, draftKey);
        setApiKeyDrafts((current) => ({ ...current, [name]: "" }));
      }
      const result = await testSearchProvider(name);
      const refreshed = await getSearchSettings();
      onSettingsChanged(refreshed);
      if (result.ok) {
        onSuccess(result.message);
      } else {
        onError(result.message);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Provider test failed");
    } finally {
      setTesting((current) => ({ ...current, [name]: false }));
    }
  };

  const handleClearCredentials = async (name: string) => {
    try {
      await deleteSearchProviderCredentials(name);
      setApiKeyDrafts((current) => ({ ...current, [name]: "" }));
      const refreshed = await getSearchSettings();
      onSettingsChanged(refreshed);
      onSuccess("API key cleared");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to clear API key");
    }
  };

  const handleSave = async () => {
    if (!settings) {
      onError("Search settings are not available yet");
      return;
    }

    const parsedLimit = Number(defaultLimit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      onError("Default result limit must be between 1 and 100");
      return;
    }

    for (const provider of providers) {
      const format = provider.format ?? "open_content_json";
      if (!isTorznabFormat(format)) {
        continue;
      }
      const nameError = validateProviderName(provider.name);
      if (nameError) {
        onError(nameError);
        return;
      }
      const endpointError = validateTorznabEndpoint(provider.feed_url ?? "");
      if (endpointError) {
        onError(`${provider.label ?? provider.name}: ${endpointError}`);
        return;
      }
      const timeoutValue = String(provider.timeout_seconds ?? TORZNAB_TIMEOUT_DEFAULT);
      const timeoutError = validateTorznabTimeout(timeoutValue);
      if (timeoutError) {
        onError(`${provider.label ?? provider.name}: ${timeoutError}`);
        return;
      }
      const categories = provider.categories ?? [];
      const categoriesError = validateTorznabCategories(categories);
      if (categoriesError) {
        onError(`${provider.label ?? provider.name}: ${categoriesError}`);
        return;
      }
      const info = providerInfoMap.get(provider.name);
      const hasSaved = info?.has_credentials ?? false;
      const draftKey = apiKeyDrafts[provider.name] ?? "";
      if (!hasSaved && !draftKey.trim()) {
        onError(`${provider.label ?? provider.name}: API key is required for a new Torznab provider`);
        return;
      }
    }

    const chosenDefault =
      defaultProvider && enabledProviderOptions.some((provider) => provider.name === defaultProvider)
        ? defaultProvider
        : enabledProviderOptions[0]?.name;

    if (enabled && !chosenDefault) {
      onError("Enable at least one provider before turning search on");
      return;
    }

    setIsSaving(true);
    try {
      const normalizedProviders = providers.map((provider) => {
        const format = provider.format ?? "open_content_json";
        return {
          name: provider.name,
          enabled: provider.enabled,
          label: typeof provider.label === "string" && provider.label.trim().length > 0 ? provider.label.trim() : null,
          feed_url:
            typeof provider.feed_url === "string" && provider.feed_url.trim().length === 0
              ? null
              : (provider.feed_url ?? null),
          format,
          categories:
            provider.categories
              ?.map((value) => value.trim())
              .filter((value) => value.length > 0 && value.toLowerCase() !== "all") ?? [],
          allow_private_url: isTorznabFormat(format) ? Boolean(provider.allow_private_url) : false,
          timeout_seconds: isTorznabFormat(format)
            ? Number(provider.timeout_seconds ?? TORZNAB_TIMEOUT_DEFAULT)
            : null,
        };
      });
      const patch: SearchSettingsPatchRequest = {
        enabled,
        default_provider: chosenDefault,
        default_result_limit: parsedLimit,
        allow_private_remote_urls: allowPrivateRemoteUrls,
        providers: normalizedProviders,
      };
      const updated = await updateSearchSettings(patch);

      for (const provider of normalizedProviders) {
        if (!isTorznabFormat(provider.format)) {
          continue;
        }
        const info = providerInfoMap.get(provider.name);
        const draftKey = apiKeyDrafts[provider.name] ?? "";
        if (shouldSendApiKey(draftKey, Boolean(info?.has_credentials))) {
          await putSearchProviderCredentials(provider.name, draftKey.trim());
        }
      }

      const refreshed = await getSearchSettings();
      onSettingsChanged(refreshed.providers.length > 0 ? refreshed : updated);
      setApiKeyDrafts({});
      onSuccess("Search settings saved");
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to save search settings");
    } finally {
      setIsSaving(false);
    }
  };

  if (!settings) {
    return <div className="settingsSummaryNote">Search settings are loading from the daemon.</div>;
  }

  return (
    <div className="searchSettingsStack">
      <div className="settingsRateLimitToggleRow">
        <div>
          <div className="settingsRateLimitLabel">Enable torrent search</div>
          <p className="settingsSummaryNote">{settings.safety_note}</p>
        </div>
        <label className="toggle small" aria-label="Enable torrent search">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            disabled={!online}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="settingsRateLimitGrid">
        <label className="settingsRateLimitField">
          <span className="settingsRateLimitLabel">Default provider</span>
          <select
            className="notificationSoundSelect"
            value={defaultProvider}
            onChange={(event) => setDefaultProvider(event.target.value)}
            disabled={!online || enabledProviderOptions.length === 0}
          >
            {enabledProviderOptions.map((provider) => {
              const info = providerInfoMap.get(provider.name);
              const label = provider.label?.trim() || info?.label || provider.name;
              return (
                <option key={provider.name} value={provider.name}>
                  {label}
                </option>
              );
            })}
          </select>
        </label>
        <label className="settingsRateLimitField">
          <span className="settingsRateLimitLabel">Default result limit</span>
          <input
            type="number"
            min="1"
            max="100"
            step="1"
            inputMode="numeric"
            className="settingsNumberInput"
            value={defaultLimit}
            onChange={(event) => setDefaultLimit(event.target.value)}
            disabled={!online}
          />
        </label>
      </div>

      <div className="settingsRateLimitToggleRow">
        <div>
          <div className="settingsRateLimitLabel">Allow private-network feed URLs</div>
          <p className="settingsSummaryNote">
            Leave this off unless you intentionally host a compliant catalog on your own LAN. Torznab
            local endpoints use a separate per-provider consent below.
          </p>
        </div>
        <label className="toggle small" aria-label="Allow private network feed URLs">
          <input
            type="checkbox"
            checked={allowPrivateRemoteUrls}
            onChange={(event) => setAllowPrivateRemoteUrls(event.target.checked)}
            disabled={!online}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="settingsQuickActions">
        <button className="btn ghost" onClick={handleAddCustomProvider} disabled={!online || isSaving}>
          Add custom provider
        </button>
        <button className="btn ghost" onClick={handleAddTorznabProvider} disabled={!online || isSaving}>
          Add Torznab provider
        </button>
      </div>

      <p className="settingsSummaryNote">
        Custom providers support legal JSON feeds, RSS/Atom feeds, or Torznab endpoints such as Jackett
        and Prowlarr. Search results remain display-only until you manually add a torrent.
      </p>

      <div className="searchProviderList">
        {providers.map((provider) => {
          const providerInfo = providerInfoMap.get(provider.name);
          const isCustom =
            providerInfo?.is_custom ??
            (provider.name.startsWith("custom_feed_") || provider.name.startsWith("torznab_"));
          const providerFormat = provider.format ?? providerInfo?.provider_format ?? "open_content_json";
          const isTorznab = isTorznabFormat(providerFormat);
          const label = provider.label?.trim() || providerInfo?.label || provider.name;
          const categoriesValue = provider.categories?.join(", ") ?? "";
          const hasCredentials = Boolean(providerInfo?.has_credentials);
          const statusLabel = providerConnectionLabel({
            enabled: provider.enabled,
            hasCredentials: isTorznab ? hasCredentials || Boolean(apiKeyDrafts[provider.name]?.trim()) : true,
            connectionStatus: providerInfo?.connection_status,
            lastError: providerInfo?.last_error,
          });

          return (
            <div key={provider.name} className="searchProviderCard">
              <div className="searchProviderCardHeader">
                <div>
                  <div className="searchProviderLabel">{label}</div>
                  <p className="settingsSummaryNote">
                    {isCustom
                      ? getCustomProviderDescription(providerFormat)
                      : (providerInfo?.description ?? getCustomProviderDescription(providerFormat))}
                  </p>
                  {isTorznab ? (
                    <p className="settingsSummaryNote">
                      Status: {statusLabel}
                      {providerInfo?.last_error ? ` — ${providerInfo.last_error}` : ""}
                    </p>
                  ) : null}
                </div>
                <div className="searchProviderCardActions">
                  {isCustom ? (
                    <button
                      className="btn ghost compact"
                      onClick={() => void handleRemoveProvider(provider.name)}
                      disabled={!online}
                    >
                      Remove
                    </button>
                  ) : null}
                  {isTorznab ? (
                    <button
                      className="btn ghost compact"
                      onClick={() => void handleTestProvider(provider.name)}
                      disabled={!online || testing[provider.name]}
                    >
                      {testing[provider.name] ? "Testing..." : "Test"}
                    </button>
                  ) : null}
                  <label className="toggle small" aria-label={`Enable ${label}`}>
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={(event) => updateProvider(provider.name, { enabled: event.target.checked })}
                      disabled={!online}
                    />
                    <span className="slider" />
                  </label>
                </div>
              </div>

              {isCustom ? (
                <div className="searchCustomProviderGrid">
                  <label className="settingsRateLimitField searchProviderField">
                    <span className="settingsRateLimitLabel">Feed format</span>
                    <select
                      className="notificationSoundSelect"
                      value={providerFormat}
                      onChange={(event) =>
                        updateProvider(provider.name, {
                          format: event.target.value as SearchProviderFormat,
                          allow_private_url: false,
                          timeout_seconds:
                            event.target.value === "torznab" ? TORZNAB_TIMEOUT_DEFAULT : null,
                        })
                      }
                      disabled={!online}
                    >
                      <option value="open_content_json">Open-content JSON</option>
                      <option value="rss_atom">RSS / Atom</option>
                      <option value="torznab">Torznab</option>
                    </select>
                  </label>
                  <label className="settingsRateLimitField searchProviderField">
                    <span className="settingsRateLimitLabel">Provider name</span>
                    <input
                      type="text"
                      className="settingsNumberInput"
                      value={provider.name}
                      onChange={(event) => updateProvider(provider.name, { name: event.target.value })}
                      disabled={!online || Boolean(providerInfo)}
                    />
                  </label>
                  <label className="settingsRateLimitField searchProviderField">
                    <span className="settingsRateLimitLabel">Display name</span>
                    <input
                      type="text"
                      className="settingsNumberInput"
                      value={provider.label ?? ""}
                      onChange={(event) => updateProvider(provider.name, { label: event.target.value })}
                      disabled={!online}
                    />
                  </label>
                  <label className="settingsRateLimitField searchProviderField">
                    <span className="settingsRateLimitLabel">{getProviderUrlLabel(providerFormat)}</span>
                    <input
                      type="url"
                      className="settingsNumberInput searchUrlInput"
                      placeholder={getProviderUrlPlaceholder(providerFormat)}
                      value={provider.feed_url ?? ""}
                      onChange={(event) => updateProvider(provider.name, { feed_url: event.target.value })}
                      disabled={!online}
                    />
                  </label>
                  <label className="settingsRateLimitField searchProviderField">
                    <span className="settingsRateLimitLabel">
                      {isTorznab ? "Categories (Torznab IDs)" : "Categories"}
                    </span>
                    <input
                      type="text"
                      className="settingsNumberInput"
                      placeholder={isTorznab ? "2000, 5000" : "books, linux, music"}
                      value={categoriesValue}
                      onChange={(event) =>
                        updateProvider(provider.name, {
                          categories: isTorznab
                            ? parseTorznabCategories(event.target.value)
                            : event.target.value
                                .split(",")
                                .map((value) => value.trim())
                                .filter((value) => value.length > 0),
                        })
                      }
                      disabled={!online}
                    />
                  </label>

                  {isTorznab ? (
                    <>
                      <label className="settingsRateLimitField searchProviderField">
                        <span className="settingsRateLimitLabel">API key</span>
                        <input
                          type="password"
                          className="settingsNumberInput"
                          autoComplete="new-password"
                          placeholder={hasCredentials ? "API key saved" : "Enter Torznab API key"}
                          value={apiKeyDrafts[provider.name] ?? ""}
                          onChange={(event) =>
                            setApiKeyDrafts((current) => ({
                              ...current,
                              [provider.name]: event.target.value,
                            }))
                          }
                          disabled={!online}
                        />
                      </label>
                      <label className="settingsRateLimitField searchProviderField">
                        <span className="settingsRateLimitLabel">Request timeout (seconds)</span>
                        <input
                          type="number"
                          min="2"
                          max="60"
                          className="settingsNumberInput"
                          value={String(provider.timeout_seconds ?? TORZNAB_TIMEOUT_DEFAULT)}
                          onChange={(event) =>
                            updateProvider(provider.name, {
                              timeout_seconds: Number(event.target.value),
                            })
                          }
                          disabled={!online}
                        />
                      </label>
                      <div className="settingsRateLimitToggleRow searchProviderField">
                        <div>
                          <div className="settingsRateLimitLabel">Allow local/private endpoint</div>
                          <p className="settingsSummaryNote">{PRIVATE_ENDPOINT_WARNING}</p>
                        </div>
                        <label className="toggle small" aria-label="Allow local or private Torznab endpoint">
                          <input
                            type="checkbox"
                            checked={Boolean(provider.allow_private_url)}
                            onChange={(event) =>
                              updateProvider(provider.name, { allow_private_url: event.target.checked })
                            }
                            disabled={!online}
                          />
                          <span className="slider" />
                        </label>
                      </div>
                      {hasCredentials ? (
                        <div className="settingsQuickActions">
                          <button
                            className="btn ghost compact"
                            onClick={() => void handleClearCredentials(provider.name)}
                            disabled={!online}
                          >
                            Clear API key
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : providerInfo?.requires_feed_url ? (
                <label className="settingsRateLimitField searchProviderField">
                  <span className="settingsRateLimitLabel">Legal JSON feed URL</span>
                  <input
                    type="url"
                    className="settingsNumberInput searchUrlInput"
                    placeholder={getProviderUrlPlaceholder(providerInfo?.provider_format ?? "open_content_json")}
                    value={provider.feed_url ?? ""}
                    onChange={(event) => updateProvider(provider.name, { feed_url: event.target.value })}
                    disabled={!online}
                  />
                </label>
              ) : null}

              <div className="searchProviderCategories">
                {(providerInfo?.categories ?? ["all"]).map((category) => (
                  <span key={category} className="filterChip">
                    {category}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="settingsQuickActions">
        <button className="btn primary" onClick={() => void handleSave()} disabled={!online || isSaving}>
          {isSaving ? "Saving..." : "Save search settings"}
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            if (!settings) return;
            setEnabled(settings.enabled);
            setDefaultProvider(settings.default_provider ?? "");
            setDefaultLimit(String(settings.default_result_limit));
            setAllowPrivateRemoteUrls(settings.allow_private_remote_urls);
            setProviders(buildProviderFormState(settings));
            setApiKeyDrafts({});
          }}
          disabled={!online || isSaving}
        >
          Reset form
        </button>
      </div>
    </div>
  );
}
