// ui/desktop/scripts/clean.ts — remove compile and packaging artifacts (not node_modules / cargo target).

import { existsSync, rmSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const repoRoot = resolve(projectRoot, "..", "..");

const args = new Set(process.argv.slice(2));
const deep = args.has("--deep");

const pathsToClean = [
  join(projectRoot, "dist", "main"),
  join(projectRoot, "dist", "preload"),
  join(projectRoot, "dist", "renderer"),
  join(projectRoot, "assets", "bin"),
  join(projectRoot, "release"),
  join(projectRoot, "dist", "animus"),
  join(projectRoot, "dist", "free"),
  join(projectRoot, "dist", "premium"),
  join(projectRoot, "dist", "mac-arm64"),
  join(projectRoot, "dist", "win-unpacked"),
  join(projectRoot, "dist", "linux-unpacked"),
];

const artifactPatterns = [
  ".dmg",
  ".pkg",
  ".AppImage",
  ".deb",
  ".exe",
  ".blockmap",
  "builder-debug.yml",
  "latest-mac.yml",
  "latest-linux.yml",
  "latest.yml",
];

function cleanPath(path: string): void {
  if (!existsSync(path)) return;
  try {
    rmSync(path, { recursive: true, force: true });
    console.log(`  removed ${path.replace(projectRoot + "/", "")}`);
  } catch (err) {
    console.warn(`  failed to remove ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function cleanDistRootArtifacts(): void {
  const distRoot = join(projectRoot, "dist");
  if (!existsSync(distRoot)) return;

  for (const entry of readdirSync(distRoot)) {
    const full = join(distRoot, entry);
    if (artifactPatterns.some((suffix) => entry.endsWith(suffix) || entry === suffix)) {
      cleanPath(full);
    }
    if (entry.startsWith("ORC") || entry.startsWith("orc")) {
      cleanPath(full);
    }
  }
}

console.log("\nORC Torrent — clean\n");

for (const path of pathsToClean) {
  cleanPath(path);
}

cleanDistRootArtifacts();

if (deep) {
  console.log("\nDeep clean (cargo target/release only)...");
  cleanPath(join(repoRoot, "crates", "target", "release"));
  cleanPath(join(repoRoot, "crates", "target", "debug"));
}

console.log("\nClean complete.\n");
