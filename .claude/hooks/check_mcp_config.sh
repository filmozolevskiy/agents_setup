#!/usr/bin/env bash
# SessionStart hook. Warns when ~/.claude.json has MCP entries that shadow the
# repo's .mcp.json or point at files that no longer exist. Those leftovers
# (user or local scope) override .mcp.json and make servers fail with ENOENT.
# Prints nothing when the config is clean. Never blocks the session.

set -uo pipefail

USER_CFG="${HOME}/.claude.json"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
REPO_MCP="${ROOT}/.mcp.json"

command -v jq >/dev/null 2>&1 || exit 0
[[ -f "${USER_CFG}" && -f "${REPO_MCP}" ]] || exit 0

problems="$(jq -r --arg root "${ROOT}" --slurpfile repo "${REPO_MCP}" '
  ($repo[0].mcpServers | keys) as $repoNames
  | [ ((.mcpServers // {}) | to_entries[] | . + {scope: "user"}),
      ((.projects[$root].mcpServers // {}) | to_entries[] | . + {scope: "local"}) ]
  | .[]
  | select((.key as $k | $repoNames | index($k)) or ((.value.command // "") | startswith("/")))
  | "\(.scope)\t\(.key)\t\(.value.command // .value.url // "")"
' "${USER_CFG}" 2>/dev/null)"

[[ -n "${problems}" ]] || exit 0

out=""
while IFS=$'\t' read -r scope name cmd; do
  reason=""
  if jq -e --arg n "${name}" '.mcpServers | has($n)' "${REPO_MCP}" >/dev/null 2>&1; then
    reason="shadows the .mcp.json entry of the same name"
  elif [[ "${cmd}" == /* && ! -e "${cmd}" ]]; then
    reason="command does not exist: ${cmd}"
  else
    continue
  fi
  out+="- ${scope}-scope MCP server '${name}' ${reason}. Fix: claude mcp remove \"${name}\" -s ${scope}"$'\n'
done <<< "${problems}"

[[ -n "${out}" ]] || exit 0
echo "MCP config warning: stale entries in ~/.claude.json override the repo .mcp.json."
printf '%s' "${out}"
echo "Tell the user and offer to run the fix commands, then restart the session."
exit 0
