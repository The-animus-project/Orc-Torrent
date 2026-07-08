export const APP_THEME_MODE_IDS = ["auto", "light", "dark"] as const;

export type AppThemeMode = (typeof APP_THEME_MODE_IDS)[number];
export type ResolvedAppTheme = "light" | "dark";

export interface AppThemeState {
  source: AppThemeMode;
  resolved: ResolvedAppTheme;
}

export function isAppThemeMode(value: string): value is AppThemeMode {
  return (APP_THEME_MODE_IDS as readonly string[]).includes(value);
}

export function toElectronThemeSource(mode: AppThemeMode): "system" | "light" | "dark" {
  return mode === "auto" ? "system" : mode;
}

export function fromElectronThemeSource(source: string): AppThemeMode {
  if (source === "light" || source === "dark") {
    return source;
  }
  return "auto";
}
