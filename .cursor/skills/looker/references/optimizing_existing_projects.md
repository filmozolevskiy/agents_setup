# Optimizing existing Looker projects and dashboards

How to make an existing, registered project faster without breaking
the dashboards that already depend on it.

## Safety contract — read first

**Every LookML edit goes through the approval gate in
[`../SKILL.md`](../SKILL.md) § Approval gate, regardless of tier.**
The two tiers below describe the *shape* of the proposal — what
sections to fill in and how strict the per-tile impact column has to
be — they do **not** decide whether to ask. Even a Tier 1 change
that preserves every public field's value still needs the proposal
in [`refactor_proposal.md`](./refactor_proposal.md) and an explicit
approval signal (`approve`, `yes`, `lgtm`, `ship it`, `looks good`)
before any file write.

- **Tier 1** — changes that leave every public dimension and measure
  **identical**: same name, same type, same return value for the
  same filters. The *Affected* section in the proposal lists each
  dashboard with "no value change". Every existing dashboard tile
  must keep returning the exact same numbers.
- **Tier 2** — changes that **could** make a dimension or measure
  return different values, that rename / remove fields, that add
  `always_filter:` / `conditionally_filter:` to a previously
  unbounded explore, or that change cache freshness in a
  user-visible way. The proposal's *Affected* section lists per-tile
  `<old> → <new>` for every affected dashboard — "unknown" is not
  acceptable; pause and run the queries first.

If you are unsure which tier a given change falls into, treat it as
Tier 2.

The verification protocol at the bottom of this file is mandatory
for both tiers — "exactly the same numbers" is a claim that needs
evidence, not a hope.

## Step 1 — Diagnose, do not guess

1. Identify the slow surface precisely:
   - Single dashboard ID? Single tile? Whole explore?
   - Get the dashboard via `get_dashboards`, the slow tile via
     `run_dashboard` (look for elapsed times in the response).
2. Get the generated SQL with the Looker MCP `query_sql` for the
   exact field set the user runs. Do this for the slow tile and at
   least one fast tile on the same explore as a control.
3. Run that SQL through `db_access`
   (`.cursor/skills/db_access/scripts/<...>_query.py query "..."`)
   to confirm the slowness is warehouse-side, not Looker frontend.
4. If the SQL is fast at the warehouse but slow in Looker, the issue
   is something else (frontend, network, dashboard layout) — escalate
   instead of touching the LookML.
5. Note any aggregate tables / PDTs / views that already exist on
   the explore. Do not duplicate them.

Record diagnostic numbers (warehouse query time, rows scanned, the
generated SQL excerpt) in your reply before proposing fixes. Numbers
before assertions.

## Step 2 — Tier 1: non-breaking optimizations (still gated)

Each of these is invisible to existing dashboard tiles — field names
and result values are unchanged. They are still gated by the
approval flow in [`../SKILL.md`](../SKILL.md) § Approval gate; post
the [`refactor_proposal.md`](./refactor_proposal.md) block and wait
for an approval signal before applying.

### A. Add `aggregate_table:` to the explore

Aggregate awareness is the single highest-payoff Tier 1 change.
Looker's query planner auto-routes any query whose fields are a
subset of an aggregate table's `query: { ... }` block, with no tile
changes:

```lkml
explore: bookings {
  aggregate_table: rollup_daily_carrier {
    query: {
      dimensions: [booking_date_date, validating_carrier, gds]
      measures:   [bookings_count, total_checkout_fare]
      filters:    [is_test: "no"]
    }
    materialization: { datagroup_trigger: bookings_default_datagroup }
  }
}
```

