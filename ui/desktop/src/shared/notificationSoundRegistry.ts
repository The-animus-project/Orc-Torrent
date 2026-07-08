/** Custom user sound served from userData via app protocol. */
export const NOTIFICATION_SOUND_CUSTOM_URL = "app://notification-sound";

/** Prefix for bundled default sounds served via app protocol. */
export const NOTIFICATION_SOUND_DEFAULT_URL_PREFIX = "app://default-notification-sounds/";

/** Folder name under renderer dist (vite public) and dev public/. */
export const NOTIFICATION_SOUNDS_DIR_NAME = "notification-sounds";

export interface BundledNotificationSoundEntry {
  /** Stable id for ordering and docs. */
  id: string;
  /** Filename on disk inside notification-sounds/. */
  filename: string;
  /** Human-readable label in Settings. */
  label: string;
}

/** Canonical bundled sounds shipped in public/notification-sounds (order preserved in UI). */
export const BUNDLED_NOTIFICATION_SOUND_REGISTRY: readonly BundledNotificationSoundEntry[] = [
  {
    id: "anime",
    filename: "Anime notification sound - Jayanta Lyrics.mp3",
    label: "Anime notification",
  },
  {
    id: "computer",
    filename: "Computer Notification - Free Sound Effect - Free Sound Effects.mp3",
    label: "Computer notification",
  },
  {
    id: "fahhh",
    filename: "Fahhh Sound Effect Tone ｜ Message Tone ｜ Download 👇 - Ringtones4u.mp3",
    label: "Fahhh message tone",
  },
  {
    id: "iphone-ping",
    filename: "IPHONE NOTIFICATION SOUND EFFECT (PING／DING) - SoundsAreUs.mp3",
    label: "iPhone ping",
  },
  {
    id: "message-tone",
    filename: "message tone msg ringtone tamil dialogue nokia x msg tone oye message tone i hate you - YT SONG AM.mp3",
    label: "Message tone",
  },
] as const;

const REGISTRY_FILENAME_SET = new Set(BUNDLED_NOTIFICATION_SOUND_REGISTRY.map((entry) => entry.filename));

const LABEL_BY_FILENAME = new Map(
  BUNDLED_NOTIFICATION_SOUND_REGISTRY.map((entry) => [entry.filename, entry.label] as const)
);

