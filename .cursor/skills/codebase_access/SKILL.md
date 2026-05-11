---
name: codebase-access
description: >-
  Use when any task needs to read the FlightHub / JustFly application code
  (the "genesis" repo): tracing how a flow is implemented, finding the
  function that builds a payload, confirming runtime behaviour, answering
  "where in the codebase…" / "show me the code that…" / "how does X work
  in genesis", or producing evidence that cites a file path and line range.
  Always runs `sync_genesis.sh` first so the agent reads the current
  production state, not a stale local clone. Scope is the genesis repo
  only — no other application repositories are covered here.
---

# Codebase access (genesis)

Single entry point any DB-touching, bookability, optimizer, or QA skill
uses when it needs to read application code. Owns the local genesis
clone path, the sync script, and the rule that the clone is fast-forwarded
to production before any read.

## When to use

- Question requires reading genesis code: "where do we set X header",
  "which class handles Y request", "what does method Z do", "find the
  PHP file that maps PTC to passenger age".
- Producing evidence that cites a file path + line range from genesis
  for a Trello card, PR review, debugging note, or chat reply.
- Cross-referencing a DB column / table to the code that writes or reads
  it.
- Any other skill (`bookability`, `optimizer`,
  `qa_assistant`) is about to grep the genesis tree — load this skill
  first so the sync runs and the path is canonical.

## When NOT to use

- Question is satisfied by `db-docs/`, a known query, an MCP tool
  response, or the user's own message. Do not pull genesis code "just
  to confirm" something already documented.
- Code lives in a non-genesis repo (e.g. internal LookML, MCP servers,
  this `agents_setup` repo). This skill only covers genesis.
- Read-only skim of a single file the user already pasted. No sync
  needed.

## Inventory (fixed)

| Item | Path / value |
|------|--------------|
| Sync script | `.cursor/skills/codebase_access/scripts/sync_genesis.sh` |
| Local clone (default) | `.cursor/skills/codebase_access/codebase/` |
| `.env` variable for clone path | `GENESIS_PATH` |
| `.env` variable for production branch | `GENESIS_BRANCH` (defaults to `develop` — the genesis `HEAD` branch) |
| Genesis remote | `https://github.com/mventures/genesis` |

`GENESIS_PATH` may point anywhere on disk (the clone does not have to
sit inside `agents_setup`). The skill respects whatever path is set;
the new default location only matters when scaffolding a fresh
checkout. The sync script reads `.env` at the `agents_setup` repo root,
so the clone path stays user-configurable.

## Workflow

Two steps, in this order, every time the skill is invoked:

1. **Sync first.** Run the sync script before any code read:

   ```bash
   .cursor/skills/codebase_access/scripts/sync_genesis.sh
   ```

   The script fast-forwards `$GENESIS_BRANCH` (default `develop`) and
   exits non-fatally on any failure (no network, dirty tree,
   non-existent path) so it never blocks the calling tool. Stale
   reads are worse than slightly delayed reads — never skip the sync
   to save a second.

2. **Read against the synced clone.** Use `Grep` / `Read` /
   `SemanticSearch` against `$GENESIS_PATH`. When citing code in chat,
   on a card, or in a PR, paste the exact path + line range so the
   reviewer can navigate to it. Quote runtime evidence (DB rows, log
   permalinks, MCP responses) alongside the code to keep claims
   grounded — code excerpts alone are not proof of behaviour.

## What not to do

- Do not skip the sync. Every invocation of the skill begins with
  `sync_genesis.sh`. A stale clone has produced bookability cards
  citing code that no longer exists in production.
- Do not commit any file from `$GENESIS_PATH` into this repo. The
  default checkout location (`.cursor/skills/codebase_access/codebase/`)
  is gitignored and must stay that way.
- Do not point `GENESIS_PATH` at a long-lived feature branch checkout.
  The skill assumes production-tracking state. Keep feature-branch
  exploration in a separate clone the agent does not touch.
- Do not paste large genesis files inline in chat / cards / PRs.
  Cite the file path + line range. The skill exists to make those
  citations cheap.
- Do not extend this skill to non-genesis repositories. Each
  application repo gets its own skill or stays out of scope.

## References

- Sync script: `.cursor/skills/codebase_access/scripts/sync_genesis.sh`
- `.env.example` for sample `GENESIS_PATH` / `GENESIS_BRANCH` values.
- Skill scaffolding rules: `.cursor/skills/skill_creator/SKILL.md`.