The field set in `query:` covers the slow tile's fields, the result
table is small, and Looker picks it transparently. See
[Looker aggregate awareness](https://docs.cloud.google.com/looker/docs/aggregate-awareness).

**Precondition — the connection must be write-capable.** `aggregate_table:`
materializes a real table on the warehouse. The Looker connection that
backs the explore must have:

- A user with `CREATE TABLE` / `INSERT` / `DROP` on a designated database
  (sometimes called PDT Database, Temp Database, or Scratch Schema).
- The Connection's "PDT and Datagroup Maintenance Schedule" field
  set to a cron expression (e.g. `*/5 * * * *`). Empty = Looker never
  polls the trigger, so the agg never rebuilds.

If either is missing, Looker silently skips the build. Project Health
will read "Unbuilt PDTs (0) — All PDTs successfully built" — that means
Looker has zero PDTs registered to build, **not** that yours built.
Queries keep hitting raw with no warning.

**Diagnostic — is the connection write-capable? Run before proposing
the agg.** Two cheap checks:

1. *Username pattern.* Looker → Admin → Connections → edit → Step 2
   "Database Settings" → Username field. If it ends in `_ro`,
   `_readonly`, `_analyst`, or you can see no Looker-managed scratch
   schema in the warehouse, treat it as read-only until proven
   otherwise.
2. *Warehouse-side check.* Run via `db_access`:

   ```sql
   -- ClickHouse
   SELECT DISTINCT database FROM system.tables
   WHERE database LIKE '%scratch%' OR database LIKE '%looker%'
      OR database LIKE '%pdt%';
   ```

   ```sql
   -- MySQL
   SHOW DATABASES LIKE 'looker%';
   ```

   No rows = no scratch schema configured. Either fix the connection
   (admin step — add a write-capable user / scratch DB / maintenance
   schedule, optionally via Looker's "PDT Override Connection" so
   reads stay on the read-only role) or skip Tier 1 A and use the
   warehouse-side fallback below.

**Fallback when the connection is read-only — warehouse-maintained
rollup.** Have the data-engineering team materialize the rollup as a
`MATERIALIZED VIEW` (ClickHouse) or scheduled job (MySQL / BigQuery)
on the source table, refreshing on the same cadence the agg would
have. Point a hidden LookML view at that materialized table; either
re-add a thin `aggregate_table:` over it (free, since the heavy lift
is already done) or have the existing measures `sql:` reference the
MV directly. Trades a Looker-managed object for a warehouse-managed
one, but works with a read-only connection. Pre-existing `_pdt_*` /
`_rollup_*` tables in the warehouse are usually this pattern — check
before re-implementing.

> **`ota` connection — confirmed read-only (verified 2026-05-11).**
> `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME
> LIKE '%looker%' OR '%pdt%' OR '%scratch%'` returned no rows. The Looker
> service account has no write access to the `ota` MySQL instance.
> Consequence: **Tier 1 A (`aggregate_table:`) is blocked for all projects
> on the `ota` connection, and the warehouse-maintained-rollup fallback is
> also unavailable** (Looker cannot write the pre-built table either — that
> requires a data-engineering ticket to create and schedule the table
> outside of Looker). Skip directly to Tier 1 B (`persist_with:` result
> cache) for `ota`-backed explores.

**Note** — even when Tier 1 A is blocked, Tier 1 B (`datagroup:` +
`persist_with:`) still works on a read-only connection. The result
cache lives in Looker's metadata DB, not the warehouse. Ship B even
when you have to skip A.

### B. Add a `datagroup` + `max_cache_age:` to slow explores

```lkml
datagroup: bookings_default_datagroup {
  sql_trigger: SELECT MAX(updated_at) FROM ota.bookings ;;
  max_cache_age: "24 hours"
}

explore: bookings {
  persist_with: bookings_default_datagroup
}
```

Cached results are reused until the underlying data changes. Same
queries, same numbers — just hit the cache instead of the warehouse.
Skip if the explore is already on a tighter datagroup.

### C. Tighten `relationship:` when the data justifies it

If a join is currently `many_to_many` but the warehouse data is
actually `many_to_one`, narrowing the relationship lets Looker drop
symmetric-aggregate wrappers and emit cheaper SQL.

This is Tier 1 **only** if the join was already correct in practice
(no fan-out actually happened). Verify with `db_access`:

```sql
SELECT a_id, COUNT(DISTINCT b_id) AS dup
FROM   <join_source>
GROUP  BY a_id
HAVING dup > 1
LIMIT  5;
```

Empty result set → safe to narrow. Any rows → the join had silent
fan-out and tightening the relationship will change measure values.
That is Tier 2; stop and propose.

### D. Push repeated SQL up into a hidden dimension

If three measures share an expression (`COALESCE(${TABLE}.amount,0)`,
a CASE bucketing, a date cast), define it once as a hidden helper
dimension and reference `${helper}` from the measures. Result rows
are unchanged but the SQL Looker emits is shorter and easier for the
warehouse to plan. Aligns with rule 2 in
[`lookml_best_practices.md`](./lookml_best_practices.md).

### E. Prune unused field exposure on joins

```lkml
join: bookings_finance {
  fields: [bookings_finance.amount, bookings_finance.currency]
  ...
}
```

The join still works for every existing tile (those tiles already
declared which fields they want); the field picker just stops
offering a hundred unused columns from the joined view. Confirms
zero impact by checking each existing dashboard's field list against
the kept set before pushing.

### F. Replace `LIKE '%foo%'` filters with sargable ones

In a dimension's `sql:`, `LOWER(col) LIKE '%x%'` triggers a full
scan on every dialect. Where the warehouse supports it, swap for
`col ILIKE 'x%'`, regex-anchored patterns, or a precomputed flag
column. This changes the SQL but not the matched rows — verify with
the protocol below before declaring done.

### G. `view_name.fields_hidden_by_default: yes`

Hides previously-visible fields **only in the field picker**;
already-saved tiles still resolve them by name. Useful when the
view's surface area is too noisy and confuses analysts. Tile values
unchanged.

## Step 3 — Tier 2: breaking optimizations (gated, with per-tile delta)

Same gate as Tier 1; the difference is the proposal must list each
affected dashboard tile and what its number changes to (a
non-empty `<old> → <new>` line per tile, no "unknown"). Use the
[`refactor_proposal.md`](./refactor_proposal.md) template.

Common Tier 2 changes:

- **Renaming or removing** a public dimension / measure. Looker
  raises `error running query` on every tile that still references
  the old name.
- **Changing a measure's aggregation** (e.g. `count` → `count_distinct`
  to fix double-counting). Fixes a bug, but the numbers shift on
  every existing tile.
