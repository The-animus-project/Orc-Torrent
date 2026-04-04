// Torrent metadata and file list cache with intelligent invalidation

import type { TorrentStatus } from "../types";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string;
}

export interface TorrentContent {
  files: Array<{
    path: string[];
    size: number;
    priority: string;
    downloaded: boolean;
  }>;
}

class TorrentCache {
  private contentCache = new Map<string, CacheEntry<TorrentContent>>();
  private statusCache = new Map<string, CacheEntry<TorrentStatus>>();
  private pendingRequests = new Map<string, Promise<any>>();
  
  // Cache TTLs (time to live) - optimized for performance
  private readonly CONTENT_TTL = 60000; // 60 seconds for file lists (rarely changes during download)
  private readonly STATUS_TTL = 2500;   // 2.5 seconds for status (balanced between responsiveness and performance)
  
  // Maximum cache size
  private readonly MAX_CACHE_SIZE = 200; // Increased for larger torrent lists

  /**
   * Get cached data or null if expired/missing
   */
  private getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, ttl: number): T | null {
    const entry = cache.get(key);
    if (!entry) return null;
    
    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Set cached data with timestamp
   */
  private setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, data: T, etag?: string): void {
    // Evict oldest entries if cache is too large
    if (cache.size >= this.MAX_CACHE_SIZE) {
      const oldestKey = Array.from(cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
      if (oldestKey) {
        cache.delete(oldestKey);
      }
    }
    
    cache.set(key, {
      data,
      timestamp: Date.now(),
      etag,
    });
  }

  /**
   * Get torrent content (file list) with caching
   */
  async getContent(
    torrentId: string,
    fetcher: () => Promise<TorrentContent>,
    forceRefresh = false
  ): Promise<TorrentContent> {
    const cacheKey = `content:${torrentId}`;
    
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.getCached(this.contentCache, cacheKey, this.CONTENT_TTL);
      if (cached) {
        return cached;
      }
    }
    
    // Check if request is already in flight
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }
    
    // Start new request
    const request = fetcher()
      .then((data) => {
        this.setCached(this.contentCache, cacheKey, data);
        this.pendingRequests.delete(cacheKey);
        return data;
      })
      .catch((error) => {
        this.pendingRequests.delete(cacheKey);
        throw error;
      });
    
    this.pendingRequests.set(cacheKey, request);
    return request;
  }

  /**
   * Get torrent status with caching and state stabilization
   */
  async getStatus(
    torrentId: string,
    fetcher: () => Promise<TorrentStatus>,
    forceRefresh = false
  ): Promise<TorrentStatus> {
    const cacheKey = `status:${torrentId}`;
    
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = this.getCached(this.statusCache, cacheKey, this.STATUS_TTL);
      if (cached) {
        return cached;
      }
    }
    
    // Check if request is already in flight
    const pending = this.pendingRequests.get(cacheKey);
    if (pending) {
      return pending;
    }
    
    // Start new request
    const request = fetcher()
      .then((data) => {
        // Stabilize state transitions - don't immediately show error if we had a valid downloading state
        const cached = this.statusCache.get(cacheKey);
        if (cached && data.state === "error") {
          const cachedState = cached.data.state;
          // If we were downloading/seeding and got an error, check if it's transient
          // Keep the previous state for a short time to prevent flickering
          const cacheAge = Date.now() - cached.timestamp;
          if ((cachedState === "downloading" || cachedState === "seeding") && 
              cacheAge < 3000) { // Within last 3 seconds
            // Return cached state instead of error to prevent flickering
            // The next fetch will show the error if it persists
            return cached.data;
          }
        }
        
        this.setCached(this.statusCache, cacheKey, data);
        this.pendingRequests.delete(cacheKey);
        return data;
      })
      .catch((error) => {
        this.pendingRequests.delete(cacheKey);
        // If we have a cached status, return it instead of throwing
        // This prevents flickering when network requests fail
        const cached = this.statusCache.get(cacheKey);
        if (cached) {
          const age = Date.now() - cached.timestamp;
          // Only use cached status if it's recent (within 5 seconds)
          if (age < 5000) {
            return cached.data;
          }
        }
        throw error;
      });
    
    this.pendingRequests.set(cacheKey, request);
    return request;
  }

  /**
   * Invalidate cache for a specific torrent
   */
  invalidate(torrentId: string): void {
    this.contentCache.delete(`content:${torrentId}`);
    this.statusCache.delete(`status:${torrentId}`);
  }

  /**
   * Invalidate all caches
   */
  clear(): void {
    this.contentCache.clear();
    this.statusCache.clear();
    this.pendingRequests.clear();
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats() {
    return {
      contentEntries: this.contentCache.size,
      statusEntries: this.statusCache.size,
      pendingRequests: this.pendingRequests.size,
    };
  }
}

// Singleton instance
export const torrentCache = new TorrentCache();
