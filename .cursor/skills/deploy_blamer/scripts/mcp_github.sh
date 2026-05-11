#!/usr/bin/env bash
# Sources .env and launches the GitHub MCP server.
# Secrets stay in .env (gitignored); this script and mcp.json are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_github: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${GITHUB_PERSONAL_ACCESS_TOKEN:?mcp_github: GITHUB_PERSONAL_ACCESS_TOKEN is unset; add it to .env}"

export PATH="${HOME}/.node/bin:${PATH:-/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin}"

if ! command -v npx >/dev/null 2>&1; then
  echo "mcp_github: npx not found. Install Node.js and ensure it is on PATH." >&2
  exit 1
fi

exec npx -y @modelcontextprotocol/server-github
