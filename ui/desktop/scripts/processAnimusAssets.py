#!/usr/bin/env python3
"""Remove solid backgrounds from AnimUS overlay PNGs (flood-fill from corners)."""

from __future__ import annotations

import sys
from collections import deque
from pathlib import Path

from PIL import Image

DESKTOP = Path(__file__).resolve().parents[1]
TARGET_DIRS = [
    DESKTOP / "public" / "images" / "animus",
    DESKTOP / "images" / "animus",
]

# Overlay assets that should sit on the dark shell with no opaque box.
# anarchy-emblem and loading-logo already ship with transparent backgrounds.
TRANSPARENT_ASSETS = (
    "ui-logo.png",
    "crown.png",
    "brand-mark.png",
    "corner-watermark.png",
)


def flood_transparent_black(im: Image.Image, tolerance: int = 42) -> Image.Image:
    rgba = im.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    visited: set[tuple[int, int]] = set()
    queue: deque[tuple[int, int]] = deque()

    def is_background(x: int, y: int) -> bool:
        r, g, b, a = px[x, y]
        if a < 8:
            return True
        return r <= tolerance and g <= tolerance and b <= tolerance

    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if is_background(x, y):
            queue.append((x, y))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited or x < 0 or y < 0 or x >= w or y >= h:
            continue
        if not is_background(x, y):
            continue
        visited.add((x, y))
        r, g, b, _ = px[x, y]
        px[x, y] = (r, g, b, 0)
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

    return rgba


def process_asset(path: Path) -> None:
    original = Image.open(path)
    processed = flood_transparent_black(original)
    processed.save(path, optimize=True)
    alpha = sum(1 for _, _, _, a in processed.getdata() if a < 20)
    total = processed.size[0] * processed.size[1]
    print(f"  {path.name}: {alpha}/{total} transparent pixels")


def main() -> int:
    source_dir = DESKTOP / "public" / "images" / "animus"
    if not source_dir.is_dir():
        print(f"Missing asset dir: {source_dir}", file=sys.stderr)
        return 1

    print("Processing AnimUS overlay assets...")
    processed: dict[str, Image.Image] = {}
    for name in TRANSPARENT_ASSETS:
        src = source_dir / name
        if not src.exists():
            print(f"  skip missing: {name}")
            continue
        processed[name] = flood_transparent_black(Image.open(src))

    for target_dir in TARGET_DIRS:
        target_dir.mkdir(parents=True, exist_ok=True)
        print(f"\nWriting {target_dir}")
        for name, image in processed.items():
            out = target_dir / name
            image.save(out, optimize=True)
            alpha = sum(1 for _, _, _, a in image.getdata() if a < 20)
            total = image.size[0] * image.size[1]
            print(f"  {name}: {alpha}/{total} transparent pixels")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
