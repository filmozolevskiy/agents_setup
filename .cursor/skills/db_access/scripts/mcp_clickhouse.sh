#!/usr/bin/env bash
# Wrapper that exposes ClickHouse via the upstream mcp-clickhouse server
# (https://github.com/ClickHouse/mcp-clickhouse). Cursor (and any other MCP
# client) launches this script in stdio mode (wired up in .cursor/mcp.json).
#
# Why mcp-clickhouse and not the genai-toolbox --prebuilt clickhouse:
# the toolbox's ClickHouse client closes the connection on this server (EOF
# after sending the Native HTTP handshake), while mcp-clickhouse uses
# clickhouse-connect — the same library that
# .cursor/skills/db_access/scripts/clickhouse_query.py already speaks to
# phoenix-db successfully.
#
# Secrets stay in .env (gitignored); this script and .cursor/mcp.json are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_clickhouse: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

if ! command -v uvx >/dev/null 2>&1; then
  echo "mcp_clickhouse: uvx not found. Install uv from https://docs.astral.sh/uv/ first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# mcp-clickhouse expects CLICKHOUSE_SECURE (true/false), not CLICKHOUSE_PROTOCOL.
# Default to false on 8123/9000 (plain HTTP/Native), true on 8443/443; explicit env wins.
if [[ -z "${CLICKHOUSE_SECURE:-}" ]]; then
  case "${CLICKHOUSE_PORT:-8123}" in
    8443|443) CLICKHOUSE_SECURE=true ;;
    *) CLICKHOUSE_SECURE=false ;;
  esac
fi
export CLICKHOUSE_SECURE
export CLICKHOUSE_VERIFY="${CLICKHOUSE_VERIFY:-true}"

exec uvx --from mcp-clickhouse mcp-clickhouse
