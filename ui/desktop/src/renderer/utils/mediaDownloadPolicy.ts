const MEDIA_EXTENSIONS = new Set([
  "mkv",
  "mp4",
  "avi",
  "mov",
  "wmv",
  "m4v",
  "webm",
  "mpg",
  "mpeg",
  "ts",
  "m2ts",
  "flv",
  "ogv",
  "3gp",
  "vob",
  "mp3",
  "flac",
  "aac",
  "ogg",
  "opus",
  "m4a",
  "wav",
  "wma",
  "ape",
]);

const SUBTITLE_EXTENSIONS = new Set(["srt", "sub", "ssa", "ass", "vtt", "sup", "idx", "sbv", "smi", "mpl"]);

const ARCHIVE_EXTENSIONS = new Set(["rar", "zip", "7z", "001"]);

const EXECUTABLE_EXTENSIONS = new Set([
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "scr",
  "pif",
  "app",
  "deb",
  "rpm",
  "apk",
  "jar",
  "vbs",
  "ps1",
  "sh",
  "run",
  "pkg",
  "dmg",
  "dll",
  "sys",
  "drv",
  "cpl",
  "inf",
  "reg",
  "hta",
  "wsf",
  "lnk",
  "iso",
]);

function extensionOf(fileName: string): string | null {
  const base = fileName.split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot + 1 >= base.length) {
    return null;
  }
  return base.slice(dot + 1).toLowerCase();
}

function isRarPartExtension(ext: string): boolean {
  return ext.length === 3 && ext.startsWith("r") && /^r\d{2}$/.test(ext);
}

export function isDownloadAllowedForPath(filePath: string): boolean {
  const name = filePath.trim().toLowerCase();
  if (!name) {
    return false;
  }

  const ext = extensionOf(name);
  if (!ext) {
    return false;
  }

  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return false;
  }

  if (isRarPartExtension(ext)) {
    return true;
  }

  return MEDIA_EXTENSIONS.has(ext) || SUBTITLE_EXTENSIONS.has(ext) || ARCHIVE_EXTENSIONS.has(ext);
}

export function downloadBlockReason(filePath: string): string {
  const name = filePath.split("/").pop() ?? filePath;
  const ext = extensionOf(name);
  if (!ext) {
    return "Unrecognized file type";
  }
  if (EXECUTABLE_EXTENSIONS.has(ext)) {
    return "Executable blocked";
  }
  return "Not movie, TV, or subtitle";
}

export function isAnimusMediaPolicyActive(): boolean {
  return document.documentElement.dataset.appEdition === "animus";
}
