import { describe, expect, it } from "vitest";
import {
  PRIVATE_ENDPOINT_WARNING,
  createEmptyTorznabProvider,
  isTorznabFormat,
  providerConnectionLabel,
  shouldSendApiKey,
  validateProviderName,
  validateTorznabCategories,
  validateTorznabEndpoint,
  validateTorznabTimeout,
} from "./torznabSettings";

describe("torznabSettings", () => {
  it("validates provider names", () => {
    expect(validateProviderName("local_jackett")).toBeNull();
    expect(validateProviderName("Local Jackett")).not.toBeNull();
    expect(validateProviderName("")).not.toBeNull();
  });

  it("validates Torznab endpoints", () => {
    expect(validateTorznabEndpoint("http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/")).toBeNull();
    expect(validateTorznabEndpoint("https://user:pass@example.com/torznab")).not.toBeNull();
    expect(validateTorznabEndpoint("ftp://example.com/torznab")).not.toBeNull();
  });

  it("validates timeouts and categories", () => {
    expect(validateTorznabTimeout("10")).toBeNull();
    expect(validateTorznabTimeout("1")).not.toBeNull();
    expect(validateTorznabCategories(["2000", "5000"])).toBeNull();
    expect(validateTorznabCategories(["movies"])).not.toBeNull();
  });

  it("masks saved credential state and avoids overwriting keys", () => {
    expect(shouldSendApiKey("", true)).toBe(false);
    expect(shouldSendApiKey("new-secret", true)).toBe(true);
    expect(shouldSendApiKey("new-secret", false)).toBe(true);
  });

  it("shows private endpoint warning copy", () => {
    expect(PRIVATE_ENDPOINT_WARNING).toContain("Jackett");
    expect(PRIVATE_ENDPOINT_WARNING).toContain("Prowlarr");
  });

  it("reports connection labels", () => {
    expect(
      providerConnectionLabel({
        enabled: false,
        hasCredentials: true,
      })
    ).toBe("Disabled");
    expect(
      providerConnectionLabel({
        enabled: true,
        hasCredentials: false,
      })
    ).toBe("Missing API key");
    expect(
      providerConnectionLabel({
        enabled: true,
        hasCredentials: true,
        connectionStatus: "connected",
      })
    ).toBe("Connected");
    expect(
      providerConnectionLabel({
        enabled: true,
        hasCredentials: true,
        timedOut: true,
      })
    ).toBe("Timed out");
    expect(
      providerConnectionLabel({
        enabled: true,
        hasCredentials: true,
      })
    ).toBe("Not tested");
  });

  it("creates disabled Torznab providers by default", () => {
    const provider = createEmptyTorznabProvider("torznab_1");
    expect(provider.enabled).toBe(false);
    expect(isTorznabFormat(provider.format)).toBe(true);
    expect(provider.allow_private_url).toBe(false);
  });
});
