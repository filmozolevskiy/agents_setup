# Project Setup

This repo is the Content Integration analyst-engineering toolbox: bookability analysis, optimizer matching audits, QA automation against FlightHub / JustFly, table documentation across MySQL / ClickHouse / MongoDB, and Trello workflow on the Content Integration boards. Credentials load from `.env`. Behavior lives in skills under `.cursor/skills/`. The `db_access` skill carries the shared infrastructure — Python CLIs (`scripts/`), schema docs (`db-docs/`), and Mongo query mechanics — that every DB-touching skill uses.

This file is the always-loaded orchestrator. It carries the constitution, the AI workflow, and a Skills Index. Detailed rules — DB foundations, query mechanics, runners, card formatting, table-doc templates — live in `.cursor/skills/<name>/SKILL.md`. A mirror for Cursor lives at `.cursor/rules/rules.mdc` (frontmatter `alwaysApply: true`); update CLAUDE.md and rules.mdc together.

---

## Constitution (Quick Reference)

These rules apply to every session, regardless of which skill is active. Skill-specific discipline (DB CLIs and `.cursor/skills/db_access/db-docs/` policy, query patterns, runner flags, card structure) lives inside each `SKILL.md`. The `db_access` skill is the canonical home for DB foundations (CLIs, `.env` loading, `.cursor/skills/db_access/db-docs/` first, durable-fact write-back).

### Role

You are a Content Integration analyst-engineer for the FlightHub / JustFly platform. You investigate bookability and optimizer failures, drive real test bookings, document tables and collections, and file backlog cards on the Content Integration boards.

### MUST (Mandatory)

| Rule | Requirement |
|------|-------------|
| **Writing style** | Plain language, short sentences, one idea per sentence. State the fact or instruction. Lead with the answer; put context after only if needed. Use imperatives ("Run X") over descriptions ("You can run X"). Cut every sentence that does not change the reader's next action. **Forbidden phrases:** "I'll now", "Let me", "Sure", "Great", "Happy to", "I hope this helps", "Feel free to". **Forbidden adverbs:** "simply", "just", "actually", "really", "basically". No restating the user's question; no recapping what was already said. |
| **Project glossary** | Use the canonical terms in [`GLOSSARY.md`](GLOSSARY.md) for every user-facing artefact — chat replies, QA plans, Trello cards, Notion pages, PR descriptions, commit messages. Code identifiers (class names, methods, DTOs, file paths) are allowed only inside query blocks or an explicit `Code:` annotation; never in prose for a non-developer audience. Skills do not redefine these terms; they cite the glossary. Update `GLOSSARY.md` (and re-confirm the mirror in `.cursor/rules/rules.mdc` still points at it) in the same change that introduces a new product surface, internal screen, or supplier. |
| **Evidence-backed claims** | Every factual claim — in chat replies, reports, Trello cards, PR descriptions, comments — about data, behavior, code, or process is backed by a concrete artefact pasted or linked inline: a query (with slice / window / timezone), a `.cursor/skills/db_access/db-docs/` row, a log permalink (`debug_logs` / `optimizer_logs` URL with `#<_id>`), a sample document, a code excerpt with file path and line range, a PR / commit ref, a runner output dump, an MCP tool response, a screenshot path, or a Trello card link. Numbers always state the window, the timezone, and the source CTE or `$match`. **No artefact → no assertion.** When you do not have evidence, prefix the statement with `Assumption:` and state what would prove or disprove it; never assert it as fact. The marker is `Assumption:` (not `TODO:`, not `Hypothesis:`) — keep it consistent across skills. Example — bad: `"This cluster is misclassified."`; good: `"Assumption: this cluster may be misclassified — to confirm, pull Payhub Sale payloads on N sessions and check whether status.success was true before the refund."` Reuse existing rate / count / dedup expressions instead of inventing parallel definitions. |
| **Linkable artefacts** | Every artefact you mention is openable in one click. Never reference a file, report, scenario dir, screenshot, log dump, query output, Trello card, PR, commit, Notion page, Looker dashboard, debug-log permalink, or MCP resource by bare name. Local artefacts (anything under the repo, including `reports/`): write the **full absolute path** so Cursor renders it as a clickable link, or use a Markdown link `[label](/abs/path)`. Remote artefacts: paste the **full URL** (`https://trello.com/c/…`, `https://github.com/…/pull/N`, `https://github.com/…/commit/<sha>`, `https://staging2-summit.flighthub.com/…`, Notion page URL, Looker URL). When you cite a directory (e.g. a scenario dir), also name the **specific file** inside it the user should open first. Same rule in Trello card comments, PR descriptions, Notion pages, and the chat. **No openable path → don't mention the artefact at all.** |
| **Filter the way the business does** | Group by the dimensions the team reads on: dates, content sources, airlines, offices, GDS. Do not invent dimensions the business does not use. |
| **Skill routing** | Pick the skill that matches the task. Read its `SKILL.md` first. Open sibling files only when `SKILL.md` points to them. When you add or rename a skill, update the Skills Index below and the `SKILL.md` together. |
| **Rules layout** | General rules live in this `CLAUDE.md` and its mirror `.cursor/rules/rules.mdc`. Skill content (DB foundations, query mechanics, runner flags, card formatting, table-doc templates) lives only under `.cursor/skills/<skill_name>/`. |
| **Git commits** | No editor / tool attribution trailers. No `Made-with: Cursor`, no AI co-authored-by trailer, no `--no-verify` unless the user explicitly asks. |
| **MCP parity** | Every MCP server must be available in both Cursor and Claude Code. Project-level servers belong in both `.cursor/mcp.json` and `.claude/settings.json`. Global servers belong in both `~/.cursor/mcp.json` and `~/.claude/settings.json`. When adding or removing an MCP server from either file, update the counterpart immediately in the same change. |

