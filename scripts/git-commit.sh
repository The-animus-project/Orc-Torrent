#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

"$ROOT/scripts/setup-git-identity.sh" >/dev/null

if [ $# -lt 1 ]; then
  echo "Usage: $0 <commit message>" >&2
  exit 1
fi

exec git commit -m "$1"
