/**
 * Country utility functions for converting ISO country codes to flags and names
 */

/**
 * Convert ISO 3166-1 alpha-2 country code to flag emoji
 * @param code - Two-letter country code (e.g., "US", "DE", "JP")
 * @returns Flag emoji (e.g., "🇺🇸", "🇩🇪", "🇯🇵")
 */
export function countryCodeToFlag(code: string): string {
  if (!code || code.length !== 2) {
    return "🌐"; // Globe emoji for unknown/invalid codes
  }

  // Convert ISO 3166-1 alpha-2 to Regional Indicator Symbols
  // Each letter is converted to its corresponding regional indicator symbol
  // A=🇦 (U+1F1E6), B=🇧 (U+1F1E7), ..., Z=🇿 (U+1F1FF)
  const codePoints = code
    .toUpperCase()
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));

  return String.fromCodePoint(...codePoints);
}

/**
 * Convert ISO 3166-1 alpha-2 country code to country name
 * @param code - Two-letter country code (e.g., "US", "DE", "JP")
 * @param locale - Locale for country name (default: "en")
 * @returns Country name (e.g., "United States", "Germany", "Japan")
 */
export function countryCodeToName(code: string, locale = "en"): string {
  if (!code || code.length !== 2) {
    return "Unknown";
  }

  try {
    // Use Intl.DisplayNames API (built into modern browsers)
    const regionNames = new Intl.DisplayNames([locale], { type: "region" });
    return regionNames.of(code.toUpperCase()) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Match private/local IPv4: 10.x, 172.16-31.x, 192.168.x, 127.x */
const PRIVATE_IPV4 =
  /^(10\.|192\.168\.|127\.)|^172\.(1[6-9]|2[0-9]|3[0-1])\./;

/**
 * Get flag emoji for special cases (private/local IPs)
 * @param ip - IP address string
 * @returns Special flag emoji or null
 */
export function getSpecialFlag(ip: string): string | null {
  if (PRIVATE_IPV4.test(ip)) return "🏠";
  if (
    ip === "::1" ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fc00:") ||
    ip.startsWith("fd00:")
  ) {
    return "🏠";
  }
  return null;
}

/**
 * Get display info for a peer's country
 * @param country - ISO country code or null
 * @param ip - IP address for special case detection
 * @returns Object with flag emoji, name, tooltip (name + code when known), and isSpecial
 */
export function getPeerCountryInfo(
  country: string | null | undefined,
  ip: string
): { flag: string; name: string; title: string; isSpecial: boolean } {
  const specialFlag = getSpecialFlag(ip);
  if (specialFlag) {
    return {
      flag: specialFlag,
      name: "Local Network",
      title: "Local Network",
      isSpecial: true,
    };
  }

  if (!country) {
    return {
      flag: "🌐",
      name: "Unknown",
      title: "Unknown",
      isSpecial: false,
    };
  }

  const name = countryCodeToName(country);
  const title = name !== country.toUpperCase() ? `${name} (${country.toUpperCase()})` : name;
  return {
    flag: countryCodeToFlag(country),
    name,
    title,
    isSpecial: false,
  };
}
