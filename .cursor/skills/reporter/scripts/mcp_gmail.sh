#!/usr/bin/env bash
# Wrapper that exposes Gmail via the @gongrzhe/server-gmail-autoauth-mcp
# package (https://github.com/GongRzhe/Gmail-MCP-Server). Cursor (and any
# other MCP client) launches this script in stdio mode (wired up in
# .cursor/mcp.json).
#
# Why this package: it runs over stdio out of the box, ships the OAuth2
# flow as a separate `auth` subcommand (one-time browser dance), and
# stores credentials at ~/.gmail-mcp/credentials.json so the running
# server is fully unattended afterwards. The Gmail API tools it exposes
# (send_email, draft_email, ...) are documented in `servers.md`.
#
# One-time setup the user does before this script can run successfully:
#
#   1. Create a Google Cloud project + OAuth client (Desktop or Web app).
#   2. Save the downloaded JSON as `~/.gmail-mcp/gcp-oauth.keys.json`.
#   3. Run: `npx -y @gongrzhe/server-gmail-autoauth-mcp auth`
#      (opens a browser; on success writes ~/.gmail-mcp/credentials.json)
#
# See .cursor/skills/reporter/servers.md for the full setup checklist.
#
# Secrets stay in ~/.gmail-mcp/ (per-user, outside the repo). This
# script and .cursor/mcp.json are safe to commit.

set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "mcp_gmail: npx not found. Install Node.js (>= 18) first." >&2
  exit 1
fi

GMAIL_OAUTH_KEYS="${GMAIL_OAUTH_KEYS:-${HOME}/.gmail-mcp/gcp-oauth.keys.json}"
GMAIL_CREDENTIALS="${GMAIL_CREDENTIALS:-${HOME}/.gmail-mcp/credentials.json}"

if [[ ! -f "${GMAIL_OAUTH_KEYS}" ]]; then
  echo "mcp_gmail: ${GMAIL_OAUTH_KEYS} not found." >&2
  echo "  See .cursor/skills/reporter/servers.md \u00a7 Gmail for the one-time" >&2
  echo "  Google Cloud OAuth setup (download gcp-oauth.keys.json, drop it" >&2
  echo "  into ~/.gmail-mcp/, then run \`npx -y @gongrzhe/server-gmail-autoauth-mcp auth\`)." >&2
  exit 1
fi

if [[ ! -f "${GMAIL_CREDENTIALS}" ]]; then
  echo "mcp_gmail: ${GMAIL_CREDENTIALS} not found." >&2
  echo "  Run the one-time browser flow:" >&2
  echo "    npx -y @gongrzhe/server-gmail-autoauth-mcp auth" >&2
  echo "  Then re-launch the MCP server." >&2
  exit 1
fi

exec npx -y @gongrzhe/server-gmail-autoauth-mcp
