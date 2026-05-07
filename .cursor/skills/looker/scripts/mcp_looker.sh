#!/usr/bin/env bash
# Wrapper that exposes Looker via the MCP Toolbox prebuilt config.
# Cursor (and any other MCP client) launches this script in stdio mode
# (wired up in .cursor/mcp.json).
# Secrets stay in .env (gitignored); this script and .cursor/mcp.json are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
TOOLBOX="${REPO_ROOT}/bin/toolbox"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_looker: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

if [[ ! -x "${TOOLBOX}" ]]; then
  echo "mcp_looker: ${TOOLBOX} missing. Run .cursor/skills/looker/scripts/install_mcp_toolbox.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${LOOKER_BASE_URL:?mcp_looker: LOOKER_BASE_URL is unset; add it to .env}"
: "${LOOKER_CLIENT_ID:?mcp_looker: LOOKER_CLIENT_ID is unset; add it to .env}"
: "${LOOKER_CLIENT_SECRET:?mcp_looker: LOOKER_CLIENT_SECRET is unset; add it to .env}"
export LOOKER_VERIFY_SSL="${LOOKER_VERIFY_SSL:-true}"

exec "${TOOLBOX}" --prebuilt looker --stdio