export type NotificationSoundAudioPayload =
  { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" };

export function isSafeNotificationSoundFilename(filename: string): boolean {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  if (!base || base.includes("..") || pathIsAbsolute(base)) return false;
  return base.toLowerCase().endsWith(".mp3") && base.length > 4 && base.length <= 255;
}

function pathIsAbsolute(name: string): boolean {
  return /^([A-Za-z]:[\\/]|\\\\|\/)/.test(name);
}

export function defaultNotificationSoundLabel(filename: string): string {
  const fallback =
    filename
      .replace(/\.mp3$/i, "")
      .replace(/\s*[-–—|]\s*.*$/, "")
      .trim() || filename;
  return LABEL_BY_FILENAME.get(filename) ?? fallback;
}

export function buildDefaultNotificationSoundUrl(filename: string): string {
  return NOTIFICATION_SOUND_DEFAULT_URL_PREFIX + encodeURIComponent(filename);
}

export function parseDefaultNotificationSoundUrl(url: string | null | undefined): string | null {
  if (!url?.startsWith(NOTIFICATION_SOUND_DEFAULT_URL_PREFIX)) return null;
  const filename = decodeURIComponent(url.slice(NOTIFICATION_SOUND_DEFAULT_URL_PREFIX.length).replace(/\?.*$/, ""));
  return filename || null;
}

export function isCustomNotificationSoundUrl(url: string | null | undefined): boolean {
  return url === NOTIFICATION_SOUND_CUSTOM_URL || (url?.startsWith(`${NOTIFICATION_SOUND_CUSTOM_URL}?`) ?? false);
}

export function urlToNotificationSoundAudioPayload(url: string | null): NotificationSoundAudioPayload {
  if (!url) return { type: "builtin" };
  if (isCustomNotificationSoundUrl(url)) return { type: "custom" };
  const filename = parseDefaultNotificationSoundUrl(url);
  if (filename && isSafeNotificationSoundFilename(filename)) {
    return { type: "default", filename };
  }
  return { type: "builtin" };
}

/** Registry order first, then any extra MP3s from disk (alphabetical). */
export function sortNotificationSoundFilenames(filenames: string[]): string[] {
  const present = new Set(filenames);
  const ordered = BUNDLED_NOTIFICATION_SOUND_REGISTRY.map((entry) => entry.filename).filter((name) =>
    present.has(name)
  );
  const extras = filenames.filter((name) => !REGISTRY_FILENAME_SET.has(name)).sort((a, b) => a.localeCompare(b));
  return [...ordered, ...extras];
}

export function isRegisteredBundledNotificationSound(filename: string): boolean {
  return REGISTRY_FILENAME_SET.has(filename);
}

export interface NotificationSoundSelectOption {
  value: string;
  label: string;
  /** False when the MP3 is listed in the registry but not found on disk. */
  available: boolean;
  kind: "builtin" | "bundled" | "extra" | "custom";
}

const CUSTOM_SOUND_SELECT_VALUE = "__custom__";

export function getCustomSoundSelectValue(): string {
  return CUSTOM_SOUND_SELECT_VALUE;
}

/** Options for the Settings sound dropdown (built-in, registry, extras, custom). */
export const NOTIFICATION_SOUND_PREFERENCE_STORAGE_KEY = "orc-notification-sound-preference";

export type StoredNotificationSoundPreference =
  { type: "builtin" } | { type: "default"; filename: string } | { type: "custom" };

type PreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

function getPreferenceStorage(): PreferenceStorage | null {
  const storage = (globalThis as { localStorage?: PreferenceStorage }).localStorage;
  return storage ?? null;
}

export function readStoredNotificationSoundPreference(): StoredNotificationSoundPreference | null {
  try {
    const storage = getPreferenceStorage();
    if (!storage) return null;
    const raw = storage.getItem(NOTIFICATION_SOUND_PREFERENCE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredNotificationSoundPreference;
    if (parsed.type === "builtin") return { type: "builtin" };
    if (parsed.type === "custom") return { type: "custom" };
    if (parsed.type === "default" && typeof parsed.filename === "string" && parsed.filename) {
      return isSafeNotificationSoundFilename(parsed.filename) ? { type: "default", filename: parsed.filename } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeStoredNotificationSoundPreference(preference: StoredNotificationSoundPreference): void {
  try {
    const storage = getPreferenceStorage();
    if (!storage) return;
    storage.setItem(NOTIFICATION_SOUND_PREFERENCE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // ignore
  }
}

export function clearStoredNotificationSoundPreference(): void {
  try {
    const storage = getPreferenceStorage();
    storage?.removeItem(NOTIFICATION_SOUND_PREFERENCE_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function storedNotificationSoundPreferenceToUrl(preference: StoredNotificationSoundPreference): string | null {
  if (preference.type === "builtin") return null;
  if (preference.type === "custom") return NOTIFICATION_SOUND_CUSTOM_URL;
  return buildDefaultNotificationSoundUrl(preference.filename);
}

export function urlToStoredNotificationSoundPreference(url: string | null): StoredNotificationSoundPreference {
  const payload = urlToNotificationSoundAudioPayload(url);
  if (payload.type === "custom") return { type: "custom" };
  if (payload.type === "default") return { type: "default", filename: payload.filename };
  return { type: "builtin" };
}

export function notificationSoundMetaToPreference(meta: {
  type?: string;
  filename?: string;
}): StoredNotificationSoundPreference {
  if (meta.type === "default" && meta.filename) {
    const filename = meta.filename.split(/[/\\]/).pop() ?? meta.filename;
    if (isSafeNotificationSoundFilename(filename)) {
      return { type: "default", filename };
    }
  }
  if (meta.type === "custom") return { type: "custom" };
  return { type: "builtin" };
}

export function getNotificationSoundSelectOptions(
  diskFilenames: string[],
  hasCustomSound: boolean
): NotificationSoundSelectOption[] {
  const diskSet = new Set(diskFilenames);
  const options: NotificationSoundSelectOption[] = [
    { value: "", label: "Built-in tone", available: true, kind: "builtin" },
  ];

  for (const entry of BUNDLED_NOTIFICATION_SOUND_REGISTRY) {
    options.push({
      value: entry.filename,
      label: entry.label,
      available: diskSet.has(entry.filename),
      kind: "bundled",
    });
  }

  for (const filename of sortNotificationSoundFilenames(diskFilenames)) {
    if (REGISTRY_FILENAME_SET.has(filename)) continue;
    options.push({
      value: filename,
      label: defaultNotificationSoundLabel(filename),
      available: true,
      kind: "extra",
    });
  }

  options.push({
    value: CUSTOM_SOUND_SELECT_VALUE,
    label: hasCustomSound ? "Custom sound (selected)" : "Custom sound…",
    available: true,
    kind: "custom",
  });

  return options;
}
