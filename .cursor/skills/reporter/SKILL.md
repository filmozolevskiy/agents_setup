---
name: reporter
description: >-
  Use when another skill, agent, or the user needs to deliver a finished
  message to a specific Slack recipient — "slack <channel> when this
  finishes", "DM <user> the report", "ping <group> with the summary",
  "send a notification when X completes", "report this to <person>",
  "notify <team>". Single-purpose Slack delivery skill: it sends what
  the caller hands it via Cursor's Slack plugin and stops. Does not
  draft, summarise, look up recipients by name, or fetch any data on
  its own. Gmail was originally in scope but is removed for now (no
  sender access); see servers.md if/when it comes back.
---

# Reporter

Deliver a Slack message the caller already prepared to a recipient the
caller already named. That is the entire job. The skill exists so
notification logic stops being copy-pasted into every other skill and
so the agent always reads the underlying MCP tool schema before
sending anything.

## When to use

- Another skill or the user wants a result, alert, or status update
  delivered to a Slack person, channel, or group.
- The caller already knows **what to send** (a finished markdown body)
  and **where to send it** (a Slack user ID, DM ID, channel ID, or
  channel name).
- "Slack #content-integration the weekly grooming report." / "DM
  Filipp the failure summary." / "Ping the optimizer team when the
  audit is ready."

## When NOT to use

- The caller does not yet know the content. Draft the content in the
  skill that owns the topic (e.g. `bookability`,
  `trello_assistant`), then hand the finished message to this skill.
- The caller knows only a person's display name ("send it to Sergey").
  Resolve the Slack ID first (ask the user, or use the appropriate
  directory MCP); this skill takes literal recipients only.
- The delivery channel is anything other than Slack (Trello comment,
  GitHub PR comment, Looker dashboard, email, etc.). Use the
  channel's own skill or MCP; do not bend this skill into a general
  dispatcher.
- Bulk send / mailing list / templated marketing message. Out of scope.

## Inputs (mandatory)

The caller passes a single delivery request with these fields:

| Field | Required | Shape |
|------|----------|-------|
| `recipient` | always | A Slack user ID (`U…`), DM ID (`D…`), channel ID (`C…`), or channel name (`#content-integration`). Whichever the descriptor accepts wins; verify on first run. |
| `body` | always | Markdown the caller already finalised. |
| `thread_ts` | optional | Reply in a thread instead of posting top-level. |

If any mandatory field is missing or ambiguous, stop and ask the user
for it. Do not invent a recipient. Do not silently substitute a
"default channel" — silent misdelivery is worse than a missing send.

## MCP server (configured per environment)

The configured server, send-tool name, and argument mapping for this
repo live in [`servers.md`](./servers.md) — read it first. Current
wiring: `plugin-slack-slack` (Cursor's first-party Slack plugin; auth
managed by Cursor, no `.env` vars).

Before the first call in a fresh session:

1. Read [`servers.md`](./servers.md) for the cached identifier and
   argument table.
2. Read the send tool's JSON descriptor under
   `mcps/plugin-slack-slack/tools/<tool>.json` to confirm the argument
   names — the descriptor is the source of truth and overrides
   `servers.md` when they disagree. If they disagree, fix
   `servers.md` in the same change.
3. If the only descriptor present is `mcp_auth`, the plugin has not
   been authenticated yet — stop and tell the user to run
   `mcp_auth` (or use Cursor's plugin settings UI). Do not try to
   send.

## Workflow

### 1. Validate the request

Confirm `recipient` and `body` are present and concrete. Reject
display-name-only recipients ("Filipp", "the content team") — ask for
the Slack ID or channel name instead.

### 2. Pick the MCP tool

Look for a tool that posts a message — common names: `post_message`,
`chat_postMessage`, `send_message`, `send_dm`. Read the descriptor
(`mcps/plugin-slack-slack/tools/<tool>.json`). Map the caller's fields
onto the descriptor's argument names exactly — the table in
[`servers.md`](./servers.md) is conventional but the descriptor wins
on every mismatch.

### 3. Send

Call the MCP tool with the mapped arguments. Capture the response:
the `ts` and `channel` the API echoed back. The agent reports those
IDs to the caller as proof-of-delivery.

### 4. Confirm or fail loud

- **Success:** report the recipient (verbatim), the `ts`, and the
  first line of the body. Nothing else.
- **Failure:** surface the MCP error verbatim and stop. Do not retry
  on a different recipient or with a truncated body. The caller
  decides what to do next.

## Body conventions

The caller hands over the body. The skill does not rewrite it. One
small adapter is allowed because it is channel-mechanical, not
editorial:

- Strip the leading `# ` from any markdown headings (Slack renders
  them as literal `#`). Keep the rest of the markdown intact —
  Slack's mrkdwn covers `*bold*`, `_italic_`, `` `code` ``, and
  links.

Do not add signatures, footers, "sent by an AI agent" prefixes,
disclaimers, or emoji. The caller's body is the message.

## What not to do

- Do not draft the message. The caller passes a finished body.
- Do not look up a recipient by name. The caller passes a literal
  Slack ID or channel name.
- Do not fetch data, run queries, or call other skills mid-send. If
  the body needs more content, return to the caller for it.
- Do not retry indefinitely on failure. One attempt; surface the
  error.
- Do not log the body content into `reports/` or anywhere else by
  default. The MCP server's own logs are the audit trail.
- Do not invent MCP tool argument names. Read the descriptor.
- Do not re-add Gmail (or any other channel) on your own. If a caller
  asks for a non-Slack delivery, refuse and point at the parent card
  ([VRYfNyBs](https://trello.com/c/VRYfNyBs)) — Gmail was removed
  deliberately and re-adding it needs a fresh card.

## References

- Configured servers + setup: [`servers.md`](./servers.md).
- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
- Cards the skill was built against:
  [0dDzFejq — Reporter skill (Gmail + Slack)](https://trello.com/c/0dDzFejq),
  [VRYfNyBs — Smoke-test reporter end-to-end](https://trello.com/c/VRYfNyBs).
