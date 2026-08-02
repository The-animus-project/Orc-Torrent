#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git config --local user.name "Vurzumm"
git config --local user.email "contact@orclabs.io"

echo "Git identity for this repo:"
git config --local --get user.name
git config --local --get user.email
