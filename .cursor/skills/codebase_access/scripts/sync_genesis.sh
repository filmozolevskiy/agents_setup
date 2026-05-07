#!/usr/bin/env bash
# Pull the latest production state of the genesis repo before any
# code-aware question that reads from the local checkout.
#
# Reads GENESIS_PATH from .env at the agents_setup repo root.
# Fast-forwards GENESIS_BRANCH (default `develop` — the genesis HEAD branch).
# Exit 0 always — a pull failure must not block the calling tool.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# scripts/ → codebase_access/ → skills/ → .cursor/ → repo root
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
  GENESIS_PATH=$(grep -E '^GENESIS_PATH=' "$REPO_ROOT/.env" | cut -d= -f2-)
  GENESIS_BRANCH_FROM_ENV=$(grep -E '^GENESIS_BRANCH=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
fi

GENESIS_BRANCH="${GENESIS_BRANCH:-${GENESIS_BRANCH_FROM_ENV:-develop}}"

if [[ -z "${GENESIS_PATH:-}" ]]; then
  echo "GENESIS_PATH not set in .env — skipping genesis sync." >&2
  exit 0
fi

if [[ ! -d "$GENESIS_PATH/.git" ]]; then
  echo "GENESIS_PATH ($GENESIS_PATH) is not a git repo — skipping sync." >&2
  exit 0
fi

cd "$GENESIS_PATH"
echo "Syncing genesis ($GENESIS_PATH) → $GENESIS_BRANCH..."

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
if [[ "$CURRENT_BRANCH" != "$GENESIS_BRANCH" ]]; then
  if ! git switch "$GENESIS_BRANCH" 2>/dev/null; then
    echo "Could not switch genesis to $GENESIS_BRANCH (current: $CURRENT_BRANCH); leaving HEAD as-is." >&2
    exit 0
  fi
fi

git pull --ff-only --quiet 2>&1 || echo "git pull failed (non-fatal) — continuing with current state." >&2

exit 0
