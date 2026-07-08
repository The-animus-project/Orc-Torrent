#!/usr/bin/env bash
# Build Linux transportable artifacts (AppImage + .deb) via Docker.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="orc-torrent-linux-builder:local"
RELEASE_DIR="${ROOT}/ui/desktop/release"

mkdir -p "${RELEASE_DIR}"

echo "Building Docker image ${IMAGE}..."
docker build -f "${ROOT}/scripts/Dockerfile.linux-build" -t "${IMAGE}" "${ROOT}"

echo "Running Linux packaging..."
docker run --rm \
  -v "${ROOT}:/workspace" \
  -w /workspace \
  "${IMAGE}"

echo ""
echo "Linux artifacts in ${RELEASE_DIR}:"
ls -lh "${RELEASE_DIR}/"*.{AppImage,deb,yml} 2>/dev/null || ls -lh "${RELEASE_DIR}/"
