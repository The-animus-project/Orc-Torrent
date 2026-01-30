// Enhanced torrent metadata fetching with retry, batching, and error handling

import { getJson } from "./api";
import { torrentCache } from "./torrentCache";
import { logger } from "./logger";
import { isApiError } from "./errorHandling";
import type { Torrent, TorrentStatus, TorrentRowSnapshot } from "../types";

export interface TorrentContent {
  files: Array<{
    path: string[];
    size: number;
    priority: string;
    downloaded: boolean;
  }>;
}

interface FetchOptions {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
  forceRefresh?: boolean;
}

const DEFAULT_OPTIONS: Required<FetchOptions> = {
  retries: 3,
  retryDelay: 500,
  timeout: 10000,
  forceRefresh: false,
};

/**
 * Fetch torrent list with error handling
 */
export async function fetchTorrents(options: FetchOptions = {}): Promise<Torrent[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      const response = await getJson<{ items: Torrent[] }>("/torrents");
      return response.items ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on 4xx errors (client errors)
      if (isApiError(error)) {
        if (error.status !== undefined && error.status >= 400 && error.status < 500) {
          throw error;
        }
      }
      
      // Don't retry on abort errors (timeout) - they're already handled by fetchWithRetry
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timed out"))) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < opts.retries) {
        const delay = opts.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error("Failed to fetch torrents");
}

/**
 * Fetch torrent status with caching and retry
 */
export async function fetchTorrentStatus(
  torrentId: string,
  options: FetchOptions = {}
): Promise<TorrentStatus> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return torrentCache.getStatus(
    torrentId,
    async () => {
      let lastError: Error | null = null;
      
      for (let attempt = 0; attempt <= opts.retries; attempt++) {
        try {
          return await getJson<TorrentStatus>(`/torrents/${torrentId}/status`);
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // Don't retry on 4xx errors
          if (isApiError(error)) {
            if (error.status !== undefined && error.status >= 400 && error.status < 500) {
              throw error;
            }
          }
          
          // Don't retry on abort errors (timeout) - they're already handled by fetchWithRetry
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timed out"))) {
            throw error;
          }
          
          // Wait before retry
          if (attempt < opts.retries) {
            const delay = opts.retryDelay * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      throw lastError || new Error(`Failed to fetch status for torrent ${torrentId}`);
    },
    opts.forceRefresh
  );
}

/**
 * Fetch multiple torrent statuses in parallel with batching
 */
export async function fetchTorrentStatuses(
  torrentIds: string[],
  options: FetchOptions = {}
): Promise<Map<string, TorrentStatus>> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Batch requests - increased batch size for better throughput
  // The daemon handles concurrent requests well, so larger batches improve performance
  const BATCH_SIZE = 25;
  const results = new Map<string, TorrentStatus>();
  
  for (let i = 0; i < torrentIds.length; i += BATCH_SIZE) {
    const batch = torrentIds.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (id) => {
      try {
        const status = await fetchTorrentStatus(id, opts);
        return [id, status] as [string, TorrentStatus];
      } catch (error) {
        // Don't log warnings for transient errors - they're expected during normal operation
        // Only log if it's a persistent error (4xx or network issue)
        if (isApiError(error)) {
          if (error.status !== undefined && error.status >= 400 && error.status < 500) {
            logger.warn(`Failed to fetch status for torrent ${id}:`, error.message);
          }
        }
        return null;
      }
    });
    
    const batchResults = await Promise.all(batchPromises);
    batchResults.forEach((result) => {
      if (result) {
        results.set(result[0], result[1]);
      }
    });
    
    // Minimal delay between batches - just enough to prevent connection flooding
    if (i + BATCH_SIZE < torrentIds.length) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  
  return results;
}

/**
 * Fetch torrent row snapshot (pieces bins + heartbeat samples) for dual-signal UI component
 */
export async function fetchRowSnapshot(
  torrentId: string,
  options: FetchOptions = {}
): Promise<TorrentRowSnapshot> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await getJson<TorrentRowSnapshot>(`/torrents/${torrentId}/row-snapshot`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on 4xx errors
      if (isApiError(error)) {
        if (error.status !== undefined && error.status >= 400 && error.status < 500) {
          throw error;
        }
      }
      
      // Wait before retry
      if (attempt < opts.retries) {
        const delay = opts.retryDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch row snapshot for torrent ${torrentId}`);
}

/**
 * Fetch torrent content (file list) with caching and retry
 */
export async function fetchTorrentContent(
  torrentId: string,
  options: FetchOptions = {}
): Promise<TorrentContent> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return torrentCache.getContent(
    torrentId,
    async () => {
      let lastError: Error | null = null;
      let retryCount = 0;
      
      const maxRetries = opts.retries;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const content = await getJson<TorrentContent>(`/torrents/${torrentId}/content`);
          
          // If we got content with files, return it
          if (content.files && content.files.length > 0) {
            return content;
          }
          
          // If no files yet, return empty content
          // (This can happen for magnet links still fetching metadata)
          return content;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          
          // Don't retry on 4xx errors
          if (isApiError(error)) {
            if (error.status !== undefined && error.status >= 400 && error.status < 500) {
              throw error;
            }
          }
          
          // Don't retry on abort errors (timeout) - they're already handled by fetchWithRetry
          if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
          }
          if (error instanceof Error && (error.name === "AbortError" || error.message.includes("timed out"))) {
            throw error;
          }
          
          // Wait before retry
          if (attempt < maxRetries) {
            retryCount++;
            const delay = opts.retryDelay * Math.pow(2, retryCount);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      throw lastError || new Error(`Failed to fetch content for torrent ${torrentId}`);
    },
    opts.forceRefresh
  );
}

/**
 * Invalidate cache for a torrent (call after updates)
 */
export function invalidateTorrentCache(torrentId: string): void {
  torrentCache.invalidate(torrentId);
}

/**
 * Clear all torrent caches
 */
export function clearTorrentCache(): void {
  torrentCache.clear();
}
