export type UpdatePhase = "idle" | "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";

export interface UpdatePrefs {
  autoCheck: boolean;
}

export interface UpdateStatus {
  currentVersion: string;
  autoCheck: boolean;
  phase: UpdatePhase;
  lastCheckedAt: number | null;
  availableVersion: string | null;
  downloadPercent: number | null;
  error: string | null;
}

export type UpdateEventName =
  | "updater:checking"
  | "updater:available"
  | "updater:not-available"
  | "updater:download-progress"
  | "updater:downloaded"
  | "updater:error"
  | "updater:status-changed";

export interface UpdateDownloadProgress {
  percent: number;
}
