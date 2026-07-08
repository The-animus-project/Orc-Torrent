import { getJson, patchJson, postJson } from "./api";
import type { BandwidthSettings, SessionLimitsResponse } from "../types";

export async function getSessionLimits(): Promise<SessionLimitsResponse> {
  return getJson<SessionLimitsResponse>("/torrents/limits");
}

export async function postSessionLimits(body: {
  download_bps: number | null;
  upload_bps: number | null;
}): Promise<SessionLimitsResponse> {
  return postJson<SessionLimitsResponse>("/torrents/limits", body);
}

export async function patchBandwidthSchedule(settings: BandwidthSettings): Promise<BandwidthSettings> {
  return patchJson<BandwidthSettings>("/bandwidth/schedule", settings);
}
