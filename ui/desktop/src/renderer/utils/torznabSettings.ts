import type { SearchProviderFormat, SearchProviderSetting } from "../types";

export const PRIVATE_ENDPOINT_WARNING = "Enable this only for a Jackett, Prowlarr or Torznab service you control.";

export const TORZNAB_TIMEOUT_MIN = 2;
export const TORZNAB_TIMEOUT_MAX = 60;
export const TORZNAB_TIMEOUT_DEFAULT = 10;

const PROVIDER_NAME_PATTERN = /^[a-z0-9_-]+$/;

export function isTorznabFormat(format: SearchProviderFormat | null | undefined): boolean {
  return format === "torznab";
}

export function nextTorznabProviderName(providers: SearchProviderSetting[]): string {
  let index = 1;
  while (providers.some((provider) => provider.name === `torznab_${index}`)) {
    index += 1;
  }
  return `torznab_${index}`;
}

export function validateProviderName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) {
    return "Provider name cannot be empty";
  }
  if (trimmed.length > 32) {
    return "Provider name cannot exceed 32 characters";
  }
  if (!PROVIDER_NAME_PATTERN.test(trimmed)) {
    return "Provider name may only contain lowercase letters, numbers, underscores, and dashes";
  }
  return null;
}

export function validateTorznabEndpoint(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return "Torznab endpoint URL is required";
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Endpoint URL must use http or https";
    }
    if (parsed.username || parsed.password) {
      return "URLs containing embedded credentials are not allowed";
    }
  } catch {
    return "Endpoint URL is not valid";
  }
  return null;
}

export function validateTorznabTimeout(value: string): string | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < TORZNAB_TIMEOUT_MIN || parsed > TORZNAB_TIMEOUT_MAX) {
    return `Timeout must be between ${TORZNAB_TIMEOUT_MIN} and ${TORZNAB_TIMEOUT_MAX} seconds`;
  }
  return null;
}

export function parseTorznabCategories(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value.toLowerCase() !== "all");
}

export function validateTorznabCategories(categories: string[]): string | null {
  for (const category of categories) {
    if (!/^\d+$/.test(category)) {
      return "Torznab categories must be numeric category IDs";
    }
  }
  return null;
}

export function providerConnectionLabel(options: {
  enabled: boolean;
  hasCredentials: boolean;
  connectionStatus?: string | null;
  lastError?: string | null;
  timedOut?: boolean;
}): string {
  if (!options.enabled) {
    return "Disabled";
  }
  if (!options.hasCredentials) {
    return "Missing API key";
  }
  if (options.timedOut || options.lastError?.toLowerCase().includes("timed out")) {
    return "Timed out";
  }
  if (options.connectionStatus?.startsWith("connected")) {
    return "Connected";
  }
  if (options.connectionStatus === "failed" || options.lastError) {
    return "Connection failed";
  }
  return "Not tested";
}

export function shouldSendApiKey(apiKeyInput: string, hasSavedCredentials: boolean): boolean {
  const trimmed = apiKeyInput.trim();
  if (!trimmed) {
    return false;
  }
  // Never re-send a masked placeholder; only send when the user typed a new key.
  if (hasSavedCredentials && trimmed === "") {
    return false;
  }
  return true;
}

export function createEmptyTorznabProvider(name: string): SearchProviderSetting {
  return {
    name,
    enabled: false,
    label: "My Torznab provider",
    feed_url: "",
    format: "torznab",
    categories: [],
    allow_private_url: false,
    timeout_seconds: TORZNAB_TIMEOUT_DEFAULT,
  };
}
