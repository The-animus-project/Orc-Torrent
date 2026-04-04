/**
 * Custom hook for handling async operations with loading states and error handling
 * Reduces code duplication across components
 */

import { useState, useCallback } from "react";
import { logger } from "./logger";
import { getErrorMessage } from "./errorHandling";

export interface UseAsyncOperationOptions<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
  logPrefix?: string;
}

export interface UseAsyncOperationReturn<T> {
  execute: (operation: () => Promise<T>) => Promise<T | undefined>;
  loading: boolean;
  error: Error | null;
  reset: () => void;
}

/**
 * Hook for managing async operations with loading and error states
 * 
 * @example
 * const { execute, loading, error } = useAsyncOperation({
 *   onSuccess: (result) => pushToast("info", "Operation succeeded"),
 *   onError: (error) => pushToast("error", error.message),
 *   logPrefix: "TorrentOperation"
 * });
 * 
 * await execute(() => postJson(`/torrents/${id}/start`, {}));
 */
export function useAsyncOperation<T>(
  options: UseAsyncOperationOptions<T> = {}
): UseAsyncOperationReturn<T> {
  const { onSuccess, onError, logPrefix } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (operation: () => Promise<T>): Promise<T | undefined> => {
      setLoading(true);
      setError(null);

      try {
        const result = await operation();
        onSuccess?.(result);
        if (logPrefix) {
          logger.logWithPrefix(logPrefix, "Operation succeeded");
        }
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        onError?.(err);
        if (logPrefix) {
          logger.errorWithPrefix(logPrefix, "Operation failed:", err);
        } else {
          logger.error("Async operation failed:", err);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError, logPrefix]
  );

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { execute, loading, error, reset };
}

/**
 * Hook for managing multiple async operations with a single loading state
 * Useful for bulk operations
 */
export function useBulkAsyncOperation<T>(
  options: UseAsyncOperationOptions<T[]> = {}
): {
  execute: (operations: Array<() => Promise<T>>) => Promise<T[]>;
  loading: boolean;
  error: Error | null;
  reset: () => void;
} {
  const { onSuccess, onError, logPrefix } = options;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (operations: Array<() => Promise<T>>): Promise<T[]> => {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all(operations.map((op) => op()));
        onSuccess?.(results);
        if (logPrefix) {
          logger.logWithPrefix(logPrefix, `Completed ${results.length} operations`);
        }
        return results;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        setError(err);
        onError?.(err);
        if (logPrefix) {
          logger.errorWithPrefix(logPrefix, "Bulk operation failed:", err);
        } else {
          logger.error("Bulk async operation failed:", err);
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError, logPrefix]
  );

  const reset = useCallback(() => {
    setError(null);
    setLoading(false);
  }, []);

  return { execute, loading, error, reset };
}
