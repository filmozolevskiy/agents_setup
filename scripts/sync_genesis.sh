#!/usr/bin/env bash
# Pulls latest changes from the genesis repo before codebase-memory queries.
# Reads GENESIS_PATH from .env in the repo root.
# Exit 0 always — a pull failure should not block the tool call.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load GENESIS_PATH from .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  GENESIS_PATH=$(grep -E '^GENESIS_PATH=' "$REPO_ROOT/.env" | cut -d= -f2-)
fi

if [[ -z "${GENESIS_PATH:-}" ]]; then
  echo "GENESIS_PATH not set in .env — skipping genesis sync." >&2
  exit 0
fi

if [[ ! -d "$GENESIS_PATH/.git" ]]; then
  echo "GENESIS_PATH ($GENESIS_PATH) is not a git repo — skipping sync." >&2
  exit 0
fi

cd "$GENESIS_PATH"
echo "Pulling latest genesis changes..."
git pull --ff-only --quiet 2>&1 || echo "git pull failed (non-fatal) — continuing with current state." >&2

exit 0
