import { getJson, patchJson, postJson } from "./api";
import type { WatchFoldersResponse, WatchFolderSettings } from "../types";

export async function getWatchFolders(): Promise<WatchFoldersResponse> {
  return getJson<WatchFoldersResponse>("/watch-folders");
}

export async function patchWatchFolders(patch: {
  enabled?: boolean;
  folders?: WatchFolderSettings["folders"];
}): Promise<WatchFoldersResponse> {
  return patchJson<WatchFoldersResponse>("/watch-folders", patch);
}

export async function testWatchFolder(folder_path: string, archive_folder?: string) {
  return postJson<{ ok: boolean; message: string }>("/watch-folders/test", {
    folder_path,
    archive_folder,
  });
}
