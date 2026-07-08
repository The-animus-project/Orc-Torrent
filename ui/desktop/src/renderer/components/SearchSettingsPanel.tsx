import React, { useEffect, useMemo, useState } from "react";
import type {
  SearchFeatureSettings,
  SearchProviderFormat,
  SearchProviderSetting,
  SearchSettingsPatchRequest,
} from "../types";
import { updateSearchSettings } from "../utils/searchApi";

interface SearchSettingsPanelProps {
  online: boolean;
  settings: SearchFeatureSettings | null;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onSettingsChanged: (settings: SearchFeatureSettings) => void;
}

function buildProviderFormState(settings: SearchFeatureSettings): SearchProviderSetting[] {
  return settings.providers.map((provider) => ({
    name: provider.name,
    enabled: provider.enabled,
    label: provider.is_custom ? provider.label : null,
    feed_url: provider.requires_feed_url ? (provider.feed_url ?? "") : null,
    format: provider.provider_format ?? "open_content_json",
    categories: provider.is_custom ? provider.categories.filter((value) => value !== "all") : [],
  }));
}

function getCustomProviderDescription(format: SearchProviderFormat): string {
  switch (format) {
    case "rss_atom":
      return "Custom RSS or Atom torrent feed for legal and open-content catalogs.";
    case "open_content_json":
    default:
      return "Custom JSON feed for legal and open-content torrents.";
  }
}

function getProviderUrlLabel(format: SearchProviderFormat): string {
  return format === "rss_atom" ? "RSS or Atom feed URL" : "JSON feed URL";
}

function getProviderUrlPlaceholder(format: SearchProviderFormat): string {
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

  const removeProvider = (name: string) => {
    setProviders((current) => current.filter((provider) => provider.name !== name));
    setDefaultProvider((current) => (current === name ? "" : current));
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
      },
    ]);
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
      const normalizedProviders = providers.map((provider) => ({
        name: provider.name,
        enabled: provider.enabled,
        label: typeof provider.label === "string" && provider.label.trim().length > 0 ? provider.label.trim() : null,
        feed_url:
          typeof provider.feed_url === "string" && provider.feed_url.trim().length === 0
            ? null
            : (provider.feed_url ?? null),
        format: provider.format ?? "open_content_json",
        categories:
          provider.categories
            ?.map((value) => value.trim())
            .filter((value) => value.length > 0 && value.toLowerCase() !== "all") ?? [],
      }));
      const patch: SearchSettingsPatchRequest = {
        enabled,
        default_provider: chosenDefault,
        default_result_limit: parsedLimit,
        allow_private_remote_urls: allowPrivateRemoteUrls,
        providers: normalizedProviders,
      };
      const updated = await updateSearchSettings(patch);
      onSettingsChanged(updated);
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
            Leave this off unless you intentionally host a compliant catalog on your own LAN.
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
      </div>

      <p className="settingsSummaryNote">
        Custom providers support the built-in legal JSON format or standard RSS/Atom torrent feeds.
      </p>

      <div className="searchProviderList">
        {providers.map((provider) => {
          const providerInfo = providerInfoMap.get(provider.name);
          const isCustom = providerInfo?.is_custom ?? provider.name.startsWith("custom_feed_");
          const providerFormat = provider.format ?? providerInfo?.provider_format ?? "open_content_json";
          const label = provider.label?.trim() || providerInfo?.label || provider.name;
          const categoriesValue = provider.categories?.join(", ") ?? "";

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
                </div>
                <div className="searchProviderCardActions">
                  {isCustom ? (
                    <button
                      className="btn ghost compact"
                      onClick={() => removeProvider(provider.name)}
                      disabled={!online}
                    >
                      Remove
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
                        })
                      }
                      disabled={!online}
                    >
                      <option value="open_content_json">Open-content JSON</option>
                      <option value="rss_atom">RSS / Atom</option>
                    </select>
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
                    <span className="settingsRateLimitLabel">Categories</span>
                    <input
                      type="text"
                      className="settingsNumberInput"
                      placeholder="books, linux, music"
                      value={categoriesValue}
                      onChange={(event) =>
                        updateProvider(provider.name, {
                          categories: event.target.value
                            .split(",")
                            .map((value) => value.trim())
                            .filter((value) => value.length > 0),
                        })
                      }
                      disabled={!online}
                    />
                  </label>
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
          }}
          disabled={!online || isSaving}
        >
          Reset form
        </button>
      </div>
    </div>
  );
}
