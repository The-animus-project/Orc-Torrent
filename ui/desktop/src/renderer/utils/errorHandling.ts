/**
 * Consistent error handling utilities across the UI
 */

/**
 * API Error interface for type-safe error handling
 */
export interface ApiError extends Error {
  status?: number;
  statusText?: string;
  isNetworkError?: boolean;
}

/**
 * Type guard to check if error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof Error && "status" in error;
}

/**
 * Extract error message from various error types consistently
 */
export function getErrorMessage(error: unknown, fallback = "An unknown error occurred"): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return fallback;
}

/**
 * Check if error is a network/connection error
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("timed out") ||
    message.includes("aborted") ||
    (isApiError(error) && error.isNetworkError === true)
  );
}

/**
 * Check if error is a client error (4xx) that shouldn't be retried
 */
export function isClientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  if (isApiError(error)) {
    return typeof error.status === "number" && error.status >= 400 && error.status < 500;
  }
  
  return false;
}

/**
 * Format error for user display (sanitized, helpful)
 */
export function formatErrorForUser(error: unknown, context?: string): string {
  const message = getErrorMessage(error);
  
  if (context) {
    return `${context}: ${message}`;
  }
  
  return message;
}
