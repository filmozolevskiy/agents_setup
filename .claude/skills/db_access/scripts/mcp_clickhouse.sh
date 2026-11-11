#!/usr/bin/env bash
# Wrapper that exposes ClickHouse via the upstream mcp-clickhouse server
# (https://github.com/ClickHouse/mcp-clickhouse). Claude Code (and any other MCP
# client) launches this script in stdio mode (wired up in .mcp.json).
#
# Why mcp-clickhouse and not the genai-toolbox --prebuilt clickhouse:
# the toolbox's ClickHouse client closes the connection on this server (EOF
# after sending the Native HTTP handshake), while mcp-clickhouse uses
# clickhouse-connect — the same library that
# .claude/skills/db_access/scripts/clickhouse_query.py already speaks to
# phoenix-db successfully.
#
# Secrets stay in .env (gitignored); this script and .mcp.json are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
# .env and bin/ are gitignored, so a git worktree has neither. Fall back to the
# main checkout so the server starts from any worktree or session folder.
if [[ ! -f "${REPO_ROOT}/.env" ]]; then
  COMMON_DIR="$(git -C "${REPO_ROOT}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [[ -n "${COMMON_DIR}" && -f "$(dirname "${COMMON_DIR}")/.env" ]]; then
    REPO_ROOT="$(dirname "${COMMON_DIR}")"
  fi
fi
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
# phoenix-db serves HTTPS on 8123 and drops plain HTTP, so default to true on
# every port, the same as clickhouse_query.py (secure=True). Explicit env wins.
CLICKHOUSE_SECURE="${CLICKHOUSE_SECURE:-true}"
export CLICKHOUSE_SECURE
export CLICKHOUSE_VERIFY="${CLICKHOUSE_VERIFY:-true}"

exec uvx --from mcp-clickhouse mcp-clickhouse
