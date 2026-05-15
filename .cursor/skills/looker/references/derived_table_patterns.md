# Derived table SQL patterns

Rule 1 in [`lookml_best_practices.md`](./lookml_best_practices.md)
forbids `derived_table:` by default. When the escape hatches apply
(unavoidable window / pivot, aggregate-awareness fallback, NDT
explicitly requested), the SQL inside the derived table follows the
patterns below. Each pattern is here because skipping it has cost us
correctness or perf in production.

## 1. Pass the user's filter, do not hardcode

**Anti-pattern**

```sql
-- Hardcoded floor: scans years of data regardless of dashboard filter.
WHERE oc.created_at > TIMESTAMP('2025-01-01')
```

**Pattern**

```sql
WHERE {% condition main_view.dim_date_<TIMEFRAME> %} oc.created_at {% endcondition %}
```

Pick the timeframe that matches the dimension the dashboard actually
filters on. A `dimension_group: date { timeframes: [raw, date, …] }`
exposes `date_raw`, `date_date`, `date_week`, etc. Looker's
`{% condition %}` only fires for the *exact* timeframe field the
user filtered on:

| Dashboard filter form | Field filtered | Use in pivot WHERE |
|----------------------|----------------|--------------------|
| Date picker ("last 7 days", a specific date range) | `view.dim_date_date` | `{% condition view.dim_date_date %}` |
| Raw timestamp filter | `view.dim_date_raw` | `{% condition view.dim_date_raw %}` |
| Week / month / quarter pivot | `view.dim_date_<that timeframe>` | match exactly |

