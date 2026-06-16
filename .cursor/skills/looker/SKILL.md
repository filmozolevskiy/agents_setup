---
name: looker
description: >-
  Use when the user asks the agent to inspect, modify, or scaffold anything in
  Looker — LookML projects (models / views / explores), GitHub repos that back
  Looker projects, dashboards, tiles, looks, filters, or embedded URLs.
  Drives Looker through the Looker MCP server (`agents_setup-looker`,
  identifier `project-0-agents_setup-looker`); never hand-rolls the Looker
  REST API. Every Looker project the agent works on is backed by its own
  GitHub repository (one-project-one-repo); the list of repos the agent is
  allowed to touch lives in `projects.md`. Data verification (do these
  dimensions point at columns that actually exist? do the measures agree
  with the underlying database?) is delegated to the `table_analysis` skill
  in `db_access` — this skill never re-implements DB exploration.
---

# Looker

Drive Looker — read existing models / explores / dashboards, scaffold new
LookML projects in dedicated GitHub repos, and create or modify dashboards,
tiles, and filters. Looker reads/writes go through the **Looker MCP**
server (`project-0-agents_setup-looker`, label `agents_setup-looker`); LookML
authoring is git-based; data sanity-checks defer to `table_analysis`.

## When to use this skill

- The user asks for a new dashboard, tile, look, or filter on top of existing
  LookML.
- The user asks to stand up a fresh LookML project (new explore for an
  existing connection, or a brand-new connection).
