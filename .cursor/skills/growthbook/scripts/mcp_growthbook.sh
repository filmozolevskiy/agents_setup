#!/usr/bin/env bash
# Sources .env and launches the GrowthBook MCP server.
# Secrets stay in .env (gitignored); this script and mcp.json are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_growthbook: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${GB_API_KEY:?mcp_growthbook: GB_API_KEY is unset; add it to .env}"
: "${GB_EMAIL:?mcp_growthbook: GB_EMAIL is unset; add it to .env}"
# GB_API_URL / GB_APP_ORIGIN are required only for self-hosted GrowthBook
# (FlightHub is self-hosted: API https://gb-api.flighthub.com, app https://gb.flighthub.com).
# They are read from .env by the server when exported above.

export PATH="${HOME}/.node/bin:${PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"

if ! command -v npx >/dev/null 2>&1; then
  echo "mcp_growthbook: npx not found. Install Node.js and ensure it is on PATH." >&2
  exit 1
fi

exec npx -y @growthbook/mcp@latest
