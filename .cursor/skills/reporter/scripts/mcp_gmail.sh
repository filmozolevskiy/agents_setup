#!/usr/bin/env bash
# Wrapper that exposes Gmail via the @gongrzhe/server-gmail-autoauth-mcp
# package (https://github.com/GongRzhe/Gmail-MCP-Server). Cursor (and any
# other MCP client) launches this script in stdio mode (wired up in
# .cursor/mcp.json).
#
# All credentials live in .env (gitignored), per repo policy:
#
#   GMAIL_OAUTH_KEYS_B64    — base64 of gcp-oauth.keys.json (OAuth client
#                             from Google Cloud Console)
#   GMAIL_CREDENTIALS_B64   — base64 of credentials.json (issued by the
#                             one-time browser auth flow)
#
# At launch the wrapper materialises the two JSON files into a private
# temp dir, points the MCP at them via GMAIL_OAUTH_PATH /
# GMAIL_CREDENTIALS_PATH, and removes the temp dir on exit. No
# credentials touch ~/.gmail-mcp/ or any other on-disk location outside
# the per-process tmp dir.
#
# One-time auth (writes a fresh GMAIL_CREDENTIALS_B64 line for .env):
#
#   ./.cursor/skills/reporter/scripts/mcp_gmail.sh auth
#
# The auth subcommand decodes GMAIL_OAUTH_KEYS_B64, runs the upstream
# `auth` subcommand (which opens a browser), captures the resulting
# credentials.json, base64-encodes it, and prints the line to paste
# into .env.
#
# See .cursor/skills/reporter/servers.md § Gmail for the full setup
# checklist.
#
# Secrets stay in .env (gitignored); this script and .cursor/mcp.json
# are safe to commit.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "mcp_gmail: ${ENV_FILE} not found. Copy .env.example and fill in credentials." >&2
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "mcp_gmail: npx not found. Install Node.js (>= 18) first." >&2
  exit 1
fi

if ! command -v base64 >/dev/null 2>&1; then
  echo "mcp_gmail: base64 not found." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

if [[ -z "${GMAIL_OAUTH_KEYS_B64:-}" ]]; then
  echo "mcp_gmail: GMAIL_OAUTH_KEYS_B64 not set in .env." >&2
  echo "  Encode your Google Cloud OAuth client JSON and paste it in:" >&2
  echo "    GMAIL_OAUTH_KEYS_B64=\$(base64 -i client_secret_<id>.json | tr -d '\\n')" >&2
  echo "  See .cursor/skills/reporter/servers.md § Gmail for the full flow." >&2
  exit 1
fi

WORK="$(mktemp -d -t mcp_gmail.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

if ! printf %s "${GMAIL_OAUTH_KEYS_B64}" | base64 -d > "${WORK}/gcp-oauth.keys.json" 2>/dev/null; then
  echo "mcp_gmail: failed to base64-decode GMAIL_OAUTH_KEYS_B64. Re-encode the JSON file with:" >&2
  echo "    base64 -i client_secret_<id>.json | tr -d '\\n'" >&2
  exit 1
fi
export GMAIL_OAUTH_PATH="${WORK}/gcp-oauth.keys.json"

if [[ "${1:-}" == "auth" ]]; then
  shift
  export GMAIL_CREDENTIALS_PATH="${WORK}/credentials.json"
  echo "mcp_gmail: starting one-time browser auth flow." >&2
  echo "  Listening on http://localhost:3000/oauth2callback (the Google" >&2
  echo "  Cloud OAuth client must whitelist this URI for Web app keys;" >&2
  echo "  Desktop app keys do not need it)." >&2
  npx -y @gongrzhe/server-gmail-autoauth-mcp auth "$@"
  if [[ ! -s "${GMAIL_CREDENTIALS_PATH}" ]]; then
    echo "mcp_gmail: auth completed but no credentials.json was written to ${GMAIL_CREDENTIALS_PATH}." >&2
    exit 1
  fi
  ENCODED="$(base64 -i "${GMAIL_CREDENTIALS_PATH}" | tr -d '\n')"
  echo
  echo "Auth complete. Add this line to .env (replacing any existing GMAIL_CREDENTIALS_B64):"
  echo
  echo "GMAIL_CREDENTIALS_B64=${ENCODED}"
  echo
  exit 0
fi

if [[ -z "${GMAIL_CREDENTIALS_B64:-}" ]]; then
  echo "mcp_gmail: GMAIL_CREDENTIALS_B64 not set in .env." >&2
  echo "  Run the one-time browser flow:" >&2
  echo "    ./.cursor/skills/reporter/scripts/mcp_gmail.sh auth" >&2
  echo "  Then paste the printed line into .env." >&2
  exit 1
fi

if ! printf %s "${GMAIL_CREDENTIALS_B64}" | base64 -d > "${WORK}/credentials.json" 2>/dev/null; then
  echo "mcp_gmail: failed to base64-decode GMAIL_CREDENTIALS_B64. Re-run \`mcp_gmail.sh auth\`." >&2
  exit 1
fi
export GMAIL_CREDENTIALS_PATH="${WORK}/credentials.json"

exec npx -y @gongrzhe/server-gmail-autoauth-mcp
