// API utilities for daemon communication with request deduplication

import { logger } from "./logger";
import type { ApiError } from "./errorHandling";

const DAEMON_BASE = "http://127.0.0.1:8733";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// Request deduplication - prevents duplicate concurrent requests to the same endpoint
// This reduces network overhead and improves download performance
const inflightRequests = new Map<string, Promise<unknown>>();

function getRequestKey(method: string, path: string, body?: unknown): string {
  const bodyHash = body ? JSON.stringify(body) : "";
  return `${method}:${path}:${bodyHash}`;
}

function createApiError(message: string, status?: number, statusText?: string, isNetworkError = false): ApiError {
  const error = new Error(message) as ApiError;
  error.status = status;
  error.statusText = statusText;
  error.isNetworkError = isNetworkError;
  return error;
}

function isRetryableError(error: unknown): boolean {
  // Don't retry abort errors (they're handled separately)
  if (error instanceof DOMException && error.name === "AbortError") {
    return false;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"))) {
    return false;
  }
  
  // Retry network errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return true;
  }
  
  // Retry on 5xx errors and network issues
  if (error instanceof Error && "status" in error) {
    const apiError = error as ApiError;
    return apiError.status === undefined || (apiError.status >= 500 && apiError.status < 600);
  }
  
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Connection state tracking for self-healing
let connectionState: "connected" | "disconnected" | "reconnecting" = "disconnected";
let lastConnectionAttempt = 0;
const CONNECTION_RETRY_DELAY_MS = 1000;
const MAX_CONNECTION_RETRIES = 5;

async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retries = MAX_RETRIES,
  customTimeout?: number
): Promise<Response> {
  const controller = new AbortController();
  // Use custom timeout if provided, otherwise use default based on request type
  // POST requests (especially file uploads) need longer timeouts
  const isPostRequest = options.method === "POST";
  const defaultTimeout = isPostRequest ? 30000 : 10000; // 30s for POST, 10s for GET
  const TIMEOUT_MS = customTimeout ?? defaultTimeout;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let wasAborted = false;
  
  // Set up timeout
  timeoutId = setTimeout(() => {
    wasAborted = true;
    controller.abort();
  }, TIMEOUT_MS);
  
  try {
    // Update connection state
    if (connectionState === "disconnected") {
      connectionState = "reconnecting";
      lastConnectionAttempt = Date.now();
    }
    
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    
    // Clear timeout if request succeeded
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Update connection state on success
    if (connectionState !== "connected") {
      connectionState = "connected";
      logger.logWithPrefix("API", "Connection restored to daemon");
    }
    
    return response;
  } catch (error) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    
    // Check if this was an abort error (timeout or manual abort)
    const isAbortError = 
      error instanceof DOMException && error.name === "AbortError" ||
      error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted"));
    
    if (isAbortError) {
      // If it was our timeout, provide a clear message
      if (wasAborted) {
        const timeoutSeconds = Math.round(TIMEOUT_MS / 1000);
        const timeoutError = createApiError(
          `Request timed out after ${timeoutSeconds} seconds. The daemon may be slow to respond or processing a large file. Check daemon logs for details.`,
          undefined,
          undefined,
          true
        );
        
        // Retry if we have retries left
        if (retries > 0) {
          await sleep(RETRY_DELAY_MS);
          return fetchWithRetry(url, options, retries - 1, customTimeout);
        }
        
        // Mark as disconnected after all retries exhausted
        connectionState = "disconnected";
        throw timeoutError;
      } else {
        // Manual abort (not our timeout)
        throw createApiError(
          "Request was cancelled",
          undefined,
          undefined,
          true
        );
      }
    }
    
    // Check if it's a network error (retryable)
    if (retries > 0 && isRetryableError(error)) {
      // Update connection state
      if (connectionState === "connected") {
        connectionState = "reconnecting";
        logger.warn("[API] Connection lost, attempting to reconnect...");
      }
      
      await sleep(RETRY_DELAY_MS);
      return fetchWithRetry(url, options, retries - 1, customTimeout);
    }
    
    // For other network errors, provide helpful message
    if (error instanceof TypeError && error.message.includes("fetch")) {
      // Mark as disconnected
      connectionState = "disconnected";
      throw createApiError(
        "Connection failed. Is the daemon running?",
        undefined,
        undefined,
        true
      );
    }
    
    // Mark as disconnected on other errors
    if (retries === 0) {
      connectionState = "disconnected";
    }
    
    // Re-throw other errors as-is
    throw error;
  }
}

