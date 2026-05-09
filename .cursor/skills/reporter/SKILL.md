---
name: reporter
description: >-
  Use when another skill, agent, or the user needs to deliver a message to a
  specific person or group via Gmail or Slack — "email <name> the result",
  "slack <channel> when this finishes", "DM <user> the report", "ping
  <group> with the summary", "send a notification when X completes",
  "report this to <person>", "notify <team>". Single-purpose delivery skill:
  it sends what the caller hands it via the configured Gmail / Slack MCP
  servers and stops. Does not draft, summarise, look up recipients by
  name, or fetch any data on its own.
---

# Reporter

Deliver a message the caller already prepared to a recipient the caller
already named, via Gmail or Slack. That is the entire job. The skill
exists so notification logic stops being copy-pasted into every other
skill and so the agent always reads the underlying MCP tool schema
before sending anything.

## When to use

- Another skill or the user wants a result, alert, or status update
  delivered to a person, channel, or group.
- The caller already knows **what to send** (subject + body for email,
  body for Slack) and **where to send it** (an email address, a Slack
  user / channel ID, a Slack channel name).
- "Email me when the QA run finishes." / "Slack #content-integration the
  weekly grooming report." / "DM Filipp the failure summary."

## When NOT to use

- The caller does not yet know the content. Draft the content in the
  skill that owns the topic (e.g. `bookability_analysis`,
  `trello_assistant`), then hand the finished message to this skill.
- The caller knows only a person's display name ("send it to Sergey").
  Resolve the address / Slack ID first (ask the user, or use the
  appropriate directory MCP); this skill takes literal recipients only.
- The delivery channel is anything other than Gmail or Slack (Trello
  comment, GitHub PR comment, Looker dashboard, etc.). Use the channel's
  own skill or MCP; do not bend this skill into a general dispatcher.
- Bulk send / mailing list / templated marketing email. Out of scope.

## Inputs (mandatory)

The caller passes a single delivery request with these fields:

| Field | Required for | Shape |
|------|-------------|--------|
| `channel` | always | `"gmail"` or `"slack"` |
| `recipient` | always | Gmail: one or more email addresses (string or list). Slack: a Slack user ID (`U…`), DM target (`@username`), channel ID (`C…`), or channel name (`#content-integration`). |
| `subject` | gmail only | One short line. No markdown, no newlines. |
| `body` | always | Markdown the caller already finalised. |
| `cc` / `bcc` | gmail, optional | Same shape as `recipient`. |
| `thread_ts` | slack, optional | Reply in a thread instead of posting top-level. |

If any mandatory field is missing or ambiguous, stop and ask the user
for it. Do not invent a recipient or a subject. Do not fall back to a
"default channel" — silent misdelivery is worse than a missing send.

## MCP servers (configured per environment)

This skill drives whichever Gmail and Slack MCP servers are wired into
the project. Discover the actual server identifiers and tool names at
runtime:

1. List MCP servers and look for the Gmail / Slack ones — names usually
   contain `gmail`, `google-mail`, `slack`, etc.
2. Read each tool's JSON descriptor under
   `mcps/<server>/tools/<tool>.json` **before** the first call. The
   descriptors are the source of truth for argument names; do not guess.
3. If neither a Gmail nor a Slack MCP is installed for the channel the
   caller asked for, stop and tell the user. Do not silently fall back
   to the other channel.

Document the chosen server identifiers in
[`servers.md`](./servers.md) once they are confirmed for this repo so
future invocations do not repeat the discovery. Until that file exists,
the discovery step above is mandatory every session.

## Workflow

### 1. Validate the request

Confirm `channel`, `recipient`, and (for Gmail) `subject` are present
and concrete. Reject display-name-only recipients ("Filipp",
"the content team") — ask for the email / Slack ID instead.

### 2. Pick the MCP tool

| Channel | Look for a tool that does | Common names |
|---------|--------------------------|--------------|
| Gmail   | Send a message            | `send_email`, `send_message`, `gmail_send` |
| Slack   | Post to channel / DM      | `post_message`, `chat_postMessage`, `send_message` |

Read the descriptor (`mcps/<server>/tools/<tool>.json`). Map the
caller's fields onto the descriptor's argument names exactly — the
mapping below is conventional but the descriptor wins on every
mismatch.

| Caller field | Gmail (typical) | Slack (typical) |
|--------------|-----------------|-----------------|
| `recipient`  | `to`            | `channel` |
| `subject`    | `subject`       | — |
| `body`       | `body` / `text` | `text` / `blocks` |
| `cc`         | `cc`            | — |
| `bcc`        | `bcc`           | — |
| `thread_ts`  | —               | `thread_ts` |

### 3. Send

Call the MCP tool with the mapped arguments. Capture the response: for
Gmail, the message ID / thread ID; for Slack, the `ts` and `channel`
the API echoed back. The agent reports those IDs to the caller as
proof-of-delivery.

### 4. Confirm or fail loud

- **Success:** report the channel, the recipient (verbatim), the
  message ID / `ts`, and a one-line preview of the subject (Gmail) or
  the first line of the body (Slack). Nothing else.
- **Failure:** surface the MCP error verbatim and stop. Do not retry on
  a different channel, a different recipient, or with a truncated
  body. The caller decides what to do next.

## Body conventions

The caller hands over the body. The skill does not rewrite it. Two
small adapters are allowed because they are channel-mechanical, not
editorial:

- **Gmail:** if the caller's body is markdown, send it as-is in the
  plain-text part. Render to HTML only when the MCP descriptor exposes
  an `html` argument **and** the caller explicitly asked for it.
- **Slack:** strip the leading `# ` from any markdown headings (Slack
  renders them as literal `#`). Keep the rest of the markdown intact —
  Slack's mrkdwn covers `*bold*`, `_italic_`, `` `code` ``, and links.

Do not add signatures, footers, "sent by an AI agent" prefixes,
disclaimers, or emoji. The caller's body is the message.

## What not to do

- Do not draft the message. The caller passes a finished body.
- Do not look up a recipient by name. The caller passes a literal
  address / Slack ID.
- Do not fetch data, run queries, or call other skills mid-send. If the
  body needs more content, return to the caller for it.
- Do not silently switch channels (Gmail outage → "I'll Slack it
  instead"). One channel per request.
- Do not retry indefinitely on failure. One attempt; surface the error.
- Do not log the body content into `reports/` or anywhere else by
  default. The MCP server's own logs are the audit trail.
- Do not invent MCP tool argument names. Read the descriptor.

## References

- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
- Card the skill was built against:
  [0dDzFejq — Reporter skill (Gmail + Slack)](https://trello.com/c/0dDzFejq).
- Server identifiers (filled in once confirmed):
  [`servers.md`](./servers.md) — currently absent; populate on first run.
