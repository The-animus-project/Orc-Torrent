#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git config --local user.name "Vurzumm"
git config --local user.email "animustech36@gmail.com"
git config --local core.hooksPath .githooks

chmod +x .githooks/pre-commit 2>/dev/null || true

echo "Git identity for this repo:"
git config --local --get user.name
git config --local --get user.email
echo "Hooks path: $(git config --local --get core.hooksPath)"
