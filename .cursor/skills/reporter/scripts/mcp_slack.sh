#!/usr/bin/env bash
# Wrapper that exposes Slack via the upstream slack-mcp-server
# (https://github.com/korotovsky/slack-mcp-server). Cursor (and any
# other MCP client) launches this script in stdio mode (wired up in
# .cursor/mcp.json).
#
# Why this package: actively maintained (vs. the now-archived
# @modelcontextprotocol/server-slack), supports both bot tokens
# (xoxb-...) and user OAuth tokens (xoxp-...), and exposes
# `conversations_add_message` for posting once it is explicitly
# enabled — write tools are off by default, which is the right
# safety posture for a reporter.
#
# One-time setup the user does before this script can run successfully:
#
#   1. Create / pick a Slack app on https://api.slack.com/apps.
#   2. Grant the right scopes (chat:write at minimum; chat:write.public
#      if you want to post into channels the bot is not a member of;
#      im:write to DM users).
#   3. Install the app to the workspace and copy the bot token
#      (xoxb-...) or user token (xoxp-...).
#   4. Put the token in `.env` as SLACK_MCP_XOXB_TOKEN or
#      SLACK_MCP_XOXP_TOKEN (see .env.example).
#
# See .cursor/skills/reporter/servers.md for the full setup checklist.
#
# Secrets stay in .env (gitignored); this script and .cursor/mcp.json
# are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_slack: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "mcp_slack: npx not found. Install Node.js (>= 18) first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${SLACK_MCP_XOXP_TOKEN:-}" && -z "${SLACK_MCP_XOXB_TOKEN:-}" \
      && ( -z "${SLACK_MCP_XOXC_TOKEN:-}" || -z "${SLACK_MCP_XOXD_TOKEN:-}" ) ]]; then
  echo "mcp_slack: no Slack token found in .env." >&2
  echo "  Set one of:" >&2
  echo "    SLACK_MCP_XOXP_TOKEN=xoxp-...   (user OAuth token, recommended)" >&2
  echo "    SLACK_MCP_XOXB_TOKEN=xoxb-...   (bot token; limited to invited channels)" >&2
  echo "    SLACK_MCP_XOXC_TOKEN=xoxc-...   + SLACK_MCP_XOXD_TOKEN=xoxd-... (browser tokens)" >&2
  echo "  See .cursor/skills/reporter/servers.md § Slack for token-mint steps." >&2
  exit 1
fi

# Enable conversations_add_message (the post tool) by default. Override
# with SLACK_MCP_ADD_MESSAGE_TOOL=C123,C456 in .env to whitelist
# specific channels only.
export SLACK_MCP_ADD_MESSAGE_TOOL="${SLACK_MCP_ADD_MESSAGE_TOOL:-true}"

exec npx -y slack-mcp-server@latest --transport stdio
