#!/usr/bin/env bash
# Pull the latest production state of the genesis repo(s) before any
# code-aware question that reads from a local checkout.
#
# Reads GENESIS_PATH / GENESIS_BRANCH and STOREFRONT_PATH / STOREFRONT_BRANCH
# from .env at the agents_setup repo root. Fast-forwards each configured repo
# to its branch (both default to `develop` — each repo's HEAD branch).
# Exit 0 always — a pull failure must not block the calling tool.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# scripts/ → codebase_access/ → skills/ → .cursor/ → repo root
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
  GENESIS_PATH=$(grep -E '^GENESIS_PATH=' "$REPO_ROOT/.env" | cut -d= -f2-)
  GENESIS_BRANCH_FROM_ENV=$(grep -E '^GENESIS_BRANCH=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
  STOREFRONT_PATH=$(grep -E '^STOREFRONT_PATH=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
  STOREFRONT_BRANCH_FROM_ENV=$(grep -E '^STOREFRONT_BRANCH=' "$REPO_ROOT/.env" | cut -d= -f2- || true)
fi

GENESIS_BRANCH="${GENESIS_BRANCH:-${GENESIS_BRANCH_FROM_ENV:-develop}}"
STOREFRONT_BRANCH="${STOREFRONT_BRANCH:-${STOREFRONT_BRANCH_FROM_ENV:-develop}}"

# Fast-forwards $2 (a repo checkout) to $3, labelling log lines with $1.
# Never fails the calling tool — every failure path logs and returns 0.
sync_repo() {
  local label="$1" path="$2" branch="$3"

  if [[ -z "$path" ]]; then
    echo "${label}_PATH not set in .env — skipping ${label} sync." >&2
    return 0
  fi

  if [[ ! -d "$path/.git" ]]; then
    echo "${label}_PATH ($path) is not a git repo — skipping sync." >&2
    return 0
  fi

  (
    cd "$path"
    echo "Syncing ${label} ($path) → $branch..."

    CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    if [[ "$CURRENT_BRANCH" != "$branch" ]]; then
      if ! git switch "$branch" 2>/dev/null; then
        echo "Could not switch ${label} to $branch (current: $CURRENT_BRANCH); leaving HEAD as-is." >&2
        exit 0
      fi
    fi

    git pull --ff-only --quiet 2>&1 || echo "git pull failed (non-fatal) — continuing with current state." >&2
  )

  return 0
}

sync_repo "GENESIS" "${GENESIS_PATH:-}" "$GENESIS_BRANCH"
sync_repo "STOREFRONT" "${STOREFRONT_PATH:-}" "$STOREFRONT_BRANCH"

exit 0
