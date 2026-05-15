---
name: notion-assistant
description: >-
  Use when the user wants to read, search, create, or update content in
  Notion — "notion this", "save this to notion", "create a notion page",
  "update the notion doc", "find in notion", "post the QA notes to notion".
  Single-purpose Notion delivery skill that talks to the
  `project-0-agents_setup-Notion` MCP server. All write operations are
  hard-pinned to two permitted roots: **Flighthub QA**
  (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`) and **FlightHub Looker**
  (`360df8c4-9d3f-8061-8286-e5f94e2db16f`). New pages are created as
  children of one of these roots; existing-page updates are allowed only
  if the target's `parent` chain leads back to one of them. Reads /
  searches across the whole workspace are fine.
---

# Notion Assistant

Reach Notion through the `project-0-agents_setup-Notion` MCP. Writes are
scoped to one root page on purpose so the agent cannot mutate unrelated
documents while exploring.

## Scope (fixed)

Two permitted roots. A write is in scope only if the target page IS one
of these roots or its `parent` chain leads back to one of them.

| Root name | URL | ID (dashed) | ID (hyphenless) | What lives there |
|-----------|-----|-------------|-----------------|------------------|
| Flighthub QA | https://www.notion.so/Flighthub-QA-35edf8c49d3f80eea5ffeaaa7aa9b3b9 | `35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9` | `35edf8c49d3f80eea5ffeaaa7aa9b3b9` | QA notes, smoke-test artefacts, ad-hoc reports from `qa_*` skills |
| FlightHub Looker | https://www.notion.so/FlightHub-Looker-360df8c49d3f80618286e5f94e2db16f | `360df8c4-9d3f-8061-8286-e5f94e2db16f` | `360df8c49d3f80618286e5f94e2db16f` | Looker optimization plans (one child page per Looker project), written by the `looker` skill |

Both ID forms work with the API. Prefer the dashed form when passing to
MCP tools for readability; verify with the tool descriptor on first call.

## When to use

- "Create a notion page for <topic> under Flighthub QA."
- "Save these QA notes / this report / this checklist to notion."
- "Update the <name> page in notion."
- "Search notion for <keyword>" / "find <thing> in notion".
- Another skill (`qa_assistant`, `qa_strategy`, `bookability`) wants the
  finished artefact archived in the Flighthub QA tree.

## When NOT to use

- Writing to any Notion page outside the Flighthub QA subtree — refuse
  and ask the user to confirm a new root. Do not silently move scope.
- Drafting the content. The caller hands over the body; this skill
  delivers it. If the body needs more research, return to the topic
  skill (`bookability`, `optimizer`, `qa_*`) first.
- Bulk migration of legacy docs, mailing-list-style fan-out, or anything
  that touches more than a handful of pages in one call. Out of scope.

## MCP server

- Server identifier: `project-0-agents_setup-Notion`.
- Auth: OAuth, handled by Cursor on first use. If the only descriptor in
  `mcps/project-0-agents_setup-Notion/tools/` is `mcp_auth`, stop and
  tell the user to authenticate via Cursor's MCP UI.
- Tool descriptors live under
  `/Users/filippmozolevskiy/.cursor/projects/Users-filippmozolevskiy-Repositories-agents-setup/mcps/project-0-agents_setup-Notion/tools/`.
  Read the descriptor before every call — argument names are the source
  of truth.

| Tool | Used for |
|------|----------|
| `notion-fetch` | Read a page / database by ID or URL. Use first when the user references a target. |
| `notion-search` | Find a page by keyword across the workspace. Read-only. |
| `notion-create-pages` | Create new pages. Always pass `parent.page_id` (or a descendant page ID); never omit `parent`. |
| `notion-update-page` | Edit an existing page's properties / content. Verify the target page is a descendant of the root before calling. |
| `notion-duplicate-page` | Clone a template page. Destination parent must be in scope. |
| `notion-move-pages` | Move pages within the subtree. Refuse if either source or destination is outside scope. |
| `notion-create-comment` / `notion-get-comments` | Comments on in-scope pages only. |
| `notion-create-database` / `notion-update-data-source` / `notion-create-view` / `notion-update-view` | Use only when the user explicitly asks for a database under Flighthub QA. |

## Workflow

### 1. Resolve the target

- **Creating a new page:** the caller picks the root. Default to
  Flighthub QA (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`) unless the
  request is clearly Looker-related (a new optimization plan, a tile
  audit, anything from the `looker` skill) — then default to FlightHub
  Looker (`360df8c4-9d3f-8061-8286-e5f94e2db16f`). If the user names a
  sub-section ("under the Smoke Tests page"), `notion-search` or
  `notion-fetch` to find that sub-page's ID, confirm it is a descendant
  of one of the permitted roots, then use it as `parent.page_id`.
- **Updating an existing page:** the caller passes the page URL or ID.
  Call `notion-fetch` first. Walk `parent` references upward until you
  hit one of the two root IDs. If neither is reached, refuse and tell
  the user the target is outside scope.

### 2. Read the descriptor for the chosen tool

Open the matching `.json` under the MCP folder above. Map the caller's
fields onto the descriptor's argument names exactly. If the descriptor
disagrees with this SKILL.md, the descriptor wins and this file gets
patched.

### 3. Call the tool

One call per intent. Capture the response — page ID, URL, and any
properties the API echoes back. Surface those to the caller as
proof-of-write.

### 4. Confirm

- **Success:** report the new / updated page URL, the action taken
  (create / update / duplicate / move), and the parent page name.
- **Failure:** surface the MCP error verbatim and stop. Do not retry
  on a different parent. Do not re-target to "a safe default".

## Content conventions

- **Title:** use the caller's exact title. Keep it short, sentence case.
- **Body:** Notion-flavored Markdown — see the resource
  `notion://docs/enhanced-markdown-spec` (fetch it on first session).
  Do NOT include the title as a `#` heading inside `content`; the title
  comes from `properties.title`.
- **Icons / covers:** only when the caller asks. No default emoji.
- **Date properties** (if writing into a database): split into
  `date:<name>:start`, `date:<name>:end`, `date:<name>:is_datetime` per
  the descriptor.

## What not to do

- Do not create a page outside the two permitted subtrees (Flighthub
  QA, FlightHub Looker). If the user asks for one, refuse and ask them
  to confirm a new root (and update this SKILL.md in the same change).
- Do not omit `parent` on `notion-create-pages` — the descriptor
  defaults to a workspace-level private page, which violates the scope
  rule silently.
- Do not modify pages whose `parent` chain you have not verified leads
  back to the root.
- Do not duplicate or move pages across the scope boundary in either
  direction.
- Do not draft the body. The caller hands it over finished.
- Do not write tool argument names from memory — read the descriptor.

## References

- Notion enhanced-markdown spec (MCP resource):
  `notion://docs/enhanced-markdown-spec`.
- MCP tool descriptors:
  `/Users/filippmozolevskiy/.cursor/projects/Users-filippmozolevskiy-Repositories-agents-setup/mcps/project-0-agents_setup-Notion/tools/`.
- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
