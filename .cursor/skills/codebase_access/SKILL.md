---
name: codebase-access
description: >-
  Use when any task needs to read FlightHub / JustFly application code —
  either the backend ("genesis" repo) or the front-end ("genesis-storefront"
  repo, which renders home/search/checkout): tracing how a flow is
  implemented, finding the function/component that builds a payload or
  renders a tile, confirming runtime behaviour, answering "where in the
  codebase…" / "show me the code that…" / "how does X work in genesis" /
  "what does the checkout page render for Y", or producing evidence that
  cites a file path and line range. Always runs `sync_genesis.sh` first so
  the agent reads the current production state, not a stale local clone.
  Scope is genesis + genesis-storefront only — no other application
  repositories are covered here.
---

# Codebase access (genesis + genesis-storefront)

Single entry point any DB-touching, bookability, optimizer, or QA skill
uses when it needs to read application code. Owns the local clone paths
for both repos, the sync script, and the rule that each clone is
fast-forwarded to production before any read.

- **genesis** — the PHP backend/API (booking rules, GDS command issuers,
  pricing, everything under `src/` and `include/`).
- **genesis-storefront** — the front-end (Vite/TS) that renders the
  Home, Search, and Checkout pages, including the booking-rules tiles
  that consume genesis's API. Use this repo when a question is about
  what a customer actually sees/does in the browser, not just what the
  API returns.

## When to use

- Question requires reading genesis code: "where do we set X header",
  "which class handles Y request", "what does method Z do", "find the
  PHP file that maps PTC to passenger age".
- Question requires reading genesis-storefront code: "what does the
  checkout page show when refund is unknown", "which component renders
  the fare-family upsell", "where does the front-end call
  get-booking-rules".
- Producing evidence that cites a file path + line range from either
  repo for a Trello card, PR review, debugging note, or chat reply.
- Cross-referencing a DB column / table to the code that writes or reads
  it.
- Any other skill (`bookability`, `optimizer`,
  `qa_assistant`) is about to grep either tree — load this skill first
  so the sync runs and the paths are canonical.

## When NOT to use

- Question is satisfied by `db-docs/`, a known query, an MCP tool
  response, or the user's own message. Do not pull genesis code "just
  to confirm" something already documented.
- Code lives in a repo other than genesis / genesis-storefront (e.g.
  internal LookML, MCP servers, this `agents_setup` repo). This skill
  only covers those two.
- Read-only skim of a single file the user already pasted. No sync
  needed.

## Inventory (fixed)

| Item | Path / value |
|------|--------------|
| Sync script | `.cursor/skills/codebase_access/scripts/sync_genesis.sh` |
| genesis local clone (default) | `.cursor/skills/codebase_access/codebase/` |
| genesis `.env` variable for clone path | `GENESIS_PATH` |
| genesis `.env` variable for branch | `GENESIS_BRANCH` (defaults to `develop` — genesis `HEAD` branch) |
| genesis remote | `https://github.com/mventures/genesis` |
| genesis-storefront local clone (default) | `.cursor/skills/codebase_access/codebase-storefront/` |
| genesis-storefront `.env` variable for clone path | `STOREFRONT_PATH` |
| genesis-storefront `.env` variable for branch | `STOREFRONT_BRANCH` (defaults to `develop` — genesis-storefront `HEAD` branch) |
| genesis-storefront remote | `https://github.com/mventures/genesis-storefront` |

Both `*_PATH` variables may point anywhere on disk (clones do not have
to sit inside `agents_setup`). The skill respects whatever path is set;
the default locations only matter when scaffolding a fresh checkout.
The sync script reads `.env` at the `agents_setup` repo root, so both
clone paths stay user-configurable. Either repo is optional — if a
`*_PATH` variable is unset or its directory is not a git repo, the sync
script skips that repo (logs a notice, non-fatal) and continues with
the other.

## Workflow

Two steps, in this order, every time the skill is invoked:

1. **Sync first.** Run the sync script before any code read:

   ```bash
   .cursor/skills/codebase_access/scripts/sync_genesis.sh
   ```

   The script fast-forwards each configured repo to its branch
   (`$GENESIS_BRANCH` / `$STOREFRONT_BRANCH`, default `develop`) and
   exits non-fatally on any failure (no network, dirty tree,
   non-existent path, repo not configured) so it never blocks the
   calling tool. Stale reads are worse than slightly delayed reads —
   never skip the sync to save a second.

2. **Read against the synced clone(s).** Use `Grep` / `Read` /
   `SemanticSearch` against `$GENESIS_PATH` for backend questions and
   `$STOREFRONT_PATH` for front-end/rendering questions. When citing
   code in chat, on a card, or in a PR, paste the exact path + line
   range so the reviewer can navigate to it. Quote runtime evidence (DB
   rows, log permalinks, MCP responses, screenshots) alongside the code
   to keep claims grounded — code excerpts alone are not proof of
   behaviour.

## What not to do

- Do not skip the sync. Every invocation of the skill begins with
  `sync_genesis.sh`. A stale clone has produced bookability cards
  citing code that no longer exists in production.
- Do not commit any file from `$GENESIS_PATH` or `$STOREFRONT_PATH`
  into this repo. The default checkout locations
  (`.cursor/skills/codebase_access/codebase/` and
  `.cursor/skills/codebase_access/codebase-storefront/`) are gitignored
  and must stay that way.
- Do not point `GENESIS_PATH` / `STOREFRONT_PATH` at a long-lived
  feature branch checkout. The skill assumes production-tracking
  state. Keep feature-branch exploration in a separate clone the agent
  does not touch.
- Do not paste large files inline in chat / cards / PRs. Cite the file
  path + line range. The skill exists to make those citations cheap.
- Do not extend this skill to repositories other than genesis /
  genesis-storefront. Each other application repo gets its own skill
  or stays out of scope.

## References

- Sync script: `.cursor/skills/codebase_access/scripts/sync_genesis.sh`
- `.env.example` for sample `GENESIS_PATH` / `GENESIS_BRANCH` /
  `STOREFRONT_PATH` / `STOREFRONT_BRANCH` values.
- Skill scaffolding rules: `.cursor/skills/skill_creator/SKILL.md`.