- **Adding `always_filter:` to a previously unbounded explore.**
  Tiles that didn't supply the filter start failing or returning a
  smaller slice.
- **Adding `sql_distinct_key:` to a measure that currently fans out.**
  This is a correctness fix; the new (lower) numbers are right but
  the old (inflated) numbers are what dashboards have been showing.
  Treat as a deliberate value change.
- **Splitting a wide view into narrower ones** (re-keying, joins).
- **Replacing a `derived_table` / PDT with a warehouse table or
  view.** Even when the rows are identical the freshness model
  differs and any stakeholder relying on PDT regen timing notices.
- **Changing the connection** behind a model — tile values can drift
  if the connections see different data (replica lag, schema drift).
- **Changing `sql_table_name:`** to a partitioned/aggregated source
  with a different row grain.

Format for asking the user: the canonical template is in
[`refactor_proposal.md`](./refactor_proposal.md). For Tier 2, set
**Tier**: 2 in the block, fill the per-tile `<old> → <new>` deltas
in *Affected*, and add a migration-plan line under *Rollback* if
the change involves a rename + alias or deprecation window. The
estimated warehouse speed-up belongs in *Why*.

If the user asks for the optimization but the impact list is empty
("nobody uses that field"), still confirm with `query` against each
dashboard's saved tiles before declaring zero impact — saved tiles
can reference fields the field picker no longer surfaces.

## Step 4 — Verification protocol (mandatory)

Before claiming the change is done, regardless of tier:

1. **List every dashboard that uses the affected explore.** Filter
   `get_dashboards` results, or grep tile JSON for the model /
   explore name.
2. **For every top-1 tile per dashboard**, run the same query
   pre-change (cached numbers from the previous `run_dashboard`) and
   post-change (`run_dashboard` after Looker pulls + deploys).
3. **Numbers must match exactly** — not "roughly", not "within a
   percent". For Tier 2 changes the new numbers are the *expected
   change*; verify they match the per-tile prediction in the
   proposal, not the old values.
4. **Time the slow query** with `query_sql` + `db_access` again;
   report the actual speed-up next to the predicted one.
5. **If any unexpected drift**, revert the LookML commit immediately
   and surface the discrepancy. Do not "explain it away".

## Step 5 — Publish the optimization plan (mandatory)

