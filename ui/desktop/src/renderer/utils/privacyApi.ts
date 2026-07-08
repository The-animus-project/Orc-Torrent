import { getJson, postJson } from "./api";
import type { PrivacyPresetResult, PrivacyStatus } from "../types";

export async function getPrivacyStatus(): Promise<PrivacyStatus> {
  return getJson<PrivacyStatus>("/net/privacy-status");
}

export async function applyVpnSafetyPreset(): Promise<PrivacyPresetResult> {
  return postJson<PrivacyPresetResult>("/net/privacy/preset/vpn-safety", {});
}
