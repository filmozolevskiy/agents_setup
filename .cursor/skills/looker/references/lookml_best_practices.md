# LookML best practices

Distilled from
[filmozolevskiy/content_integration_optimizer/.cursor/rules/](https://github.com/filmozolevskiy/content_integration_optimizer/tree/master/.cursor/rules).
Every generated `.model.lkml` / `.view.lkml` follows these rules.
Project repos hold only LookML — these standards live here in the
`looker` skill, not duplicated per project.

## Project layout

```text
<project_repo>/
├── models/
│   └── <project_name>.model.lkml
├── views/
│   └── <project_name>.view.lkml
└── .gitignore
```

Anything else (data verification, scripts, env, CI) belongs in
`agents_setup`, not in the project repo.

## Authoring rules — the high-impact ten

These are the rules with the highest correctness / performance payoff,
synthesized from Looker's published [LookML dos and don'ts](https://docs.cloud.google.com/looker/docs/best-practices/lookml-dos-and-donts),
[Writing sustainable, maintainable LookML](https://docs.cloud.google.com/looker/docs/best-practices/writing-sustainable-maintainable-lookml),
the [DRY LookML cookbook](https://docs.cloud.google.com/looker/docs/best-practices/dry-lookml-cookbook),
and [Considerations when building performant Looker dashboards](https://docs.cloud.google.com/looker/docs/best-practices/considerations-when-building-performant-looker-dashboards).
Treat them as load-bearing — every generated `.model.lkml` /
`.view.lkml` must satisfy all ten.

### 1. Do not use `derived_table` by default

A `derived_table` materializes a sub-query Looker rewrites on every
run, fragments the explore graph, and locks behavior into SQL that
the field picker cannot see into. Express the same logic as
dimensions, measures, and joins instead. Acceptable escape hatches:

- A genuinely unavoidable window function or pivot the SQL dialect
  cannot express on top of a normal view.
- An `aggregate_table:` for performance (see rule 6) — note this is
  a different LookML construct, not a `derived_table`.
- A one-off NDT (native derived table) that the user explicitly
  asked for and that has a dated `# Why:` comment justifying it.

If you reach for `derived_table` for any other reason, stop and
re-shape the model.

### 2. DRY: reference fields, never raw columns

Never write `${TABLE}.col` outside the lowest-level dimension that
defines that column. Every measure, derived dimension, and join
condition references the dimension via `${field}` so the dimension's
logic (`COALESCE`, casting, business rules) propagates everywhere it
is used.

```lkml
dimension: amount_cad { type: number; sql: COALESCE(${TABLE}.amount, 0) ;; }

measure: total_amount   { type: sum; sql: ${amount_cad} ;; }
measure: avg_amount     { type: average; sql: ${amount_cad} ;; }
```

Bad: `measure: total_amount { sql: SUM(${TABLE}.amount) ;; }` — the
`COALESCE` from `amount_cad` is silently lost. Use `set:` for
reusable field bundles (e.g. `set: revenue_metrics { fields: [...] }`)
and `extends:` (rule 9) for cross-view sharing.

### 3. Every join declares `relationship:` explicitly

```lkml
join: bookings {
  type: left_outer
  relationship: many_to_one
  sql_on: ${attempts.booking_id} = ${bookings.id} ;;
}
```

If `relationship:` is missing or wrong, Looker assumes `many_to_many`
and applies symmetric-aggregate logic that can either silently inflate
sums (fan-out) or silently lose rows. Per Looker's [Getting the
relationship parameter right](https://docs.cloud.google.com/looker/docs/best-practices/getting-the-relationship-parameter-right),
this is the single most common source of "the totals are wrong" bugs.

### 4. Primary keys must be truly unique

`primary_key: yes` is a *promise* to Looker, not a hint. If the
column is not unique, sums on any join through this view are wrong.
For composite keys, build the PK explicitly:

```lkml
dimension: pk {
  primary_key: yes
  hidden: yes
  sql: concat(${TABLE}.tenant_id, '-', ${TABLE}.event_id) ;;
}
```

Verify uniqueness with `db_access` (`SELECT pk_col, COUNT(*) FROM ...
GROUP BY pk_col HAVING COUNT(*) > 1 LIMIT 5`) before declaring the
field. No exceptions.

### 5. Bound every explore with `always_filter:` or `conditionally_filter:`

```lkml
explore: bookings {
  always_filter: {
    filters: [bookings.is_test: "no", bookings.booking_date_date: "30 days"]
  }
}
```

A user (or a tile in a forgotten dashboard) running an unfiltered
explore is the cheapest way to set the warehouse on fire. Always
require at least the date dimension and any `is_test` flag. Use
`conditionally_filter:` when a tighter filter is acceptable as a
substitute (e.g. a single booking ID).

### 6. Prefer `aggregate_table:` over PDTs for performance

Per [Optimize Looker performance](https://docs.cloud.google.com/looker/docs/best-practices/optimize-looker-performance),
aggregate awareness is the modern alternative to a `derived_table`
with `persist_for:` / `sql_trigger_value:`. Aggregate tables:

- Live next to the explore (one place to read), not in a separate
  file.
- Are picked automatically when their fields cover the query.
- Don't materialize a Looker-managed table in the warehouse unless
  you actually request `materialization: { ... }`.

If you find yourself wanting a PDT, write an aggregate table first
and benchmark. Reach for a true PDT only when the user explicitly
asks for one and accepts the warehouse-side cost.

### 7. `sql_distinct_key:` on additive measures behind a one-to-many join

Whenever a view participates in a one-to-many or many-to-many join
and exposes `type: sum`, `type: count`, or `type: average` measures,
declare `sql_distinct_key:` so Looker can apply the symmetric
aggregate. Otherwise totals inflate by the fan-out factor:

```lkml
measure: total_revenue {
  type: sum
  sql: ${amount_cad} ;;
  sql_distinct_key: ${id} ;;
}
```

Per Looker's [Understanding symmetric aggregates](https://docs.cloud.google.com/looker/docs/best-practices/understanding-symmetric-aggregates).

### 8. Enumerated dimensions use `case:`, not hand-rolled `CASE WHEN`

```lkml
dimension: status_bucket {
  case: {
    when: { sql: ${status} = 'issued' ;;     label: "Issued" }
    when: { sql: ${status} = 'cancelled' ;;  label: "Cancelled" }
    else: "Other"
  }
}
```

The `case:` parameter is enumerable by the field picker (auto
suggestions), unaffected by SQL-dialect quirks, and cheaper to grep
than a CASE expression buried in `sql:`. Inline `CASE WHEN` is
acceptable only when the bucketing logic depends on a parameter
substitution that `case:` cannot express.

### 9. Cross-view DRY uses `extends:`, not copy-paste

When two views share field definitions (e.g. a "real bookings" view
and a "test bookings" view that differ only in their `sql_table_name`):

```lkml
view: bookings_base {
  extension: required
  dimension: id { primary_key: yes; sql: ${TABLE}.id ;; hidden: yes }
  dimension: booking_date { ... }
  measure: bookings_count { ... }
}

view: bookings {
  extends: [bookings_base]
  sql_table_name: ota.bookings ;;
}

view: bookings_test {
  extends: [bookings_base]
  sql_table_name: ota.bookings_staging ;;
}
```

Per the [DRY cookbook](https://docs.cloud.google.com/looker/docs/best-practices/dry-lookml-cookbook),
`extends:` plus `extension: required` is the Looker-native answer to
"the same five fields show up in three views". Never copy-paste
field definitions across views — the moment they drift, the analysis
is wrong.

### 10. Inspect generated SQL with `query_sql` before declaring done

Once a measure or explore change is pushed (and Looker has pulled +
deployed), run the Looker MCP's `query_sql` on the same field set
the user will use. Paste the returned SQL into the relevant
`db_access` CLI. Compare row counts, distincts, and any sums against
the LookML measure's `query` result.

Symmetric-aggregate violations, broken `sql_distinct_key:`, missing
`always_filter:` clauses, and wrong join relationships only become
visible at the generated-SQL layer — the LookML alone looks fine.
This is the agent's last gate before saying the work is verified.

## Model file

- `connection: "<connection_name>"` — exact string from `get_models`. No
  quotes around the connection in code paths, but the string itself is
  quoted in LookML.
- `include: "/views/**/*.view.lkml"` — single recursive include is fine
  for small projects.
- One `explore: <project_name>` per project to start. Add joins only when
  a tile needs them. Each join declares `type` and `relationship`
  explicitly; never leave them defaulted.
- If the explore needs a date guard, use a `parameter` of type `date`
  with a sensible `default_value` and reference it via
  `sql_always_where: ${view.date_raw} > TIMESTAMP({% parameter view.start_date %}) ;;`.

## View file

- `view: <name> { sql_table_name: <db>.<table> ;; … }` — fully qualified
  table name. (No `derived_table` — see rule 1.)
- `dimension: id { primary_key: yes; type: number; sql: ${TABLE}.id ;;
  hidden: yes }` — always declare a primary key and hide it.
- `dimension_group: <date_field>` for any timestamp dimension — gives
  Looker `date`, `week`, `month`, `quarter`, `year`, `time`, `raw`
  timeframes for free. Never hand-roll separate `dimension: ..._date`
  / `dimension: ..._month` fields.
- `group_label`s — use a numbered scheme (`"1. DATE"`, `"2. CONTESTANT
  INFO"`, …) so the field picker is ordered.
- Boolean dimensions: `type: yesno`, named `is_<thing>`.
- `description:` on every public dimension and measure. Required.
- Hidden helpers (`hidden: yes`) for intermediate calculations.
- Field references inside SQL use `${TABLE}.col` for raw columns and
  `${other_dimension}` for derived ones — never hardcode the table name.
- Suggestions on string dimensions where the value-set is enumerable
  (`suggestions: ["Eligible", "Unprocessable", …]`).
- Ratio / rate measures: always `numerator / NULLIF(denominator, 0)`.
- Value formats: `value_format: "#,##0.00"` for money,
  `value_format: "0.00%"` for rates.

## Measures

- `count_distinct` for entity counts (rows can multi-count if joins
  fan out).
- `sum` for additive money / volume only when the dimension is
  per-row-additive — annotate the description if a column multi-counts
  per attempt or per booking, and offer a "safe" variant.
- Filter measures with explicit conditions in `sql:` (`CASE WHEN
  candidacy = 'Eligible' THEN ${id} END`) rather than `filters: [...]`
  unless the value-set is closed and short.

## Forbidden patterns

(See rules 1 and 6 above for the broader prohibition on
`derived_table` and PDTs.)

- `SELECT *` anywhere — list the columns you actually use.
- Hardcoded date bounds in `sql:` (`WHERE created_at > '2025-01-01'`).
  Use a `parameter` of type `date` or `always_filter:` (rule 5).
- Hardcoded date bounds in a derived table's `sql:` block.
  Inject the user's filter via `{% condition main_view.dim_date_<TIMEFRAME> %}`
  against the column — pick the timeframe that matches what the
  dashboard actually filters (`date_date` for date pickers,
  `date_raw` only when the dashboard filters the raw timestamp).
  See [`derived_table_patterns.md`](./derived_table_patterns.md) rule 1.
- `_is_filtered` as a Yes/No gate on a `yesno` dimension's pushdown.
  `_is_filtered` fires for both `= Yes` and `= No`; using it as the
  only condition for an unconditional `EXISTS` block inverts results
  on `= No` filters. See [`derived_table_patterns.md`](./derived_table_patterns.md) rule 3.
- Mixing two unrelated tables in one view to "save a join". Use joins
  (rule 3).
- Copy-pasting field definitions across views. Use `extends:` (rule 9).
- Secrets in any LookML file or in `manifest.lkml`. There is no `.env`
  in a project repo at all (deliberately) — credentials live in
  `agents_setup`'s `db_access` CLIs only.

## File-level conventions

- Section headers with `# -------------------------` between groups.
- Snake_case field names everywhere.
- One blank line between dimensions / measures inside the same group.
- No trailing whitespace; LF line endings.
- LookML files end with a newline.

## Readability standards (refactor checklist)

In addition to the high-impact ten, every refactor — and every new
view file — must satisfy these readability standards. They have
zero behaviour impact (no value changes, no field renames) and are
always Tier 1 in
[`optimizing_existing_projects.md`](./optimizing_existing_projects.md).
The approval gate in [`../SKILL.md`](../SKILL.md) § Approval gate
still applies; the proposal block's *Standards applied* section
maps each change to the specific item below.

### R1. Field ordering inside a view

Read top-to-bottom in the same shape every time:

1. `dimension: pk` (with `primary_key: yes`, `hidden: yes`).
2. `dimension_group:` for every timestamp / date column.
3. String dimensions (sorted by domain — entity identifiers first,
   business buckets next, free-text last).
4. Boolean `is_<thing>` flags.
5. Hidden helper dimensions (`hidden: yes`).
6. Measures (count / count_distinct first, sums / averages, then
   filtered or composite measures).

Use `# --- DIMENSIONS ---` / `# --- HIDDEN HELPERS ---` /
`# --- MEASURES ---` section headers between blocks. A reader
searching for "where is the `<field>` defined" should know which
section to scan from the field's name alone.

### R2. `group_label:` on every public field

Every public dimension and measure declares `group_label:` with the
project's numbered scheme (`"1. DATE"`, `"2. CONTESTANT INFO"`,
`"3. ATTEMPT METRICS"`, …). Numbered prefixes order the field picker;
lexical order alone groups "Average" next to "Booking" next to
"Count" and is not useful. `group_item_label:` is set when the field
name and the picker label should differ (e.g. `bookings_count` shown
as "Count").

Hidden fields (`hidden: yes`) skip `group_label:` — they are not in
the picker.

### R3. `label:` and `description:` mandatory on every public field

Both required, both human-readable:

- `label:` — what the field is, in plain English (`"Validating
  carrier"`, not `"Validating_Carrier"` or `"vc"`).
- `description:` — what it means, what edge cases exist, and (when
  relevant) which underlying column it maps to. One sentence is
  fine; multi-line is fine. Treat it as the tooltip the analyst
  reads when picking the field.

The description must mention any non-obvious join behaviour (e.g.
"may multi-count when joined to `attempts` — use the
`bookings_count_distinct` measure on that explore"). If the
description would be empty, the field probably should not be
public — make it `hidden: yes` or delete it.

### R4. View file size — split with `extends:`

A view file over **~250 lines of LookML** (excluding comments and
blanks) is a refactor candidate. The usual splits:

- Extract a `view: <name>_base { extension: required … }` carrying
  the shared dimensions, then `extends: [<name>_base]` from the
  concrete views (rule 9). Live and test variants sharing the same
  fields are the canonical case.
- Extract per-domain views (`<entity>_payments`, `<entity>_finance`)
  joined to the parent rather than glued via dimensions on one
  monster view.

If a refactor's *Before → after* keeps the view above 250 lines, the
proposal explains why (e.g. "splitting would force a Tier 2 rename
of `pk_<x>` — deferred to a separate card").

### R5. `# Why:` comments are dated and signed

Any non-default LookML choice — `derived_table:` (rule 1 escape
hatch), hand-rolled `CASE WHEN` (rule 8 exception), `always_filter:`
that excludes a class of rows, a `sql_distinct_key:` whose
correctness is non-obvious — carries a comment of the form:

```lkml
# Why (2026-05-07, FM): Looker dialect lacks LATERAL flattening for
# the JSON `tags` array; NDT is the only way to expose them as
# rows without warehouse-side ETL.
derived_table: { … }
```

Format: `# Why (YYYY-MM-DD, <initials>): <reason>`. The date lets
the next reader judge whether the constraint still holds; the
initials let them ask. Plain `# TODO` / `# HACK` comments are not
acceptable on shipped LookML — either justify with `# Why:` or
delete.

### R6. Refactor checklist (mental walk-through before posting the proposal)

Walk through each item below before pasting the proposal block in
chat. The list is a search prompt for the agent — it does **not**
get dumped into the proposal (the block in
[`refactor_proposal.md`](./refactor_proposal.md) deliberately has
no per-rule section). If a refactor violates a rule on purpose, the
*Why* line in the proposal calls it out in plain language; the PR
description carries any longer justification.

- [ ] Rule 1 — `derived_table:` removed where avoidable, or `# Why:`
  justifies the remaining one.
- [ ] Rule 2 — no `${TABLE}.col` outside the lowest-level dimension
  that defines that column.
- [ ] Rule 3 — every join declares `relationship:` and `type:`
  explicitly.
- [ ] Rule 4 — every `primary_key: yes` is verified unique with a
  `db_access` query (paste the query in the proposal).
- [ ] Rule 5 — every explore has `always_filter:` or
  `conditionally_filter:`.
- [ ] Rule 6 — slow explores have `aggregate_table:` /
  `datagroup` + `max_cache_age:` where it pays off.
- [ ] Rule 7 — every additive measure behind a one-to-many join
  declares `sql_distinct_key:`.
- [ ] Rule 8 — enumerated dimensions use `case:`, not hand-rolled
  `CASE WHEN`, unless `# Why:` says otherwise.
- [ ] Rule 9 — shared field definitions live in an `extension:
  required` base view, not copy-pasted.
- [ ] Rule 10 — `query_sql` run after deploy; numbers compared
  against the LookML measure with `query`.
- [ ] R1 — fields ordered pk → date_group → string → boolean →
  hidden helpers → measures, with `# ---` section headers.
- [ ] R2 — every public field has a numbered `group_label:`.
- [ ] R3 — every public field has both `label:` and `description:`.
- [ ] R4 — view files under ~250 LookML lines, or the proposal
  explains why not.
- [ ] R5 — every non-default choice has a dated, signed `# Why:`
  comment.
- [ ] R6 — derived tables (rule 1 escape hatch) inject date / slice
  filters via `{% condition %}`, no hardcoded floors; `_is_filtered`
  is not used as a Yes/No gate. See
  [`derived_table_patterns.md`](./derived_table_patterns.md).

A change that satisfies all 16 items is a clean refactor. A change
that fixes 3 of them and leaves the rest untouched is fine —
incremental refactors are the norm. The proposal block does not
itemise which rules were touched (`refactor_proposal.md` keeps the
block lean); follow-up work that you deliberately deferred goes on
a separate Trello card and is named in the PR description.

## Testing

- Use the `db_access` CLIs in this repo
  (`.cursor/skills/db_access/scripts/mysql_query.py` /
  `clickhouse_query.py` / `mongo_query.py`) to sanity-check at least
  one measure before pushing — count of rows in the underlying table
  should match the count measure modulo any filters you applied.
- After pushing, run a Looker MCP `query` against the new explore to
  confirm Looker resolves the LookML and the connection works.
- Compare `query` numbers with `query_sql` (which returns the generated
  SQL Looker would run) when a discrepancy is suspected — paste the
  generated SQL into the DB CLI and run it directly.

## Git workflow inside a project repo

- Branch off `master` (or `main`, whichever the project uses).
- Branch name: `feature/<short-slug>` or `fix/<short-slug>`. Don't
  reuse the parent agent-setup repo's `automation/<shortLink>-<slug>`
  scheme inside project repos — those are different boards.
- Commits describe the LookML change, not the tooling that authored it.
- Open a PR per change so a Looker admin can review before pulling
  into the connected branch.