After diagnosing the dashboard and before applying any changes, publish the
plan to Notion and link it back to the project repo.

### 5a. Create a child Notion page under the FlightHub Looker index

Parent page: **FlightHub Looker**
(`https://www.notion.so/FlightHub-Looker-360df8c49d3f80618286e5f94e2db16f`,
ID `360df8c4-9d3f-8061-8286-e5f94e2db16f`).

Before calling `notion-create-pages`, read the tool descriptor under
`mcps/project-0-agents_setup-Notion/tools/notion-create-pages.json`.

Page title format: `<Project name> — Optimization Plan (<YYYY-MM-DD>)`
Example: `content_integration_optimizer — Optimization Plan (2026-05-14)`

**Page structure — checklist format.**
Each proposed change becomes its own `to_do` block (Notion's checklist
block type). Use this hierarchy:

```
[heading_2]  Diagnosis
[paragraph]  1–3 sentences: what is slow, why, artefact refs.

[heading_2]  Proposed changes
[to_do]  Change 1 — <title> (Tier 1 / Tier 2)
[to_do]  Change 2 — <title> (Tier 1 / Tier 2)
... one to_do per change ...

[heading_2]  Verification protocol
[to_do]  List every dashboard that uses the affected explore
[to_do]  Run top-1 tile per dashboard pre- and post-change; numbers must match exactly
[to_do]  Time slow query with query_sql + db_access; report actual vs predicted speed-up
[to_do]  Revert immediately and surface any unexpected drift

[heading_2]  Notes
[paragraph]  Connection write-capability, blocked tiers, escalation triggers — anything
             that shapes which changes are available.
```

All `to_do` blocks start unchecked (`checked: false`). Do not mark any
item checked — that is the user's job as they work through the plan.

Capture the returned Notion page URL. You will need it in 5b.

### 5b. Add the Notion link to the project's GitHub repo

After the Notion page is created, add its URL to the project repo so the
plan is discoverable from the codebase.

File: `OPTIMIZATION_PLANS.md` in the repo root. If the file does not
exist, create it. If it exists, append a new row.

Format (append, newest at top):

```markdown
# Optimization Plans

| Date | Dashboard | Notion plan |
|------|-----------|-------------|
| 2026-05-14 | [Optimizer Dashboard (1642)](https://flighthub.looker.com/dashboards/1642) | [Optimization Plan](https://www.notion.so/<page-id>) |
```

Push the file via the GitHub MCP (`push_files`). Use commit message:
`docs: add optimization plan link for dashboard <id> (<YYYY-MM-DD>)`.

This push does **not** trigger the LookML approval gate — `OPTIMIZATION_PLANS.md`
is not a `.lkml` file.

### Order of operations

1. Diagnose (Steps 1–3 above).
2. Create Notion page (Step 5a) — do this before proposing any LookML change.
3. Push `OPTIMIZATION_PLANS.md` link to the repo (Step 5b).
4. Post LookML proposal(s) in chat per the approval gate in `../SKILL.md`.
5. Verify (Step 4) after each approved change lands.

---

## When to escalate instead of optimize

- Slow query roots in warehouse layout (missing partition pruning,
  no clustering, missing indexes, materialized-view candidacy) —
  not a LookML change. Surface as a data-engineering request with
  the offending SQL attached.
- Slow query is on a connection `db_access` cannot reach — say so;
  the user reproduces locally.
- Optimization requires a Looker admin action (changing connection
  pool, model permissions, instance-level cache) — produce a
  manual-handoff block from
  [`manual_handoffs.md`](./manual_handoffs.md), do not silently move
  on.

## Anti-patterns

- "Just add a `derived_table` to materialize the slow part." See
  rule 1 in `lookml_best_practices.md`. Use `aggregate_table:` (Tier
  1 A) instead.
- "We can rename the field while we're in there." That is Tier 2 in
  disguise. Renames break dashboards.
- "The numbers are 0.4% off but it's faster — good enough." No.
  Either the change is non-breaking and matches exactly, or it is
  Tier 2 and was approved with a specific predicted delta.
- Skipping diagnostics because the perf problem "looks obvious".
  Half the time the actual hot spot is a different tile or a stale
  PDT regen window, not what you thought.
