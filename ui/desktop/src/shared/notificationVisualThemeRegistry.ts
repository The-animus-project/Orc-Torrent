export const NOTIFICATION_VISUAL_THEME_STORAGE_KEY = "orc-notification-visual-theme";

export type NotificationVisualTheme = "flames" | "electric" | "matrix" | "kawaii" | "anarchy";

export interface NotificationVisualThemeEntry {
  id: NotificationVisualTheme;
  label: string;
  /** Legacy localStorage values mapped to this theme on read. */
  legacyStorageValues?: readonly string[];
}

export const NOTIFICATION_VISUAL_THEME_REGISTRY: readonly NotificationVisualThemeEntry[] = [
  { id: "flames", label: "Flames", legacyStorageValues: ["error"] },
  { id: "electric", label: "Electric", legacyStorageValues: ["info"] },
  { id: "matrix", label: "Matrix" },
  { id: "kawaii", label: "Kawaii Pink" },
  { id: "anarchy", label: "Anarchy" },
] as const;

export const NOTIFICATION_VISUAL_THEME_IDS: readonly NotificationVisualTheme[] = NOTIFICATION_VISUAL_THEME_REGISTRY.map(
  (entry) => entry.id
);

const LEGACY_THEME_BY_STORAGE_VALUE = new Map<string, NotificationVisualTheme>(
  NOTIFICATION_VISUAL_THEME_REGISTRY.flatMap((entry) =>
    (entry.legacyStorageValues ?? []).map((legacy) => [legacy, entry.id] as const)
  )
);

export function isNotificationVisualTheme(value: string): value is NotificationVisualTheme {
  return (NOTIFICATION_VISUAL_THEME_IDS as readonly string[]).includes(value);
}

type ThemeStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function getThemeStorage(): ThemeStorage | null {
  const storage = (globalThis as { localStorage?: ThemeStorage }).localStorage;
  return storage ?? null;
}

export function readNotificationVisualTheme(): NotificationVisualTheme {
  try {
    const storage = getThemeStorage();
    if (!storage) return "electric";
    const raw = storage.getItem(NOTIFICATION_VISUAL_THEME_STORAGE_KEY);
    if (raw && isNotificationVisualTheme(raw)) return raw;
    const legacy = raw ? LEGACY_THEME_BY_STORAGE_VALUE.get(raw) : undefined;
    if (legacy) return legacy;
    return "electric";
  } catch {
    return "electric";
  }
}

/** Persist banner/toast theme for the next app launch. */
export function writeNotificationVisualTheme(theme: NotificationVisualTheme): void {
  try {
    const storage = getThemeStorage();
    if (!storage) return;
    storage.setItem(NOTIFICATION_VISUAL_THEME_STORAGE_KEY, theme);
  } catch {
    // ignore quota / private mode
  }
}

export function getNotificationVisualThemePreviewMessage(theme: NotificationVisualTheme): string {
  if (theme === "kawaii") {
    return "Kawaii Pink preview — love hearts all around! 💕";
  }
  if (theme === "anarchy") {
    return "Anarchy preview — no gods, no masters, no seed limits.";
  }
  return "Theme preview: This is how popup notifications look.";
}

export function usesKawaiiHeartRing(theme: NotificationVisualTheme): boolean {
  return theme === "kawaii";
}

export function usesAnarchyEmblemRing(theme: NotificationVisualTheme): boolean {
  return theme === "anarchy";
}

/** Exit animation duration (ms) — keep in sync with `anarchyStampOut` in styles.css */
export function getNotificationThemeExitAnimationMs(theme: NotificationVisualTheme): number {
  return theme === "anarchy" ? 320 : 250;
}
