import type { SearchFeatureSettings, SearchProviderInfo, SearchResult } from "../types";

export const ALL_PROVIDERS_SOURCE = "all";
export const SEARCH_QUERY_MIN_LEN = 2;
export const SEARCH_QUERY_MAX_LEN = 200;
export const SEARCH_RESULT_LIMIT_MAX = 100;

const MEDIA_PROVIDER_PRIORITY: Record<string, number> = {
  yts: 0,
  tpb_movies: 1,
  tpb_tv: 1,
  x1337_movies: 2,
  x1337_tv: 2,
};

export function mediaProviderPriority(name: string): number {
  return MEDIA_PROVIDER_PRIORITY[name] ?? 50;
}

export function sortProvidersByPriority<T extends { name: string; label: string }>(providers: T[]): T[] {
  return [...providers].sort((left, right) => {
    const priority = mediaProviderPriority(left.name) - mediaProviderPriority(right.name);
    if (priority !== 0) {
      return priority;
    }
    return left.label.localeCompare(right.label);
  });
}

export type SearchSortMode = "best" | "seeders" | "newest" | "size" | "name";

export function buildSearchSettingsKey(settings: SearchFeatureSettings | null): string | null {
  if (!settings) {
    return null;
  }

  return JSON.stringify({
    enabled: settings.enabled,
    default_provider: settings.default_provider,
    default_result_limit: settings.default_result_limit,
    providers: settings.providers.map((provider) => ({
      name: provider.name,
      enabled: provider.enabled,
      label: provider.label,
    })),
  });
}

export function searchSettingsEqual(
  left: SearchFeatureSettings | null,
  right: SearchFeatureSettings | null
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return buildSearchSettingsKey(left) === buildSearchSettingsKey(right);
}

export function normalizeSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
}

export function resolveProviderSelection(
  current: string,
  enabledProviders: SearchProviderInfo[],
  defaultProvider?: string | null
): string {
  if (current === ALL_PROVIDERS_SOURCE && enabledProviders.length > 1) {
    return ALL_PROVIDERS_SOURCE;
  }

  if (enabledProviders.some((provider) => provider.name === current)) {
    return current;
  }

  if (enabledProviders.length > 1) {
    return ALL_PROVIDERS_SOURCE;
  }

  const preferred = enabledProviders.find((provider) => provider.name === defaultProvider);
  return preferred?.name ?? enabledProviders[0]?.name ?? ALL_PROVIDERS_SOURCE;
}

function compareNumberDesc(left?: number | null, right?: number | null): number {
  const safeLeft = typeof left === "number" ? left : -1;
  const safeRight = typeof right === "number" ? right : -1;
  return safeRight - safeLeft;
}

function compareStringDesc(left?: string | null, right?: string | null): number {
  return String(right ?? "").localeCompare(String(left ?? ""));
}

export function sortSearchResults(results: SearchResult[], sortMode: SearchSortMode): SearchResult[] {
  const next = [...results];
  next.sort((left, right) => {
    switch (sortMode) {
      case "seeders":
        return (
          compareNumberDesc(left.seeders, right.seeders) ||
          compareNumberDesc(left.leechers, right.leechers) ||
          left.name.localeCompare(right.name)
        );
      case "newest":
        return (
          compareStringDesc(left.published_at, right.published_at) ||
          compareNumberDesc(left.seeders, right.seeders) ||
          left.name.localeCompare(right.name)
        );
      case "size":
        return (
          compareNumberDesc(left.size_bytes, right.size_bytes) ||
          compareNumberDesc(left.seeders, right.seeders) ||
          left.name.localeCompare(right.name)
        );
      case "name":
        return left.name.localeCompare(right.name);
      case "best":
      default:
        return (
          mediaProviderPriority(left.source) - mediaProviderPriority(right.source) ||
          compareNumberDesc(left.seeders, right.seeders) ||
          compareNumberDesc(left.leechers, right.leechers) ||
          compareStringDesc(left.published_at, right.published_at) ||
          compareNumberDesc(left.size_bytes, right.size_bytes) ||
          left.name.localeCompare(right.name)
        );
    }
  });
  return next;
}
