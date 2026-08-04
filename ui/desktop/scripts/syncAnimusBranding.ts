import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isAnimusEdition, resolveLocalEditionDir } from "../src/shared/appEdition.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const SOURCE_NAME = "animus_edition.png";
const TARGET_NAME = "animus-edition.png";
const PUBLIC_ANIMUS_DIR = join(projectRoot, "public", "images", "animus");
const PACKAGE_ANIMUS_DIR = join(projectRoot, "images", "animus");

function copyAnimusImageSet(): number {
  if (!existsSync(PUBLIC_ANIMUS_DIR)) {
    return 0;
  }

  mkdirSync(PACKAGE_ANIMUS_DIR, { recursive: true });
  let copied = 0;

  for (const fileName of readdirSync(PUBLIC_ANIMUS_DIR)) {
    if (!fileName.toLowerCase().endsWith(".png")) {
      continue;
    }
    copyFileSync(join(PUBLIC_ANIMUS_DIR, fileName), join(PACKAGE_ANIMUS_DIR, fileName));
    copied += 1;
  }

  return copied;
}

export function syncAnimusBrandingAssets(): boolean {
  if (!isAnimusEdition()) {
    return false;
  }

  const source = join(resolveLocalEditionDir(projectRoot), "branding", SOURCE_NAME);
  if (!existsSync(source)) {
    console.warn(`[AnimUS] Branding asset missing: ${source}`);
    console.warn("         Place animus_edition.png in ui/desktop/local-edition/branding/");
  } else {
    const targets = [join(projectRoot, "public", "images", TARGET_NAME), join(projectRoot, "images", TARGET_NAME)];

    for (const target of targets) {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    }
  }

  const copied = copyAnimusImageSet();
  console.log(`[AnimUS] Synced graffiti branding assets (${copied} animus image(s) for packaging).`);
  return copied > 0 || existsSync(source);
}

if (import.meta.url.endsWith(process.argv[1] ?? "")) {
  syncAnimusBrandingAssets();
}
