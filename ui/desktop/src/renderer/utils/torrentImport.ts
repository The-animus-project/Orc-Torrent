import { postJson } from "./api";
import { displayNameFromMagnet } from "../lib/infoHash";

export interface ImportedTorrentResult {
  id: string;
  addedVia: "magnet" | "torrent_url";
  showFileDialog: boolean;
}

const GENERIC_NAME_HINTS = new Set(["magnet", "search-result", "torrent"]);

function isGenericNameHint(hint: string): boolean {
  return GENERIC_NAME_HINTS.has(hint.trim().toLowerCase());
}

function nameHintFromTorrentUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop() ?? "";
    const trimmed = base.trim();
    if (!trimmed) return undefined;
    if (trimmed.toLowerCase().endsWith(".torrent")) {
      const withoutExt = trimmed.slice(0, -8).trim();
      return withoutExt || undefined;
    }
    return trimmed;
  } catch {
    return undefined;
  }
}

function resolveTorrentNameHint(explicitHint: string | null | undefined, fallback?: string | null): string | undefined {
  const fromExplicit = explicitHint?.trim();
  if (fromExplicit && !isGenericNameHint(fromExplicit)) return fromExplicit;
  const fromFallback = fallback?.trim();
  if (fromFallback && !isGenericNameHint(fromFallback)) return fromFallback;
  return undefined;
}

function magnetNameHint(magnetUri: string, nameHint?: string | null): string | undefined {
  const fromHint = nameHint?.trim();
  if (fromHint && !isGenericNameHint(fromHint)) return fromHint;
  const fromMagnet = displayNameFromMagnet(magnetUri);
  return fromMagnet ?? undefined;
}

export async function addMagnetToDaemon(
  magnetUri: string,
  savePath?: string | null,
  nameHint?: string | null
): Promise<ImportedTorrentResult> {
  const resolvedName = magnetNameHint(magnetUri, nameHint);
  const response = await postJson<{ id: string }>(
    "/torrents",
    {
      magnet: magnetUri,
      ...(resolvedName ? { name_hint: resolvedName } : {}),
      ...(savePath ? { save_path: savePath } : {}),
    },
    30000
  );

  return {
    id: response.id,
    addedVia: "magnet",
    showFileDialog: false,
  };
}

export async function addTorrentB64ToDaemon(
  torrentB64: string,
  savePath?: string | null,
  nameHint?: string | null,
  torrentUrl?: string | null
): Promise<ImportedTorrentResult> {
  const resolvedName = resolveTorrentNameHint(nameHint, torrentUrl ? nameHintFromTorrentUrl(torrentUrl) : undefined);
  const added = await postJson<{ id: string }>(
    "/torrents",
    {
      torrent_b64: torrentB64,
      ...(resolvedName ? { name_hint: resolvedName } : {}),
      ...(savePath ? { save_path: savePath } : {}),
    },
    60000
  );

  return {
    id: added.id,
    addedVia: "torrent_url",
    showFileDialog: true,
  };
}

export async function importTorrentUrlToDaemon(
  torrentUrl: string,
  savePath?: string | null,
  nameHint?: string | null
): Promise<ImportedTorrentResult> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(torrentUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download torrent: ${response.statusText}`);
    }

    const blob = await response.blob();
    if (blob.size > 7 * 1024 * 1024) {
      throw new Error("Torrent file too large (max 7MB)");
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    const torrentB64 = btoa(binary);
    const resolvedName = resolveTorrentNameHint(nameHint, nameHintFromTorrentUrl(torrentUrl));
    return addTorrentB64ToDaemon(torrentB64, savePath, resolvedName);
  } finally {
    window.clearTimeout(timeoutId);
  }
}
