#!/usr/bin/env npx tsx
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const distRoot = resolve(projectRoot, "dist");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else if (entry.isFile()) total += statSync(full).size;
  }
  return total;
}

function findPackagedAppRoot(): string | null {
  const argIdx = process.argv.indexOf("--dist-dir");
  if (argIdx >= 0 && process.argv[argIdx + 1]) {
    const custom = resolve(process.argv[argIdx + 1]);
    return existsSync(custom) ? custom : null;
  }

  if (!existsSync(distRoot)) return null;

  const candidates: string[] = [];
  for (const entry of readdirSync(distRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (name.endsWith("-unpacked") || name.startsWith("mac") || name.startsWith("linux")) {
      candidates.push(join(distRoot, name));
    }
  }

  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

function resolveResourcesDir(appRoot: string): string | null {
  const macResources = join(appRoot, "ORC TORRENT.app", "Contents", "Resources");
  if (existsSync(macResources)) return macResources;
  const flatResources = join(appRoot, "resources");
  if (existsSync(flatResources)) return flatResources;
  return null;
}

function walkFiles(root: string, dir: string, out: Array<{ path: string; size: number }>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(root, full, out);
    else if (entry.isFile()) out.push({ path: relative(root, full), size: statSync(full).size });
  }
}

function collectPackagedFiles(appRoot: string): Array<{ path: string; size: number }> {
  const files: Array<{ path: string; size: number }> = [];
  walkFiles(appRoot, appRoot, files);
  return files;
}

function findDaemonBinary(resourcesDir: string): string | null {
  const binDir = join(resourcesDir, "bin");
  if (!existsSync(binDir)) return null;
  for (const entry of readdirSync(binDir)) {
    if (entry.startsWith("orc-daemon") && !entry.endsWith(".sha256") && !entry.endsWith(".md")) {
      return join(binDir, entry);
    }
  }
  return null;
}

function rendererAssetSizes(): Array<{ path: string; size: number }> {
  const assetsDir = join(projectRoot, "dist", "renderer", "assets");
  if (!existsSync(assetsDir)) return [];
  return readdirSync(assetsDir)
    .filter((f) => /\.(js|css)$/i.test(f))
    .map((f) => ({ path: `dist/renderer/assets/${f}`, size: statSync(join(assetsDir, f)).size }))
    .sort((a, b) => b.size - a.size);
}

async function main(): Promise<void> {
  const appRoot = findPackagedAppRoot();
  console.log("ORC Torrent package size audit\n");

  if (!appRoot) {
    console.log("No packaged app directory found. Run `npm run dist:quick` first.");
    console.log(`Searched under: ${distRoot}`);
    process.exit(1);
  }

  const resourcesDir = resolveResourcesDir(appRoot);
  console.log(`Packaged app: ${appRoot}`);
  if (resourcesDir) {
    console.log(`Resources:    ${resourcesDir}\n`);
  } else {
    console.log("");
  }

  const asarPath = resourcesDir ? join(resourcesDir, "app.asar") : "";
  const asarSize = asarPath && existsSync(asarPath) ? statSync(asarPath).size : 0;
  const resourcesSize = resourcesDir ? dirSize(resourcesDir) : 0;

  console.log(`app.asar:        ${formatBytes(asarSize)}`);
  console.log(`resources/:      ${formatBytes(resourcesSize)}`);

  if (resourcesDir) {
    const daemonPath = findDaemonBinary(resourcesDir);
    if (daemonPath) {
      console.log(`daemon binary:   ${formatBytes(statSync(daemonPath).size)} (${relative(appRoot, daemonPath)})`);
    } else {
      console.log("daemon binary:   (not found in resources/bin)");
    }
  }

  const rendererAssets = rendererAssetSizes();
  if (rendererAssets.length > 0) {
    console.log("\nRenderer JS/CSS (build output):");
    for (const asset of rendererAssets) {
      console.log(`  ${asset.path}: ${formatBytes(asset.size)}`);
    }
  }

  const packaged = collectPackagedFiles(appRoot);
  console.log(`\nTotal packaged files: ${packaged.length}`);

  const top = [...packaged].sort((a, b) => b.size - a.size).slice(0, 20);
  console.log("\nTop 20 largest packaged files:");
  for (const file of top) {
    console.log(`  ${formatBytes(file.size).padStart(10)}  ${file.path}`);
  }

  const totalPackaged = packaged.reduce((sum, f) => sum + f.size, 0);
  console.log(`\nTotal packaged size (uncompressed on disk): ${formatBytes(totalPackaged)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
