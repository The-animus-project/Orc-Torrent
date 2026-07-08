import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SearchFeatureSettings, SearchProviderInfo, SearchProviderStatus, SearchResult } from "../types";
import { addSearchResult, getSearchProviders, searchTorrents } from "../utils/searchApi";
import { fmtBytes } from "../utils/format";
import {
  ALL_PROVIDERS_SOURCE,
  buildSearchSettingsKey,
  normalizeSearchQuery,
  resolveProviderSelection,
  SEARCH_QUERY_MAX_LEN,
  SEARCH_QUERY_MIN_LEN,
  SEARCH_RESULT_LIMIT_MAX,
  sortProvidersByPriority,
  sortSearchResults,
  type SearchSortMode,
} from "../utils/searchUtils";

interface SearchPageProps {
  online: boolean;
  isActive: boolean;
  settings: SearchFeatureSettings | null;
  query: string;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  backLabel?: string;
  requireQuery?: boolean;
  onTorrentAdded: (id: string, showFileDialog?: boolean, torrentName?: string) => void | Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}

function formatSearchMetric(value?: number | null): string {
  if (typeof value !== "number") {
    return "—";
  }
  return value.toLocaleString();
}

export function SearchPage({
  online,
  isActive,
  settings,
  query,
  onQueryChange,
  onBack,
  backLabel = "Back to downloads",
  requireQuery = false,
  onTorrentAdded,
  onError,
  onSuccess,
}: SearchPageProps) {
  const [providers, setProviders] = useState<SearchProviderInfo[]>([]);
  const [providerName, setProviderName] = useState(ALL_PROVIDERS_SOURCE);
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState("25");
  const [sortMode, setSortMode] = useState<SearchSortMode>("best");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<SearchProviderStatus[]>([]);
  const [lastBrowseMode, setLastBrowseMode] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const searchRequestRef = useRef(0);
  const providersCacheKeyRef = useRef<string | null>(null);
  const autoSearchQueryRef = useRef<string | null>(null);

  const settingsKey = useMemo(() => buildSearchSettingsKey(settings), [settings]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    setLimit(String(settings.default_result_limit));
  }, [settingsKey, settings]);

  useEffect(() => {
    if (!settingsKey || !settings) {
      return;
    }

    if (providersCacheKeyRef.current === settingsKey && providers.length > 0) {
      return;
    }

    let cancelled = false;
    const showLoading = providers.length === 0;
    if (showLoading) {
      setLoadingProviders(true);
    }
    setProvidersError(null);

    void getSearchProviders()
      .then((loaded) => {
        if (cancelled) {
          return;
        }
        providersCacheKeyRef.current = settingsKey;
        setProviders(loaded);
        setProviderName((current) =>
          resolveProviderSelection(current, loaded.filter((provider) => provider.enabled), settings.default_provider)
        );
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load search providers";
        setProvidersError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingProviders(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [settingsKey, settings]);

  const enabledProviders = useMemo(
    () => sortProvidersByPriority(providers.filter((provider) => provider.enabled)),
    [providers]
  );

  const resolvedProviderName = useMemo(
    () => resolveProviderSelection(providerName, enabledProviders, settings?.default_provider),
    [providerName, enabledProviders, settings?.default_provider]
  );

  const providerLabelMap = useMemo(
    () => new Map(providers.map((provider) => [provider.name, provider.label])),
    [providers]
  );

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.name === resolvedProviderName) ?? null,
    [providers, resolvedProviderName]
  );

  const browseSupported = useMemo(() => {
    if (resolvedProviderName === ALL_PROVIDERS_SOURCE) {
      return enabledProviders.some((provider) => provider.supports_browse);
    }
    return activeProvider?.supports_browse ?? false;
  }, [activeProvider, enabledProviders, resolvedProviderName]);

  const availableCategories = useMemo(() => {
    const categorySet = new Set<string>(["all"]);
    const sourceProviders =
      resolvedProviderName === ALL_PROVIDERS_SOURCE ? enabledProviders : activeProvider ? [activeProvider] : [];
    for (const provider of sourceProviders) {
      for (const providerCategory of provider.categories) {
        categorySet.add(providerCategory);
      }
    }
    const merged = [...categorySet];
    return ["all", ...merged.filter((value) => value !== "all").sort((left, right) => left.localeCompare(right))];
  }, [activeProvider, enabledProviders, resolvedProviderName]);

  useEffect(() => {
    if (!availableCategories.includes(category)) {
      setCategory("all");
    }
  }, [availableCategories, category]);

  const sortedResults = useMemo(() => sortSearchResults(results, sortMode), [results, sortMode]);

  const onlineProviderCount = providerStatuses.filter((provider) => provider.ok).length;
  const unavailableProviderCount = providerStatuses.filter((provider) => !provider.ok).length;
  const canSearch = online && settings?.enabled && enabledProviders.length > 0;
  const queryTrimmed = normalizeSearchQuery(query);
  const queryReady = queryTrimmed.length >= SEARCH_QUERY_MIN_LEN;
  const browseSupportedForSelection = browseSupported && !requireQuery;

  const runSearch = useCallback(async () => {
    if (!settings?.enabled) {
      setErrorText("Search is disabled in Settings.");
      onError("Search is disabled in Settings.");
      return;
    }

    if (!online) {
      setErrorText("Search is unavailable while the daemon is offline.");
      onError("Search is unavailable while the daemon is offline.");
      return;
    }

    if (enabledProviders.length === 0) {
      setErrorText("Enable at least one search provider in Settings.");
      onError("Enable at least one search provider in Settings.");
      return;
    }

    if (requireQuery && !queryReady) {
      setErrorText(`Enter at least ${SEARCH_QUERY_MIN_LEN} characters to search movie providers.`);
      return;
    }

    if (!requireQuery && queryTrimmed.length === 0) {
      // browse mode allowed
    } else if (!queryReady) {
      setErrorText(`Enter at least ${SEARCH_QUERY_MIN_LEN} characters, or leave the box empty to browse`);
      return;
    }

    const parsedLimit = Number(limit);
    if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > SEARCH_RESULT_LIMIT_MAX) {
      setErrorText(`Result limit must be between 1 and ${SEARCH_RESULT_LIMIT_MAX}`);
      return;
    }

    const requestId = ++searchRequestRef.current;
    setIsSearching(true);
    setErrorText(null);

    try {
      const response = await searchTorrents({
        query: queryTrimmed,
        category: category === "all" ? null : category,
        limit: parsedLimit,
        source: resolvedProviderName === ALL_PROVIDERS_SOURCE ? ALL_PROVIDERS_SOURCE : resolvedProviderName,
      });

      if (requestId !== searchRequestRef.current) {
        return;
      }

      setResults(response.results);
      setProviderStatuses(response.providers);
      setLastBrowseMode(response.browse_mode);

      if (response.providers.length > 0 && response.providers.every((provider) => !provider.ok)) {
        const message = "All selected providers are currently unavailable.";
        setErrorText(message);
        onError(message);
        return;
      }

      if (response.results.length === 0) {
        onSuccess(
          response.browse_mode
            ? "No approved catalog items matched that filter"
            : "No approved results matched that search"
        );
      }
    } catch (error) {
      if (requestId !== searchRequestRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : "Search failed";
      setErrorText(message);
      setResults([]);
      setProviderStatuses([]);
      onError(message);
    } finally {
      if (requestId === searchRequestRef.current) {
        setIsSearching(false);
      }
    }
  }, [
    settings?.enabled,
    online,
    enabledProviders.length,
    queryTrimmed,
    queryReady,
    limit,
    category,
    resolvedProviderName,
    requireQuery,
    onError,
    onSuccess,
  ]);

  useEffect(() => {
    if (!isActive || !canSearch || loadingProviders || requireQuery) {
      return;
    }

    if (!queryReady) {
      autoSearchQueryRef.current = null;
      return;
    }

    if (autoSearchQueryRef.current === queryTrimmed) {
      return;
    }

    autoSearchQueryRef.current = queryTrimmed;
    void runSearch();
  }, [isActive, canSearch, loadingProviders, queryReady, queryTrimmed, requireQuery, runSearch]);

  useEffect(() => {
    if (!isActive) {
      autoSearchQueryRef.current = null;
    }
  }, [isActive]);

  const handleAdd = async (result: SearchResult) => {
    setAddingId(result.id);
    try {
      const added = await addSearchResult(result);
      await Promise.resolve(onTorrentAdded(added.id, added.showFileDialog, result.name));
      onSuccess(
        added.addedVia === "magnet"
          ? `Added ${result.name} from magnet search result`
          : `Imported ${result.name} from torrent URL`
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to add search result");
    } finally {
      setAddingId(null);
    }
  };

  const handleOpenDetails = async (url: string) => {
    const opened = await window.orc?.openExternalUrl?.(url);
    if (!opened) {
      onError("Unable to open the provider details link");
    }
  };

  const handleClear = () => {
    searchRequestRef.current += 1;
    onQueryChange("");
    setCategory("all");
    setResults([]);
    setProviderStatuses([]);
    setLastBrowseMode(false);
    setErrorText(null);
    setIsSearching(false);
    autoSearchQueryRef.current = null;
  };

  if (!settings) {
    return (
      <div className="searchPage">
        <div className="searchPageHeader searchPageHeaderCompact">
          <button className="btn" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="searchPage">
      <div className="searchPageHeader searchPageHeaderCompact">
        <button className="btn" onClick={onBack}>
          {backLabel}
        </button>
      </div>

      <div className="searchSafetyNote">{settings.safety_note}</div>

      <div className="searchControlsCard">
        <div className="searchControlsGrid">
          <label className="searchControlField searchControlFieldWide">
            <span className="settingsRateLimitLabel">Query</span>
            <input
              type="text"
              className="searchInput searchPageInput"
              placeholder={
                browseSupportedForSelection
                  ? "Search approved torrents or leave blank to browse"
                  : requireQuery
                    ? "Search movies and TV by title"
                    : "Search approved torrents"
              }
              value={query}
              maxLength={SEARCH_QUERY_MAX_LEN}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void runSearch();
                }
              }}
              disabled={!canSearch || loadingProviders}
            />
          </label>

          <label className="searchControlField">
            <span className="settingsRateLimitLabel">Provider</span>
            <select
              className="notificationSoundSelect"
              value={resolvedProviderName}
              onChange={(event) => {
                setProviderName(event.target.value);
                setCategory("all");
              }}
              disabled={!canSearch || loadingProviders || enabledProviders.length === 0}
            >
              {enabledProviders.length > 1 ? <option value={ALL_PROVIDERS_SOURCE}>All approved sources</option> : null}
              {enabledProviders.map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>

          <label className="searchControlField">
            <span className="settingsRateLimitLabel">Category</span>
            <select
              className="notificationSoundSelect"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              disabled={!canSearch || loadingProviders}
            >
              {availableCategories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="searchControlField">
            <span className="settingsRateLimitLabel">Result limit</span>
            <input
              type="number"
              min="1"
              max={SEARCH_RESULT_LIMIT_MAX}
              step="1"
              inputMode="numeric"
              className="settingsNumberInput"
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              disabled={!canSearch || loadingProviders}
            />
          </label>
        </div>

        <div className="settingsQuickActions">
          <button
            className="btn primary"
            onClick={() => void runSearch()}
            disabled={!canSearch || isSearching || loadingProviders || (requireQuery && !queryReady)}
          >
            {isSearching ? "Searching..." : requireQuery || queryTrimmed.length > 0 ? "Search" : "Browse"}
          </button>
          <button className="btn ghost" onClick={handleClear} disabled={isSearching}>
            Clear
          </button>
        </div>

        {!settings.enabled && (
          <p className="settingsSummaryNote">
            Search is disabled in Settings. Turn it on before running provider queries.
          </p>
        )}
        {settings.enabled && enabledProviders.length === 0 && !loadingProviders && (
          <p className="settingsSummaryNote">No search providers are enabled. Turn on providers in Settings → Search.</p>
        )}
        {browseSupportedForSelection && queryTrimmed.length === 0 && (
          <p className="settingsSummaryNote">
            Empty query mode shows the latest items from the selected approved providers.
          </p>
        )}
        {requireQuery && (
          <p className="settingsSummaryNote">
            AnimUS search requires a title query and prioritizes movie and TV providers.
          </p>
        )}
        {providersError ? <div className="errorBanner">{providersError}</div> : null}
        {errorText ? <div className="errorBanner">{errorText}</div> : null}
      </div>

      {providerStatuses.length > 0 ? (
        <div className="searchProviderStatusGrid">
          {providerStatuses.map((provider) => (
            <div key={provider.name} className={`searchProviderStatusCard ${provider.ok ? "is-ok" : "is-error"}`}>
              <div className="searchProviderStatusHeader">
                <div>
                  <div className="searchProviderLabel">{provider.label}</div>
                  <div className="searchProviderStatusMeta">
                    {provider.ok
                      ? `${provider.result_count} result${provider.result_count === 1 ? "" : "s"}`
                      : "Unavailable"}
                  </div>
                </div>
                <span className={`searchProviderStatusPill ${provider.ok ? "is-ok" : "is-error"}`}>
                  {provider.ok ? "Online" : "Offline"}
                </span>
              </div>
              <p className="settingsSummaryNote">
                {provider.ok
                  ? provider.configured
                    ? "Configured and responding."
                    : "Responding with built-in configuration."
                  : (provider.error ?? "Provider did not respond.")}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      <div className="searchResultsCard">
        <div className="searchResultsHeader">
          <div>
            <h2 className="settingsSectionCardTitle">Results</h2>
            <span className="settingsSummaryNote">
              {sortedResults.length} result{sortedResults.length === 1 ? "" : "s"}
              {providerStatuses.length > 0
                ? ` • ${onlineProviderCount} online, ${unavailableProviderCount} offline`
                : ""}
            </span>
          </div>
          <label className="searchSortField">
            <span className="settingsRateLimitLabel">Sort</span>
            <select
              className="notificationSoundSelect"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SearchSortMode)}
              disabled={isSearching || sortedResults.length === 0}
            >
              <option value="best">Best match</option>
              <option value="seeders">Most seeders</option>
              <option value="newest">Newest</option>
              <option value="size">Largest</option>
              <option value="name">Name</option>
            </select>
          </label>
        </div>

        {isSearching ? (
          <div className="searchEmptyState">Searching approved providers…</div>
        ) : sortedResults.length === 0 ? (
          <div className="searchEmptyState">
            {lastBrowseMode
              ? "No approved catalog items matched the current provider or category filter."
              : "Run a search to see approved torrent sources here."}
          </div>
        ) : (
          <div className="searchResultsTableWrap">
            <table className="searchResultsTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Size</th>
                  <th>Seeders</th>
                  <th>Leechers</th>
                  <th>Category</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedResults.map((result) => {
                  const canAdd = Boolean(result.magnet_uri || result.torrent_url);
                  return (
                    <tr key={result.id}>
                      <td>
                        <div className="searchResultName">{result.name}</div>
                        {result.published_at ? <div className="searchResultMeta">{result.published_at}</div> : null}
                      </td>
                      <td>{providerLabelMap.get(result.source) ?? result.source}</td>
                      <td>{typeof result.size_bytes === "number" ? fmtBytes(result.size_bytes) : "—"}</td>
                      <td>{formatSearchMetric(result.seeders)}</td>
                      <td>{formatSearchMetric(result.leechers)}</td>
                      <td>{result.category ?? "—"}</td>
                      <td>
                        <div className="searchResultActions">
                          <button
                            className="btn primary compact"
                            onClick={() => void handleAdd(result)}
                            disabled={!canAdd || addingId === result.id}
                          >
                            {addingId === result.id ? "Adding..." : "Add"}
                          </button>
                          {result.description_url ? (
                            <button
                              className="btn ghost compact"
                              onClick={() => void handleOpenDetails(result.description_url ?? "")}
                            >
                              Details
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
