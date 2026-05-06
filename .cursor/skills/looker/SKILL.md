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

If the user just wants to query a table and is not actually asking about
Looker, send them to `table_analysis` (or the relevant DB CLI under
`scripts/`) instead. This skill is explicitly about Looker, not about ad-hoc
SQL.

## Hard rules

1. **Looker MCP is the only Looker client.** Do not hand-roll Looker REST
   calls. Every Looker action (`get_models`, `get_explores`, `query`,
   `make_dashboard`, `add_dashboard_element`, …) goes through the
   `project-0-agents_setup-looker` MCP server. Read the tool's JSON schema
   under
   `/Users/filippmozolevskiy/.cursor/projects/Users-filippmozolevskiy-Repositories-agents-setup/mcps/project-0-agents_setup-looker/tools/<tool>.json`
   before each call.
2. **One Looker project → one dedicated GitHub repo.** Never co-host two
   projects in one repo, even small ones. Each repo has its own
   `.env.example`, `README.md`, `requirements.txt`, and CI hook for LookML
   validation.
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
   substitute `<project_name>`, `<connection>`, `<sql_table_name>`,
   `<owner>` placeholders. The skeleton is modeled on
   [filmozolevskiy/content_integration_optimizer](https://github.com/filmozolevskiy/content_integration_optimizer)
   and includes:
   - `models/<project_name>.model.lkml` — declares the connection and one
     explore.
   - `views/<project_name>.view.lkml` — one view with `sql_table_name`,
     primary key, a `dimension_group: date`, a few dimensions and measures.
   - `.cursor/rules/*.mdc` — LookML standards, SQL patterns,
     project-structure docs (copied from the reference repo, scoped to
     this project).
   - `scripts/mysql_query.py` (or `clickhouse_query.py` /
     `mongo_query.py`) — same shape as the reference repo, so the
     project's own agent can sanity-check data.
   - `.env.example`, `.gitignore`, `requirements.txt`, `README.md`.
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
  `db_access` (or the relevant DB CLI: `scripts/clickhouse_query.py`,
  `scripts/mysql_query.py`, `scripts/mongo_query.py`). Never assume column
  names from the LookML alone.
- **Numeric layer** — does the LookML measure agree with a hand-written
  query? Run the LookML measure with `query` (Looker MCP), run the
  equivalent SQL via the DB CLI, compare.

When schema or numeric layer disagrees, do not silently fix the LookML —
report the discrepancy with both numbers and let the user decide.

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
- [`templates/lookml_project_skeleton/`](./templates/lookml_project_skeleton/)
  — file-by-file skeleton (LookML, scripts, configs, cursor rules) used
  by the bootstrap subflow. Copy-substitute placeholders, push via
  `push_files`.

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
- `db_access` (`scripts/mysql_query.py`, `scripts/clickhouse_query.py`,
  `scripts/mongo_query.py`) — actual numeric checks against the live DB.

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
