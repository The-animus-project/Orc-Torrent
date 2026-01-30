/**
 * Logger utility that gates console statements for production builds
 * Prevents console noise in production while maintaining debugging in development
 */

const isDevelopment = import.meta.env.DEV;

/**
 * Logger interface matching console API
 */
export const logger = {
  /**
   * Log informational messages (only in development)
   */
  log: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(...args);
    }
  },

  /**
   * Log warning messages (only in development)
   */
  warn: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.warn(...args);
    }
  },

  /**
   * Log error messages (always logged, even in production)
   * Errors are important for debugging production issues
   */
  error: (...args: unknown[]): void => {
    console.error(...args);
  },

  /**
   * Log debug messages (only in development)
   */
  debug: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.debug(...args);
    }
  },

  /**
   * Log info messages (only in development)
   */
  info: (...args: unknown[]): void => {
    if (isDevelopment) {
      console.info(...args);
    }
  },

  /**
   * Log with a prefix (only in development)
   * Useful for component-specific logging
   */
  logWithPrefix: (prefix: string, ...args: unknown[]): void => {
    if (isDevelopment) {
      console.log(`[${prefix}]`, ...args);
    }
  },

  /**
   * Log error with a prefix (always logged)
   */
  errorWithPrefix: (prefix: string, ...args: unknown[]): void => {
    console.error(`[${prefix}]`, ...args);
  },
};
