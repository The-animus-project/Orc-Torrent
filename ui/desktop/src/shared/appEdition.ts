import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ANIMUS_EDITION = "animus";
export const STANDARD_EDITION = "standard";

export interface EditionBranding {
  edition: string;
  productName: string;
  windowTitle: string;
  appName: string;
  tagline: string;
  badgeLabel: string;
  accentColor: string;
  autoUpdate: boolean;
  artifactSuffix: string;
  configFolderName: string;
  logoUrl: string;
  sidebarLogoUrl: string;
  sidebarArtworkUrl: string;
  sidebarEmblemUrl: string;
  brandMarkUrl: string;
  surfaceWatermarkUrl: string;
  splashBackgroundUrl: string;
  splashLogoUrl: string;
  splashEmblemUrl: string;
  themeId: string;
}

const STANDARD_BRANDING: EditionBranding = {
  edition: STANDARD_EDITION,
  productName: "ORC TORRENT",
  windowTitle: "ORC TORRENT",
  appName: "ORC TORRENT",
  tagline: "Private torrent client",
  badgeLabel: "",
  accentColor: "",
  autoUpdate: true,
  artifactSuffix: "",
  configFolderName: "OrcTorrent",
  logoUrl: "./images/orctorrent-logo.png",
  sidebarLogoUrl: "",
  sidebarArtworkUrl: "",
  sidebarEmblemUrl: "",
  brandMarkUrl: "",
  surfaceWatermarkUrl: "",
  splashBackgroundUrl: "",
  splashLogoUrl: "",
  splashEmblemUrl: "",
  themeId: "standard",
};

const ANIMUS_FALLBACK_BRANDING: EditionBranding = {
  edition: ANIMUS_EDITION,
  productName: "ORC TORRENT AnimUS",
  windowTitle: "ORC TORRENT — AnimUS Edition",
  appName: "ORC TORRENT AnimUS",
  tagline: "AnimUS Edition · graffiti build",
  badgeLabel: "AnimUS Edition",
  accentColor: "#7cff00",
  autoUpdate: false,
  artifactSuffix: "AnimUS",
  configFolderName: "OrcTorrent-AnimUS",
  logoUrl: "./images/animus/ui-logo.png",
  sidebarLogoUrl: "./images/animus/ui-logo.png",
  sidebarArtworkUrl: "",
  sidebarEmblemUrl: "./images/animus/crown.png",
  brandMarkUrl: "./images/animus/brand-mark.png",
  surfaceWatermarkUrl: "./images/animus/corner-watermark.png",
  splashBackgroundUrl: "./images/animus/loading-screen.png",
  splashLogoUrl: "./images/animus/loading-logo.png",
  splashEmblemUrl: "./images/animus/splash-emblem.svg",
  themeId: "animus-graffiti",
};

export function resolveEditionId(): string {
  const raw = process.env.ORC_TORRENT_EDITION?.trim().toLowerCase();
  return raw === ANIMUS_EDITION ? ANIMUS_EDITION : STANDARD_EDITION;
}

export function isAnimusEdition(): boolean {
  return resolveEditionId() === ANIMUS_EDITION;
}

export function resolveLocalEditionDir(desktopRoot: string): string {
  return join(desktopRoot, "local-edition");
}

export function loadEditionManifest(desktopRoot: string): Partial<EditionBranding> | null {
  const manifestPath = join(resolveLocalEditionDir(desktopRoot), "manifest.json");
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<EditionBranding>;
  } catch {
    return null;
  }
}

export function getEditionBranding(desktopRoot: string): EditionBranding {
  if (!isAnimusEdition()) {
    return STANDARD_BRANDING;
  }

  const manifest = loadEditionManifest(desktopRoot);
  if (!manifest) {
    return ANIMUS_FALLBACK_BRANDING;
  }

  return {
    ...ANIMUS_FALLBACK_BRANDING,
    ...manifest,
    edition: ANIMUS_EDITION,
    autoUpdate: manifest.autoUpdate ?? false,
  };
}