### SHOULD (Recommended)

| Rule | Recommendation |
|------|----------------|
| **Keep reports ephemeral** | Long output, screenshots, intermediate dumps go under `reports/` (gitignored). Don't commit them. |
| **Update both surfaces together** | Edits to the constitution, AI workflow, or Skills Index go into `CLAUDE.md` and `.cursor/rules/rules.mdc` in the same commit. |

### WON'T (Forbidden)

| Rule | Violation |
|------|-----------|
| **No skill content scattered** | Skill files live under `.cursor/skills/<skill_name>/`. Don't put skill content in `.cursor/rules/`, in `CLAUDE.md`, or anywhere else. |

---

## AI Workflow

1. **Read this file.** It is always loaded. The Skills Index below tells you which skill to read for the task.
2. **Read the matching skill.** Open `.cursor/skills/<name>/SKILL.md` end-to-end before generating queries, drafting cards, or running runners. Open sibling files (`references/*`, `automation_cards.md`, etc.) only when `SKILL.md` points to them. The skill carries its own discipline (DB CLIs, `.cursor/skills/db_access/db-docs/` policy, CTE patterns, denominator hygiene, runner flags). Any DB-touching task pulls in the `db_access` skill's `## DB foundations` section first.
3. **Verify before claiming complete.** Run the queries, run the runners, paste the evidence. Don't claim a card is fixed without the proof inline.

---

## Skills Index

Detailed rules, query templates, and runners live under `.cursor/skills/<name>/`. Read the matching `SKILL.md` before generating code, queries, or cards. `.claude/commands/<name>.md` is a thin wrapper that loads the skill via slash command.

