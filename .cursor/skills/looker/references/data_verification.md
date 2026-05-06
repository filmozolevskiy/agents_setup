# Data verification

Whenever the agent claims a LookML field maps to a real column or that a
measure agrees with the underlying database, the claim must be backed by
evidence from the actual database. Looker's own answer is not enough —
LookML can be wrong about what it points at, and silent mistakes in a
view file are exactly what verification is supposed to catch.

## Two-layer protocol

| Layer | What it asks | How |
|-------|--------------|-----|
| Schema | Does every column the LookML references actually exist on the table? Right type? | Delegate to `table_analysis`; cross-check with `scripts/<db>_query.py describe <table>`. |
| Numeric | Does the LookML measure return what a hand-written query says? | Run the LookML measure with `query` (Looker MCP), run the equivalent SQL via the DB CLI, compare. |

Both layers are required for any new view, and any time the user says
"verify this measure".

## Schema layer

1. Open the project's view file. Note every `${TABLE}.col` reference
   and every column referenced inside `derived_table` SQL.
2. Look in `db-docs/` first
   (`.cursor/skills/db_access/db-docs/<engine>/<table>.md`). If the
   table is documented, the column list there is canonical.
3. If the table is not documented, run the `table_analysis` skill to
   produce a doc, or fall back to:

   ```bash
   set -a && source .env && set +a && \
     python3 .cursor/skills/db_access/scripts/mysql_query.py describe <table> <db>
   ```

   (substitute `clickhouse_query.py` / `mongo_query.py` for non-MySQL).
4. For each column in the LookML, confirm it appears in the doc /
   `describe` output. Flag missing columns; do not silently rename.

## Numeric layer

1. Pick the measure under scrutiny (e.g. `bookings.bookings_count`).
2. Run it via Looker:

   ```text
   query
     model:   <project_name>
     explore: <explore>
     fields:  ["<view>.<measure>"]
     filters: { ...same filters as the SQL counterpart... }
     limit:   1
   ```

3. Run the equivalent SQL via the DB CLI:

   ```bash
   set -a && source .env && set +a && \
     python3 .cursor/skills/db_access/scripts/mysql_query.py query "SELECT COUNT(*) FROM <db>.<table> WHERE ..."
   ```

4. Compare. ± a few rows is normal (in-flight inserts between the two
   calls). A large gap means the LookML and the hand-written query
   disagree — investigate which one is wrong before changing anything.

## When `query` and the DB CLI disagree

- Use `query_sql` (Looker MCP) to dump the SQL Looker generates. Paste
  it into the DB CLI and run it directly. Three possible outcomes:
  - The generated SQL returns the same number as Looker → Looker is
    consistent with itself; the hand-written SQL is asking a different
    question. Reconcile filters / time bounds.
  - The generated SQL returns the same number as the hand-written SQL
    → the LookML is fine; whoever cached the Looker tile is stale.
    Re-run the dashboard / clear the tile cache.
  - The generated SQL diverges from both → there's a real bug somewhere
    (LookML, the connection, or the data). Report it; do not paper
    over it.
- Whatever you find, write it up: include the LookML measure name, the
  Looker number, the SQL number, the generated SQL, and which path you
  took to reconcile.

## Smoke-test pattern

The `looker_skill_smoketest_bookings` project's smoke test is the
canonical example. Same pattern works for any project:

```text
1. table_analysis on ota.bookings (or read db-docs/mysql/bookings.md).
2. query → bookings.bookings_count, filter is_test=no, last 30d.
3. mysql_query.py → SELECT COUNT(*) FROM ota.bookings WHERE is_test=0 AND booking_date > NOW() - INTERVAL 30 DAY.
4. Compare. Numbers within drift tolerance → smoke test passes.
```

If step 4 fails, do not change LookML to make the numbers match. Stop,
report both numbers, and let the user decide.
