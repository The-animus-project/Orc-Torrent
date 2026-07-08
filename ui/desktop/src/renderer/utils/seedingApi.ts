import { getJson, patchJson } from "../utils/api";
import type { SeedingSettings } from "../types";

export async function getSeedingSettings(): Promise<SeedingSettings> {
  return getJson<SeedingSettings>("/seeding");
}

export async function patchSeedingSettings(settings: SeedingSettings): Promise<SeedingSettings> {
  return patchJson<SeedingSettings>("/seeding", settings);
}