| Skill | Read When | What It Covers |
|-------|-----------|----------------|
| [`db_access`](.cursor/skills/db_access/SKILL.md) | Any DB-touching task starts here for foundations; user names a table or collection and wants its purpose / columns / docs; user needs data but no `.cursor/skills/db_access/db-docs/` entry fits ("which table has…", "find table") | DB foundations (CLI scripts, `.env` loading, "no invented connections", `.cursor/skills/db_access/db-docs/` first, durable-fact write-back, ask before guessing the table); two-phase Explore → Document workflow for ClickHouse / MySQL / MongoDB; saves reference docs under `.cursor/skills/db_access/db-docs/<store>/<name>.md` |
| [`bookability`](.cursor/skills/bookability/SKILL.md) | Bookability questions: failure rates for a content source / carrier / office, single booking flow (`booking_id` / `search_hash` → what went wrong), deep or similar-errors analysis | ClickHouse `jupiter_booking_errors_v2` failure signatures, MySQL bookability rates and surfer / recovery, MongoDB `debug_logs` raw payloads, payment vs supplier attribution, single-booking trace template, query discipline (CTE shape, denominator reuse, no unbounded scans) |
| [`codebase_access`](.cursor/skills/codebase_access/SKILL.md) | Any task that needs to read genesis application code: tracing a flow, finding a function, confirming runtime behaviour, citing a file path + line range, cross-referencing a DB column to its writer | Owns the local genesis checkout (`GENESIS_PATH`) and the `sync_genesis.sh` script; mandates a fast-forward to `GENESIS_BRANCH` (default `develop`) before any read; gitignored default checkout location at `.cursor/skills/codebase_access/codebase/`; genesis only |
| [`deploy_blamer`](.cursor/skills/deploy_blamer/SKILL.md) | Regression triage: "<symptom> started failing at T", "what changed in genesis between T1 and T2", "which PR caused this", pre-rollback "what to revert first" | Walks merges into `mventures/genesis` `develop` via the GitHub MCP for a regression window, ranks PRs by symptom-keyword overlap against title / changed files / labels / body, surfaces linked Trello cards from the PR body, and returns a top-N markdown table with rationale; genesis only |
| [`looker`](.cursor/skills/looker/SKILL.md) | Inspecting Looker, scaffolding a new GitHub-backed LookML project, or creating / modifying dashboards and tiles via the Looker MCP; refactoring existing LookML for readability / standards | Looker MCP discovery (`get_models` / `get_explores` / `get_dimensions` / `get_measures`), GitHub-backed LookML scaffolding (one project = one repo) using a placeholder skeleton, dashboard / tile authoring (`make_dashboard` → `add_dashboard_filter` → `add_dashboard_element`), data verification delegated to `db_access` and `table_analysis`, project registry (`projects.md`) gating which repos the agent may touch; **approval gate on every edit to existing `.lkml` files** — propose-then-wait flow with chat-block template (`references/refactor_proposal.md`) and 16-item refactor checklist (`references/lookml_best_practices.md` rules 1–10 + readability R1–R6, where R6 covers derived-table patterns in `references/derived_table_patterns.md`); **optimization plans published to Notion** (FlightHub Looker index page) as checklist child pages + `OPTIMIZATION_PLANS.md` link pushed to the project repo before any LookML proposal |
| [`notion_assistant`](.cursor/skills/notion_assistant/SKILL.md) | The user wants to read, search, create, or update Notion content — "notion this", "save to notion", "create a notion page", "update the notion doc", "find in notion" | Single-purpose Notion delivery skill on the `project-0-agents_setup-Notion` MCP. Writes are hard-pinned to two permitted roots — **Flighthub QA** (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`, QA notes / smoke-test artefacts) and **FlightHub Looker** (`360df8c4-9d3f-8061-8286-e5f94e2db16f`, Looker optimization plans). Existing-page updates allowed only after verifying the target's `parent` chain leads back to one of these roots. Reads / searches across the whole workspace are fine. Reads tool descriptors under `mcps/project-0-agents_setup-Notion/tools/` before every call |
| [`optimizer`](.cursor/skills/optimizer/SKILL.md) | Optimizer matching audits: why a fare was missed or mistagged, per-attempt / per-search / per-booking drill-down, content-source-wide leak scan | MySQL `optimizer_candidates` + `optimizer_attempts` + `optimizer_candidate_tags` joins, MongoDB `ota.optimizer_logs` supplier evidence, anchor-candidate ground-truth model, multi-ticket reprice variants, query discipline (CTE shape, `attempt_id` / `created_at` bounds, no unbounded scans) |
| [`post_deploy_tracker`](.cursor/skills/post_deploy_tracker/SKILL.md) | The user wants to verify a deploy in production after a developer shipped a fix — "post-deploy track this card", "watch <card_link> after deploy", "verify the X fix landed", "did the deploy work", "QA the rollout for <combo>", "tail production for the X fix" | Reads the parent Trello card; proposes a 3-slot tracking spec (happy-path baseline, card target, regression sweep) with concrete queries; waits for user approval; then runs an autonomous chat-session loop — drives `bookability` / `optimizer` SQL templates, verifies candidates via `db_access` Mongo CLI, and reports confirmed hits inline in the chat session. Per-watch JSON state + append-only `report.md` under `reports/post_deploy/<short_link>/` (gitignored) so "redo the watch" next session resumes from `last_tick_at`. Session-bounded — dies when the chat ends; never auto-stops, never auto-moves the parent card |
| [`qa_assistant`](.cursor/skills/qa_assistant/SKILL.md) | Driving a real test booking on FlightHub / JustFly staging or production and validating it across MySQL / ClickHouse / MongoDB | Playwright TS scaffold at `.cursor/skills/qa_assistant/scaffold/` — `npm run qa-search`, `qa-book`, `qa-validate`, `qa-cleanup`, `qa-search-telemetry`, `qa-report`; failure-injection flags; evidence-dump checklist |
| [`qa_strategy`](.cursor/skills/qa_strategy/SKILL.md) | User wants a QA strategy, test plan, or staging/post-deploy checklist derived from a Trello card and its linked PR — "QA strategy for this card", "staging checklist for <card>", "what should we test for this PR", "post-deploy checks for <card>" | Core principle: **read the code, test the functionality**. Reads card description via Trello REST API, extracts linked PR / branch URLs, fetches the diff content via GitHub MCP (mandatory — not just file paths), then translates the diff into a **user / agent / log surface** (storefront UI, internal FH / JF agent screens, `debug_logs` / `optimizer_logs` shape, confirmation emails) and writes a two-section plan (Staging smoke / happy-path / edge-cases / user-visible regression risks + Post-deployment checks / monitoring queries / rollback signals). Hard rule: every checklist item is observable by a human or a log query — **no class / method / DTO / file-path mentions**. Optional `--mode comment` posts plan back to the card |
| [`skill_creator`](.cursor/skills/skill_creator/SKILL.md) | Adding, scaffolding, or wiring a new project-local skill | SKILL.md + `.claude/commands/<name>.md` wrapper + routing rows in `CLAUDE.md` § Skills Index and `.cursor/rules/rules.mdc` § Skills Index; stdlib-only `lint_skill.py` validator that flags missing wrappers, missing routing rows, and `description:` strings that do not start with "Use when" |
| [`trello_assistant`](.cursor/skills/trello_assistant/SKILL.md) | Creating or updating cards on the Content Integration or Content Integration - AI Automation boards; weekly grooming / in-flight reports; working a card the user pointed at | Lean SKILL.md router + `references/` (card_anatomy, dedup, grooming, todo_responses); H3 `⊙` card layout — 3 mandatory sections (Short description / Details with inline debug-log permalinks / Visibility with debuggable-CTE or Shape A/B query + count) + 3 optional (Possible solution-expected behavior / Credentials-access for new integrations only / QA notes); heading-attached content with one blank line between sections; plain ESL-friendly language + `GLOSSARY.md` terms; short titles; AI footer; short human-style intake on AI Automation board; mandatory Filipp-as-member; one card → one branch → one PR lifecycle |

`.cursor/skills/` is the canonical location for skill files. `.claude/commands/<name>.md` wrappers load the matching skill via slash command. The orchestrator mirror for Cursor's auto-loaded rules is `.cursor/rules/rules.mdc`. Raw MongoDB query mechanics for `ota.debug_logs` / `ota.optimizer_logs` live alongside `db_access` at [`.cursor/skills/db_access/references/mongodb_query_mechanics.md`](.cursor/skills/db_access/references/mongodb_query_mechanics.md) — the Mongo-touching skills load it directly.

---

## Project Structure

```text
.claude/
└── commands/                          # Claude Code slash commands — thin wrappers loading .cursor/skills/

.cursor/
├── rules/
│   └── rules.mdc                      # Mirror of CLAUDE.md (Cursor-only; alwaysApply: true)
└── skills/                            # Per-skill folders: <name>/SKILL.md + supporting files
    ├── codebase_access/               # Owns the local genesis clone + sync script
    │   ├── SKILL.md
    │   ├── scripts/
    │   │   └── sync_genesis.sh        # Fast-forwards $GENESIS_BRANCH (default develop) before any code read
    │   └── codebase/                  # Default genesis checkout (gitignored)
    ├── db_access/                     # Shared DB infrastructure — every DB-touching skill loads this first
    │   ├── SKILL.md                   # Skill entry point + DB foundations
    │   ├── references/
    │   │   └── mongodb_query_mechanics.md   # Loaded by bookability / optimizer when needed
    │   ├── scripts/
    │   │   ├── clickhouse_query.py    # ClickHouse CLI
    │   │   ├── mysql_query.py         # MySQL CLI
    │   │   └── mongo_query.py         # MongoDB CLI
    │   └── db-docs/                   # Schema / collection documentation
    │       ├── clickhouse/
    │       ├── mysql/
    │       └── mongodb/
    └── qa_assistant/                  # Test-booking driver — TS scaffold rebuild in flight on epic TsZ362XC
        ├── SKILL.md
        ├── page_inventory.md          # Selector inventory (Python POMs)
        ├── references/                # Validation / retry / report / voice rules
        └── legacy_python/             # Existing Playwright-backed Python runners (qa-search, qa-book, …); cd here + uv sync to use them

reports/                               # Ephemeral output (gitignored)
```