If no filter is applied, `{% condition %}` renders as `1=1` (full
scan fallback — that's by design). Verify by reading the rendered
SQL with `query_sql` or by pasting it from the dashboard tile's
"SQL" tab.

If you see `WHERE 1=1 -- no filter on 'view.dim_X'` in the rendered
SQL and the user clearly applied a date filter on the dashboard, you
referenced the wrong timeframe — fix the `{% condition %}` field to
match.

## 2. Multiple condition fragments stack

Push down every safely-pushable filter on the table-of-origin. Each
fragment is independent and renders to `1=1` when not filtered:

```sql
FROM ota.optimizer_candidates oc
STRAIGHT_JOIN ota.optimizer_candidate_tags oct ON oct.candidate_id = oc.id
WHERE {% condition main_view.dim_date_date %} oc.created_at {% endcondition %}
  AND {% condition main_view.gds %} oc.gds {% endcondition %}
  AND {% condition main_view.attempt_id %} oc.attempt_id {% endcondition %}
```

Safe to push down: columns that exist directly on the table you're
scanning. The derived table aggregates over `oc.*`, so any filter on
`oc.gds`, `oc.attempt_id`, `oc.created_at` narrows the scan correctly.

Not safe to push down: filters on dimensions computed by the
derived table itself (rule 3 below), filters on dimensions defined
on other views unless you add a join inside the derived table.

## 3. Boolean `yesno` dimensions — do not push down

**Anti-pattern**

```sql
{% if main_view.is_promoted._is_filtered %}
AND EXISTS (
  SELECT 1 FROM ota.optimizer_candidate_tags p
  JOIN ota.optimizer_tags pt ON pt.id = p.tag_id
  WHERE p.candidate_id = oc.id AND pt.name = 'Promoted'
)
{% endif %}
```

The bug: `_is_filtered` fires on both `= Yes` and `= No`. When the
user filters `is_promoted = No`, the EXISTS still fires, narrowing
the pivot to candidates that DO have a Promoted tag. The outer query
then keeps only candidates without the tag, but the pivot already
excluded them — every joined row comes back NULL.

**Pattern**

Let the outer query filter on the pivot column. It's slower per
"= Yes" filter (no narrowing of the candidate set inside the
derived table) but correct in every case:

```sql
-- In the pivot, no EXISTS block for boolean tags.
-- The outer dashboard query handles it:
WHERE optimizer_candidate_tags_pivot.is_promoted = 1
```

**When the pushdown is recoverable**

If you can prove `_filters['view.field']` resolves to a literal
string inside your derived-table `sql:` block (Looker version-
dependent — verify by rendering the SQL), you can gate the EXISTS
on `== 'Yes'`:

```sql
{% if main_view.is_promoted._is_filtered and _filters['main_view.is_promoted'] == 'Yes' %}
AND EXISTS ( … )
{% endif %}
```

Do not ship this without confirming the rendered SQL strips the
EXISTS on `= No` filters. We tried this once and reverted it (commit
[a6e3f4c](https://github.com/filmozolevskiy/content_integration_optimizer/commit/a6e3f4c))
in favour of the simpler "let outer filter handle it" pattern.

## 4. Force the join order with STRAIGHT_JOIN when MySQL's costs lie

MySQL's optimizer is cost-based and reads cardinality estimates from
the per-index histograms. With a small lookup table (e.g.
`optimizer_tags`, 21 rows) joined to a large fact table, the
optimizer will often choose to drive from the lookup table and apply
the WHERE on the fact table as a post-filter. That defeats a
date-windowed range scan that should run first.

Symptoms (in `EXPLAIN`):

- `key:` on the fact table is a tag-name or category index, not the
  date index
- `Using where` appears on the fact-table row instead of being part
  of the access path
- The fact-table `rows:` estimate × the number of lookup-table rows
  is the actual work, not the date-filtered slice

**Pattern**

```sql
FROM ota.optimizer_candidates oc            -- date-windowed via created_at_idx
STRAIGHT_JOIN ota.optimizer_candidate_tags oct ON oct.candidate_id = oc.id
STRAIGHT_JOIN ota.optimizer_tags ot ON ot.id = oct.tag_id
```

`STRAIGHT_JOIN` forces left-to-right evaluation; the optimizer's
cardinality guess is overridden. Verify with `EXPLAIN` that:

1. The first table's `key:` is the date index
2. Subsequent rows use `eq_ref` / `ref` against PK or canonical FK index

Document with a dated `# Why:` comment (R5 in
[`lookml_best_practices.md`](./lookml_best_practices.md)):

```sql
-- Why (2026-05-15, FM): MySQL prefers driving from optimizer_tags (21 rows)
-- and applying created_at as a post-filter — measured 78s vs 15.6s with
-- STRAIGHT_JOIN forcing candidates-first plan. EXPLAIN attached in PR #1.
FROM ota.optimizer_candidates oc
STRAIGHT_JOIN ...
```

## 5. Verification before declaring fast

Two queries to run before claiming a speed-up:

1. **`COUNT(*)` wrapper around the derived table.** Isolates the CTE
   cost from row-transfer and tile-render overhead. Reflects warehouse
   work only:

   ```sql
   SELECT COUNT(*) FROM (
     <the derived-table SQL with filters substituted in literally>
   ) sub;
   ```

   Time this via `.cursor/skills/db_access/scripts/mysql_query.py`.
   Numbers here go into the *Numbers* section of the proposal block
   ([`refactor_proposal.md`](./refactor_proposal.md)).

2. **`EXPLAIN` on the wrapped query.** Confirms the access path is
   what you think:

   ```sql
   EXPLAIN <the wrapped COUNT(*) query>;
   ```

   If `EXPLAIN` shows a different plan than expected (wrong join
   order, wrong index, full scan where a range scan was assumed), the
   speed-up will not materialize. Fix the LookML or document the
   limitation; do not ship and hope.

After the LookML is deployed:

3. Run the same `COUNT(*)` against the *generated* SQL (from
   `query_sql` or the dashboard tile's SQL tab) so the measurement
   includes Looker's actual rendering, not your hand-substituted
   version.

## 6. Document each derived table with the perf rationale

Every derived table carries a dated `# Why:` comment that names:

- Which rule 1 escape hatch applies (window / pivot / NDT / agg-
  awareness fallback)
- The measured baseline that justified materializing
- The verification protocol that confirmed parity

Example:

```lkml
view: optimizer_candidate_tags_pivot {
  derived_table: {
    # Why (2026-05-15, FM): collapses 10+ correlated GROUP_CONCAT
    # subqueries on optimizer_candidate_tags (rule 1 pivot escape
    # hatch). Baseline 27.2s on 7d window; this 15.6s; parity verified
    # against 73 dashboard tiles in PR #1.
    sql: ...
  }
}
```

A future reader can decide whether the constraint still holds without
re-running the entire investigation.
