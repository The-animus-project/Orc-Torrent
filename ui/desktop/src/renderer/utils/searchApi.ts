import type {
  SearchCredentialResponse,
  SearchFeatureSettings,
  SearchProviderInfo,
  SearchQueryRequest,
  SearchResponse,
  SearchResult,
  SearchSettingsPatchRequest,
  TorznabCapsTestResult,
} from "../types";
import { deleteJson, getJson, patchJson, postJson, putJson } from "./api";
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

export async function putSearchProviderCredentials(
  name: string,
  apiKey: string
): Promise<SearchCredentialResponse> {
  return putJson<SearchCredentialResponse>(`/search/providers/${encodeURIComponent(name)}/credentials`, {
    api_key: apiKey,
  });
}

export async function deleteSearchProviderCredentials(name: string): Promise<SearchCredentialResponse> {
  return deleteJson<SearchCredentialResponse>(`/search/providers/${encodeURIComponent(name)}/credentials`);
}

export async function testSearchProvider(name: string): Promise<TorznabCapsTestResult> {
  return postJson<TorznabCapsTestResult>(`/search/providers/${encodeURIComponent(name)}/test`, undefined, 30000);
}

export async function deleteSearchProvider(name: string): Promise<SearchProviderInfo[]> {
  return deleteJson<SearchProviderInfo[]>(`/search/providers/${encodeURIComponent(name)}`);
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
