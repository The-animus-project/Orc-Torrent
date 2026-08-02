import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SearchFeatureSettings, SearchResult } from "../types";
import { addSearchResult, searchTorrents } from "../utils/searchApi";
import { fmtBytes } from "../utils/format";
import {
  ALL_PROVIDERS_SOURCE,
  normalizeSearchQuery,
  resolveProviderSelection,
  SEARCH_QUERY_MAX_LEN,
  SEARCH_QUERY_MIN_LEN,
  sortSearchResults,
} from "../utils/searchUtils";

type ToolbarSearchVariant = "standard" | "animus";

interface ToolbarSearchProps {
  online: boolean;
  settings: SearchFeatureSettings | null;
  query: string;
  onQueryChange: (query: string) => void;
  onTorrentAdded: (id: string, showFileDialog?: boolean, torrentName?: string) => void | Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
  onOpenSearch?: () => void;
  variant?: ToolbarSearchVariant;
}

function formatMetric(value?: number | null): string {
  if (typeof value !== "number") {
    return "—";
  }
  return value.toLocaleString();
}

export function ToolbarSearch({
  online,
  settings,
  query,
  onQueryChange,
  onTorrentAdded,
  onError,
  onSuccess,
  onOpenSearch,
  variant = "standard",
}: ToolbarSearchProps) {
  const listboxId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRequestRef = useRef(0);

  const canSearch = online && settings?.enabled;
  const queryTrimmed = normalizeSearchQuery(query);

  const providerLabelMap = useMemo(
    () => new Map(settings?.providers.map((provider) => [provider.name, provider.label]) ?? []),
    [settings]
  );

  const enabledProviderCount = settings?.providers.filter((provider) => provider.enabled).length ?? 0;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!hostRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const runSearch = async () => {
    if (!canSearch || !settings) {
      onError("Search is unavailable while the daemon is offline or disabled in settings.");
      return;
    }

    if (queryTrimmed.length < SEARCH_QUERY_MIN_LEN) {
      onError(`Enter at least ${SEARCH_QUERY_MIN_LEN} characters, then press Enter.`);
      return;
    }

    if (enabledProviderCount === 0) {
      onError("Enable at least one search provider in Settings.");
      return;
    }

    const requestId = ++searchRequestRef.current;
    setIsOpen(true);
    setIsSearching(true);
    setStatusText("Searching approved providers…");
    setResults([]);
    setActiveIndex(-1);

    const source =
      enabledProviderCount > 1
        ? ALL_PROVIDERS_SOURCE
        : resolveProviderSelection(
            settings.default_provider ?? ALL_PROVIDERS_SOURCE,
            settings.providers.filter((provider) => provider.enabled),
            settings.default_provider
          );
    const limit = settings.default_result_limit;

    try {
      const response = await searchTorrents({
        query: queryTrimmed,
        category: null,
        limit,
        source,
      });

      if (requestId !== searchRequestRef.current) {
        return;
      }

      const sorted = sortSearchResults(response.results, "best");
      setResults(sorted);

      if (response.providers.length > 0 && response.providers.every((provider) => !provider.ok)) {
        const message = "All selected providers are currently unavailable.";
        setStatusText(message);
        onError(message);
        return;
      }

      if (sorted.length === 0) {
        setStatusText("No approved results matched that search.");
        onSuccess("No approved results matched that search");
        return;
      }

      setStatusText(`${sorted.length} result${sorted.length === 1 ? "" : "s"}`);
    } catch (error) {
      if (requestId !== searchRequestRef.current) {
        return;
      }
      const message = error instanceof Error ? error.message : "Search failed";
      setStatusText(message);
      setResults([]);
      onError(message);
    } finally {
      if (requestId === searchRequestRef.current) {
        setIsSearching(false);
      }
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    void runSearch();
  };

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
      setIsOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Failed to add search result");
    } finally {
      setAddingId(null);
    }
  };

  const handleClear = () => {
    searchRequestRef.current += 1;
    onQueryChange("");
    setResults([]);
    setStatusText(null);
    setActiveIndex(-1);
    setIsSearching(false);
    setIsOpen(false);
  };

  const handleOpenSearch = () => {
    setIsOpen(false);
    onOpenSearch?.();
  };

  const isAnimus = variant === "animus";
  const hostClassName = isAnimus ? "toolbarSearchHost toolbarSearchHostAnimus" : "toolbarSearchHost";
  const fieldClassName = isAnimus ? "animusTopSearch" : "toolbarSearchField";
  const iconClassName = isAnimus ? "animusTopSearchIcon" : "toolbarSearchIcon";
  const inputClassName = isAnimus ? "animusTopSearchInput" : "searchInput toolbarSearchInput";

  return (
    <div className={hostClassName} ref={hostRef}>
      <form className={isAnimus ? undefined : "toolbarSearchForm"} onSubmit={handleSubmit}>
        <div className={`${fieldClassName}${isOpen ? " is-open" : ""}`}>
          <span className={iconClassName} aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
          </span>
          <input
            type="search"
            className={inputClassName}
            aria-label="Search approved torrents"
            placeholder="Search torrents…"
            value={query}
            maxLength={SEARCH_QUERY_MAX_LEN}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={() => {
              if (results.length > 0 || statusText) {
                setIsOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsOpen(false);
                setActiveIndex(-1);
                return;
              }
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                setIsOpen(true);
                setActiveIndex((current) => Math.min(current + 1, results.length - 1));
                return;
              }
              if (event.key === "ArrowUp" && results.length > 0) {
                event.preventDefault();
                setActiveIndex((current) => Math.max(current - 1, 0));
                return;
              }
              if (event.key === "Enter" && isOpen && activeIndex >= 0) {
                event.preventDefault();
                const activeResult = results[activeIndex];
                if (activeResult && (activeResult.magnet_uri || activeResult.torrent_url)) {
                  void handleAdd(activeResult);
                }
              }
            }}
            disabled={!online}
            role="combobox"
            aria-expanded={isOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
          />
          {isAnimus && query ? (
            <button
              type="button"
              className="animusTopSearchClear"
              aria-label="Clear search"
              title="Clear search"
              onClick={(event) => {
                event.preventDefault();
                handleClear();
              }}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m6 6 8 8M14 6l-8 8" />
              </svg>
            </button>
          ) : null}
          {isAnimus ? <span className="animusTopSearchHint">Enter</span> : null}
        </div>
      </form>

      {isOpen ? (
        <div className="toolbarSearchDropdown" id={listboxId} role="listbox" aria-label="Search results">
          <div className="toolbarSearchDropdownHeader">
            {isAnimus ? (
              <>
                <div className="toolbarSearchDropdownHeading">
                  <span className="toolbarSearchDropdownEyebrow">Quick search</span>
                  <span className="toolbarSearchDropdownTitle">
                    {isSearching ? "Searching…" : (statusText ?? "Results")}
                  </span>
                </div>
                <div className="toolbarSearchDropdownHeaderActions">
                  {onOpenSearch ? (
                    <button type="button" className="toolbarSearchDropdownOpenPage" onClick={handleOpenSearch}>
                      Full search
                      <span aria-hidden="true">→</span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="toolbarSearchDropdownClose"
                    aria-label="Close search results"
                    onClick={() => setIsOpen(false)}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m6 6 8 8M14 6l-8 8" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <>
                <span className="toolbarSearchDropdownTitle">
                  {isSearching ? "Searching…" : (statusText ?? "Results")}
                </span>
                <button type="button" className="toolbarSearchDropdownClose" onClick={() => setIsOpen(false)}>
                  Close
                </button>
              </>
            )}
          </div>

          {isSearching ? (
            isAnimus ? (
              <div className="toolbarSearchDropdownState toolbarSearchDropdownLoading">
                <span className="toolbarSearchSpinner" aria-hidden="true" />
                <span>
                  <strong>Scanning the network</strong>
                  Looking across {enabledProviderCount} approved provider{enabledProviderCount === 1 ? "" : "s"}…
                </span>
              </div>
            ) : (
              <div className="toolbarSearchDropdownState">Looking across approved providers…</div>
            )
          ) : results.length === 0 ? (
            <div className="toolbarSearchDropdownState">{statusText ?? "No results"}</div>
          ) : (
            <ul className="toolbarSearchDropdownList">
              {results.map((result, index) => {
                const canAdd = Boolean(result.magnet_uri || result.torrent_url);
                const sourceLabel = providerLabelMap.get(result.source) ?? result.source;
                return (
                  <li
                    key={result.id}
                    id={`${listboxId}-option-${index}`}
                    className={`toolbarSearchDropdownItem ${activeIndex === index ? "is-active" : ""}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <div className="toolbarSearchDropdownItemMain">
                      <div className="toolbarSearchDropdownItemName">{result.name}</div>
                      <div className="toolbarSearchDropdownItemMeta">
                        <span className={isAnimus ? "toolbarSearchDropdownSource" : undefined}>{sourceLabel}</span>
                        {typeof result.size_bytes === "number" ? <span>{fmtBytes(result.size_bytes)}</span> : null}
                        {isAnimus ? (
                          <span className="toolbarSearchDropdownSeeders">
                            <span aria-hidden="true">↑</span> {formatMetric(result.seeders)} seeders
                          </span>
                        ) : (
                          <span>{formatMetric(result.seeders)} seeders</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn primary compact toolbarSearchDropdownAdd"
                      onClick={() => void handleAdd(result)}
                      disabled={!canAdd || addingId === result.id}
                    >
                      {addingId === result.id ? "Adding…" : isAnimus ? "Add +" : "Add"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {isAnimus && results.length > 0 ? (
            <div className="toolbarSearchDropdownFooter">
              <span>Use ↑ ↓ to select</span>
              <button type="button" onClick={handleOpenSearch} disabled={!onOpenSearch}>
                Refine results on Search
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
