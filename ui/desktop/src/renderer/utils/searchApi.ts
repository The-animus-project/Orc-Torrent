import type {
  SearchFeatureSettings,
  SearchProviderInfo,
  SearchQueryRequest,
  SearchResponse,
  SearchResult,
  SearchSettingsPatchRequest,
} from "../types";
import { getJson, patchJson, postJson } from "./api";
import { addMagnetToDaemon, importTorrentUrlToDaemon, type ImportedTorrentResult } from "./torrentImport";

export async function getSearchSettings(): Promise<SearchFeatureSettings> {
  return getJson<SearchFeatureSettings>("/search/settings");
}

export async function updateSearchSettings(patch: SearchSettingsPatchRequest): Promise<SearchFeatureSettings> {
  return patchJson<SearchFeatureSettings>("/search/settings", patch);
}

export async function getSearchProviders(): Promise<SearchProviderInfo[]> {
  return getJson<SearchProviderInfo[]>("/search/providers");
}

export async function searchTorrents(query: SearchQueryRequest): Promise<SearchResponse> {
  return postJson<SearchResponse>("/search", query, 30000);
}

export async function addSearchResult(result: SearchResult): Promise<ImportedTorrentResult> {
  if (result.magnet_uri) {
    return addMagnetToDaemon(result.magnet_uri, undefined, result.name);
  }
  if (result.torrent_url) {
    return importTorrentUrlToDaemon(result.torrent_url, undefined, result.name);
  }
  throw new Error("This result does not include a magnet URI or torrent URL");
}