- The user asks to inspect what models / explores / fields Looker exposes
  ("does Looker know about `ota.bookings`?", "what dimensions does the
  optimizer explore have?").
- The user asks to verify that a Looker model is consistent with the actual
  database — the actual verification is delegated to `table_analysis`, but
  the orchestration sits here.
- The user points the agent at an existing LookML repo registered in
  `projects.md` and asks for changes.
- The user asks to **make a Looker project / dashboard / explore
  faster** ("speed up", "optimize", "performance is bad", "this tile
  takes 30s"). Route this to the optimization subflow (see
  [`references/optimizing_existing_projects.md`](./references/optimizing_existing_projects.md))
  — that subflow has its own safety contract about not changing tile
  values without consent.

If the user just wants to query a table and is not actually asking about
Looker, send them to `table_analysis` (or the relevant DB CLI under
`scripts/`) instead. This skill is explicitly about Looker, not about ad-hoc
SQL.

## Approval gate (mandatory) — propose, then wait

Before **any edit to a `.lkml` file in a registered project repo**, the
agent stops and posts a written proposal in chat. No file write, no
`push_files`, no commit, no PR until the user replies with an approval
signal. This is non-negotiable, including for Tier 1 changes that
preserve every public field's value (rule 7 below).

**Triggers the gate (do not act without approval):**

- Editing any existing `.model.lkml`, `.view.lkml`, `.dashboard.lkml`,
  `manifest.lkml`, or `lkml`-included file in a project listed in
  [`projects.md`](./projects.md).
- Pushing those edits with `push_files` (GitHub MCP) or any other
  write to the project's default branch.

**Does not trigger the gate (proceed normally, but still summarise what
you did):**

- Read-only Looker MCP discovery (`get_models`, `get_explores`,
  `get_dimensions`, `get_measures`, `get_filters`, `get_parameters`,
  `get_dashboards`, `get_looks`).
- Validation queries (`query`, `query_sql`, `query_url`).
- `db_access` schema / numeric verification queries.
- Bootstrapping a brand-new project repo from
  [`templates/lookml_project_skeleton/`](./templates/lookml_project_skeleton/)
  — the project is empty, there is no existing surface area to
  protect; describe the intended shape (connection, table, dimensions,
  one explore) before pushing the first commit, but no formal gate.
- Creating new dashboards, filters, or tiles via
  `make_dashboard` / `add_dashboard_filter` / `add_dashboard_element`
  — those configure dashboards, they do not change LookML. (Editing
  an existing dashboard the user owns and depends on is still worth
  a one-line heads-up, but is outside this gate.)

**Proposal format.** Single Markdown block in chat (no separate file
under `reports/` unless the user asks). Use the template in
[`references/refactor_proposal.md`](./references/refactor_proposal.md).
Keep it lean — Scope, Why, Tier, Change, Affected, Rollback.
Mentally walk the standards checklist in
[`references/lookml_best_practices.md`](./references/lookml_best_practices.md)
before posting; do not dump the per-rule mapping into the block.

**Approval signal.** Any of `approve`, `yes`, `lgtm`, `ship it`,
`looks good` (case-insensitive) means apply. Anything else — questions,
partial pushback, silence — means revise the proposal and post it
again. Quote the trigger word back when announcing the apply step so
there is no ambiguity ("Got `approve`, applying now.").

**Edits to existing dashboards (non-LookML).** Adding a tile to a
dashboard the user already depends on, or rewiring a dashboard
filter, can change what the user sees on a saved board. This is
outside the LookML approval gate but still warrants a short heads-up
in chat ("I'm going to add tile `<title>` to dashboard `<id>`,
sourcing from `<model>.<explore>` — say so if you'd rather I drop it
in a sandbox folder first."). Read-only and sandbox work needs no
heads-up.

## Hard rules

1. **Looker MCP is the only Looker client.** Do not hand-roll Looker REST
   calls. Every Looker action (`get_models`, `get_explores`, `query`,
   `make_dashboard`, `add_dashboard_element`, …) goes through the
   `project-0-agents_setup-looker` MCP server. Read the tool's JSON schema
   under
   `/Users/filippmozolevskiy/.cursor/projects/Users-filippmozolevskiy-Repositories-agents-setup/mcps/project-0-agents_setup-looker/tools/<tool>.json`
   before each call.
2. **One Looker project → one dedicated GitHub repo.** Never co-host two
   projects in one repo, even small ones. The repo holds LookML and
   nothing else; data verification, env handling, and CI all live in
   `agents_setup` (this repo) — never duplicate them per project.
3. **Registry-gated.** The agent only touches repos / projects listed in
   [`projects.md`](./projects.md). Adding a new project = adding the entry
   in the same change. If the user names a project that is not registered,
   stop and propose adding it before doing any other work.
4. **Verification by `table_analysis`.** Whenever the agent claims a LookML
   field maps to a real column or that a measure agrees with the database,
   it must call into `table_analysis` (or the documented `db_access` CLIs)
   to back the claim. No "it should map to X" without evidence.
5. **No secrets in repos.** `.env` is `.gitignore`d in every project repo.
   Looker MCP credentials live wherever the MCP server expects them, not in
   any repo `.env`.
6. **LookML best practices apply to every generated file.** See
   [`references/lookml_best_practices.md`](./references/lookml_best_practices.md).
7. **Approval gate on existing-LookML edits.** Every edit to a
   `.lkml` file in a registered project goes through the propose-then-wait
   flow above (§ Approval gate). Tier 1 / Tier 2 in
   [`references/optimizing_existing_projects.md`](./references/optimizing_existing_projects.md)
   describe the *shape* of the proposal, not whether to ask — both
   tiers must be approved before applying.
8. **Always end with a manual-handoff block — and a Links block.** Many
   Looker operations require a human admin or Develop-Mode action that
   no MCP tool can perform: connecting a new GitHub repo to Looker,
   pulling + deploying LookML changes, granting model permissions, etc.
   Every reply that creates a new project, pushes LookML, or otherwise
   leaves work pending in Looker MUST end with the "Your next step"
   block taken verbatim from
   [`references/manual_handoffs.md`](./references/manual_handoffs.md),
   prefixed by the standardized **Links** block defined in the same
   file. The Links block is mandatory on **every reply that asks the
   user to take an action** (merge a PR, pull + deploy in Looker,
   create a deploy key, add a model role, refresh a dashboard, etc.),
   even when the action sits outside the handoff template. Constitution
   rule `Linkable artefacts` already requires this for any cited
   artefact; the handoff block enforces it in a fixed shape so users
   never have to hunt. Never close out by saying "done" if a deploy is
   pending — list the deploy steps explicitly and tell the user the
   agent will verify after they confirm.

## Subflows

The skill supports four subflows. Each is documented under `references/`;
the entry-points are listed below.

### 1. Inspect what Looker has (read-only, fastest)

Goal: answer "what models / explores / fields exist?" without touching
anything.

| Step | Tool | Notes |
|------|------|-------|
| List models | `get_models` | No arguments. Returns project_name, label, connections. |
| List explores in a model | `get_explores` (`model`) | Required to find an explore name. |
| List dimensions / measures / filters / parameters | `get_dimensions`, `get_measures`, `get_filters`, `get_parameters` (`model`, `explore`) | Pick the four you need; these define the queryable surface. |
| List dashboards | `get_dashboards` | Useful before `make_dashboard` to dedup. |
| List looks | `get_looks` | Same idea for one-off queries. |

This is the cheapest entry-point; do it before any of the other subflows.

### 2. Bootstrap a new LookML project (`references/bootstrap_lookml_repo.md`)

Goal: stand up a new Looker project backed by its own GitHub repo, ready
for a Looker admin to connect via "New LookML Project → Bare → from
existing repo".

Outline (full procedure in the reference doc):

1. **Choose the connection.** From `get_models`, pick the connection name
   that matches the database the project will read from (e.g. `ota`,
   `ota_phoenix`, `clickhouse-jupiter`). If the user wants a connection
   that does not yet exist in Looker, stop — that requires a Looker admin.
2. **Create the GitHub repo** with `create_repository` (GitHub MCP). Name
   and description must match the user's intent. Do not auto-init with a
   README — `push_files` writes the initial scaffold.
3. **Push the scaffold** with `push_files`. Files come from
   [`templates/lookml_project_skeleton/`](./templates/lookml_project_skeleton/);
   substitute `<project_name>`, `<connection>`, `<sql_table_name>`
   placeholders. The skeleton is intentionally minimal — LookML only,
   no scripts, no rules, no per-project docs:
   - `models/<project_name>.model.lkml` — declares the connection and one
     explore.
   - `views/<project_name>.view.lkml` — one view with `sql_table_name`,
     primary key, a `dimension_group: date`, a few dimensions and measures.
   - `.gitignore` — `.env`, `.DS_Store`.

   Data verification runs from `db_access` in this repo (see
   `.cursor/skills/db_access/scripts/`); LookML standards live in
   [`references/lookml_best_practices.md`](./references/lookml_best_practices.md)
   and apply at authoring time. Project repos are not standalone agent
   environments — they exist only to hold LookML for Looker to pull.
4. **Register the project** in [`projects.md`](./projects.md) with name,
   GitHub URL, Looker project name, owner, and short purpose. Same change.
5. **Hand off to a Looker admin** to connect the repo to Looker. The
   skill cannot do this — it requires Looker admin access. Document the
   handoff in the closing comment / PR.
6. **Smoke-test with `query`** once the Looker project is connected: run
   one `query` against the new explore returning the count measure to
   confirm Looker resolves the LookML and the connection actually pulls
   rows.

### 3. Modify or create dashboards / tiles (`references/dashboards_and_tiles.md`)

Goal: make / edit dashboards and tiles via the MCP, in the order the API
requires.

**Order of operations (from the MCP descriptors):**

1. `make_dashboard` — title + description (title must be unique in user's
   personal folder unless `folder` is set). Capture the returned
   `dashboard_id`.
2. `add_dashboard_filter` — one call per filter, before any tiles.
   `filter_type` is one of `date_filter`, `number_filter`, `string_filter`,
   `field_filter` (default). Field filters require `model`, `explore`,
   `dimension`. Capture each filter's `name`.
3. `add_dashboard_element` — one call per tile, after all filters. Each
   call needs `model`, `explore`, `fields`, `dashboard_id`. Optional:
   `title`, `pivots`, `filters`, `sorts`, `limit`, `vis_config`,
   `dashboard_filters` (binds tiles to dashboard filters by
   `dashboard_filter_name` + `view.field`).

Edits to existing dashboards: identify the dashboard via `get_dashboards`,
then add new tiles / filters with the same calls. There is no MCP tool for
moving or deleting tiles — flag those as out-of-scope and propose either a
Looker UI step or a follow-up.

### 4. Verify data (`references/data_verification.md`)

Goal: confirm a LookML field actually does what its description says and
that measures agree with the database.

Two layers:

- **Schema layer** — does the column / table referenced in `sql_table_name`
  / `sql:` actually exist? Delegate to **`table_analysis`** in
  `db_access` (or the relevant DB CLI under
  `.cursor/skills/db_access/scripts/`: `clickhouse_query.py`,
  `mysql_query.py`, `mongo_query.py`). Never assume column names from
  the LookML alone.
- **Numeric layer** — does the LookML measure agree with a hand-written
  query? Run the LookML measure with `query` (Looker MCP), run the
  equivalent SQL via the DB CLI, compare.

When schema or numeric layer disagrees, do not silently fix the LookML —
report the discrepancy with both numbers and let the user decide.

### 5. Optimize an existing project / dashboard (`references/optimizing_existing_projects.md`)

Goal: make a registered project faster without breaking dashboards
that depend on it.

**Two-tier safety contract:**

- **Tier 1 (default, apply without asking)** — every public dimension
  and measure must keep returning identical values for the same
  filters. Field names, types, and result sets unchanged. Examples:
  add an `aggregate_table:` to the explore, attach a `datagroup:` +
  `max_cache_age:`, narrow a `relationship:` only when verified that
  the join had no real fan-out, hide noisy join fields, push
  duplicated SQL into a hidden helper dimension.
- **Tier 2 (gated, must ask first)** — anything that could change a
  tile's value or break it: rename / remove fields, change a measure
  type, add `always_filter:` to a previously unbounded explore, fix a
  `sql_distinct_key:` on a measure that currently fans out (the new
  numbers are right, but they shift on every existing tile), split a
  view, swap connection. Use the proposal template in the reference
  doc, listing per-dashboard impact, before applying.

Diagnostics first (`query_sql` + `db_access` timing on the warehouse,
not "looks slow to me"). After diagnosing, **publish the plan to Notion**
as a child page under the FlightHub Looker index page and push an
`OPTIMIZATION_PLANS.md` link to the project repo — both are mandatory
before posting any LookML proposal (see Step 5 in the reference doc).
Verification protocol after every change, both tiers — exact-match
numbers on the top tile of every affected dashboard, before vs after.

**Owner report on request.** When the user asks for "a report for
the dashboard owner" / "a short report for <name>" / similar, write
it verbatim in the template at the bottom of
[`references/optimizing_existing_projects.md`](./references/optimizing_existing_projects.md)
§ Owner report. First-person opener, three labeled one-liners
(Before / After / Correctness), repo + Notion links, fixed closing
line. No tables, no LookML / CTE / SQL terms, no headers beyond
"Here is a short report".

## Files in this skill

- [`SKILL.md`](./SKILL.md) — this file.
- [`projects.md`](./projects.md) — registry of Looker projects / repos the
  agent is allowed to touch. Read before doing anything; refuse work on
  projects not listed.
- [`references/lookml_best_practices.md`](./references/lookml_best_practices.md)
  — distilled rules that every generated `.model.lkml` / `.view.lkml`
  follows.
- [`references/bootstrap_lookml_repo.md`](./references/bootstrap_lookml_repo.md)
  — step-by-step for spinning up a new GitHub-backed Looker project.
- [`references/dashboards_and_tiles.md`](./references/dashboards_and_tiles.md)
  — concrete worked examples of the dashboard / tile MCP flow.
- [`references/data_verification.md`](./references/data_verification.md) —
  how to back LookML claims with `table_analysis` + DB CLI runs.
- [`references/optimizing_existing_projects.md`](./references/optimizing_existing_projects.md)
  — performance optimization on registered projects, with the
  Tier 1 / Tier 2 safety contract and verification protocol.
- [`references/manual_handoffs.md`](./references/manual_handoffs.md) —
  verbatim "Your next step" blocks the agent must paste at the end of
  any reply that creates a new project, pushes LookML, or leaves Looker
  work in a pending state.
- [`references/refactor_proposal.md`](./references/refactor_proposal.md) —
  Markdown chat-block template for the approval gate. Used on every
  edit to a `.lkml` file in a registered project, including Tier 1
  refactors that preserve every public field's value.
- [`templates/lookml_project_skeleton/`](./templates/lookml_project_skeleton/)
  — file-by-file skeleton (LookML, scripts, configs, cursor rules) used
  by the bootstrap subflow. Copy-substitute placeholders, push via
  `push_files`.
- [`scripts/mcp_looker.sh`](./scripts/mcp_looker.sh) — wrapper that
  Cursor launches in stdio mode (wired in `.cursor/mcp.json`) to expose
  the Looker MCP. Loads `.env`, asserts `LOOKER_BASE_URL` /
  `LOOKER_CLIENT_ID` / `LOOKER_CLIENT_SECRET`, runs `bin/toolbox --prebuilt
  looker --stdio`. Don't call this script directly — Cursor manages the
  process.
- [`scripts/install_mcp_toolbox.sh`](./scripts/install_mcp_toolbox.sh) —
  one-shot installer that downloads the Google MCP Toolbox binary into
  `bin/toolbox` (gitignored). Run once per machine; re-run to upgrade
  via `MCP_TOOLBOX_VERSION`. The Looker wrapper hard-fails until this
  has been run.

## Looker MCP — tool reference (read schemas before calling)

| Subflow | Tool | Required args |
|---------|------|---------------|
| Discovery | `get_models` | (none) |
| Discovery | `get_explores` | `model` |
| Discovery | `get_dimensions` / `get_measures` / `get_filters` / `get_parameters` | `model`, `explore` |
| Discovery | `get_dashboards` / `get_looks` | (none) |
| Validation | `query` | `model`, `explore`, `fields` |
| Validation | `query_sql` | (returns generated SQL — useful when comparing to a hand-written query) |
| Validation | `query_url` | (build a Looker URL for a query without running it) |
| Authoring | `make_dashboard` | `title` |
| Authoring | `add_dashboard_filter` | `dashboard_id`, `name`, `title` |
| Authoring | `add_dashboard_element` | `dashboard_id`, `model`, `explore`, `fields` |
| Authoring | `make_look` / `run_look` / `run_dashboard` | (per-schema) |
| Embedding | `generate_embed_url` | (per-schema) |

Every cell above is the headline argument set; always read the actual
schema in
`mcps/project-0-agents_setup-looker/tools/<tool>.json` before calling.

## Cross-skill use

- `table_analysis` — schema discovery, finding the right table for a
  proposed LookML view. Mandatory partner for the data verification
  subflow.
- `db_access` (`.cursor/skills/db_access/scripts/mysql_query.py`,
  `clickhouse_query.py`, `mongo_query.py`) — actual numeric checks
  against the live DB. The only place DB credentials live; project
  repos never carry their own.

## What not to do

- Do not call the Looker REST API directly (`requests.get(...)`,
  `looker_sdk.init40()`, etc.). Always go through the MCP.
- Do not put two Looker projects in the same GitHub repo.
- Do not start work on a Looker project that is not in `projects.md`.
- Do not assume a column exists on the basis of the LookML alone.
- Do not commit `.env` files; do not embed credentials in any repo file.
- Do not generate `SELECT *` derived tables. List the columns the project
  actually uses.
- Do not rename a registry entry or the GitHub repo of a registered
  project without an explicit user request — other tooling may key on
  those names.