/**
 * Perform a GET request to the daemon API and parse JSON response
 * Uses request deduplication to prevent duplicate concurrent requests
 * @param path - API endpoint path (e.g., "/torrents")
 * @returns Parsed JSON response
 * @throws ApiError if request fails or times out
 */
export async function getJson<T>(path: string): Promise<T> {
  const requestKey = getRequestKey("GET", path);
  
  // Check if an identical request is already in flight
  const existingRequest = inflightRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest as Promise<T>;
  }
  
  // Create new request with deduplication tracking
  const request = (async (): Promise<T> => {
    try {
      const r = await fetchWithRetry(`${DAEMON_BASE}${path}`);
      if (!r.ok) {
        const errorText = await r.text().catch(() => r.statusText);
        throw createApiError(
          `Request failed: ${errorText || r.statusText}`,
          r.status,
          r.statusText
        );
      }
      return await r.json();
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        throw error;
      }
      throw createApiError(
        error instanceof Error ? error.message : "Unknown error occurred",
        undefined,
        undefined,
        true
      );
    } finally {
      // Remove from inflight tracking when complete
      inflightRequests.delete(requestKey);
    }
  })();
  
  // Track this request to prevent duplicates
  inflightRequests.set(requestKey, request);
  return request;
}

/**
 * Perform a POST request to the daemon API with optional JSON body
 * @param path - API endpoint path
 * @param body - Optional request body (will be JSON-stringified)
 * @param timeoutMs - Optional custom timeout in milliseconds (default: 30s for POST requests)
 * @returns Parsed JSON response
 * @throws ApiError if request fails or times out
 */
export async function postJson<T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> {
  try {
    // For add_torrent endpoint, use longer timeout for large file uploads
    const isAddTorrent = path === "/torrents";
    const uploadTimeout = timeoutMs ?? (isAddTorrent ? 60000 : 30000); // 60s for add_torrent, 30s for other POST
    
    const r = await fetchWithRetry(`${DAEMON_BASE}${path}`, {
      method: "POST",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }, MAX_RETRIES, uploadTimeout);
    if (!r.ok) {
      const errorText = await r.text().catch(() => r.statusText);
      throw createApiError(
        `Request failed: ${errorText || r.statusText}`,
        r.status,
        r.statusText
      );
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {} as T;
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      throw error;
    }
    throw createApiError(
      error instanceof Error ? error.message : "Unknown error occurred",
      undefined,
      undefined,
      true
    );
  }
}

/**
 * Perform a PATCH request to the daemon API with JSON body
 * @param path - API endpoint path
 * @param body - Request body (will be JSON-stringified)
 * @returns Parsed JSON response (may be empty object if no response body)
 * @throws ApiError if request fails or times out
 */
export async function patchJson<T>(path: string, body: unknown): Promise<T> {
  try {
    const r = await fetchWithRetry(`${DAEMON_BASE}${path}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errorText = await r.text().catch(() => r.statusText);
      throw createApiError(
        `Request failed: ${errorText || r.statusText}`,
        r.status,
        r.statusText
      );
    }
    // Handle responses with no body (e.g., file-priority returns StatusCode::OK with no JSON)
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {} as T;
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      throw error;
    }
    throw createApiError(
      error instanceof Error ? error.message : "Unknown error occurred",
      undefined,
      undefined,
      true
    );
  }
}

/**
 * Perform a DELETE request to the daemon API
 * @param path - API endpoint path
 * @returns Parsed JSON response (may be empty object if no response body)
 * @throws ApiError if request fails or times out
 */
export async function deleteJson<T>(path: string): Promise<T> {
  try {
    const r = await fetchWithRetry(`${DAEMON_BASE}${path}`, {
      method: "DELETE",
    });
    if (!r.ok) {
      const errorText = await r.text().catch(() => r.statusText);
      throw createApiError(
        `Request failed: ${errorText || r.statusText}`,
        r.status,
        r.statusText
      );
    }
    const txt = await r.text();
    return txt ? JSON.parse(txt) : {} as T;
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      throw error;
    }
    throw createApiError(
      error instanceof Error ? error.message : "Unknown error occurred",
      undefined,
      undefined,
      true
    );
  }
}
