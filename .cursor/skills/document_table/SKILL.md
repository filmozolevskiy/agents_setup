---
name: document-table
description:
  Inspect a ClickHouse or MySQL table or MongoDB collection structure and sample data, infer its
  business purpose, and generate documentation saved to db-docs/. Use this skill whenever the user
  asks to document a table or collection, understand what it is for, create docs, add a table to
  db-docs, or says anything like "what does this table do" or "document the X table". Also trigger
  when the user mentions a table or collection name and wants to know its purpose or structure,
  even if they don't explicitly say "document". Works for ClickHouse (scripts/clickhouse_query.py),
  MySQL (scripts/mysql_query.py), and MongoDB (scripts/mongo_query.py).
---

# Document Table Skill

Produce a reference doc for a ClickHouse or MySQL table, or a MongoDB collection. The doc must let the next person query it without rediscovering its structure.

## Which script to use

| Engine     | Script                         | Env vars |
|------------|--------------------------------|----------|
| ClickHouse | `scripts/clickhouse_query.py`  | `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` |
| MySQL      | `scripts/mysql_query.py`       | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| MongoDB    | `scripts/mongo_query.py`       | `MONGODB_URI`, optional `MONGODB_DATABASE` (when the URI has no database path) |

ClickHouse and MySQL share `describe`, `query`, `tables`. ClickHouse also has `batch` (date-chunked queries with `{start}` / `{end}`) — use only when sampling or aggregating would time out; MySQL has no equivalent.

MongoDB uses `collections`, `describe` (indexes, estimated count, sample docs), `find` (filter / sort / limit; default limit 100), and `aggregate` (pipeline as JSON array). No SQL `query`.

If the engine is not specified, default to ClickHouse. Use MySQL or MongoDB if the user said so, named a known database, mentioned a collection, or the previous step used that script.

Optional discovery:

```bash
python3 scripts/clickhouse_query.py tables [database]
python3 scripts/mysql_query.py tables [database]
python3 scripts/mongo_query.py collections [database]
```

## Inputs

Table or collection name, optionally a database. If no database is given, use the default from the environment (`CLICKHOUSE_DATABASE`, `MYSQL_DATABASE`, or the database in `MONGODB_URI` / `MONGODB_DATABASE`).

## Steps

Load credentials once: `set -a && source .env && set +a`. All bash blocks assume that env.

### 1. Describe the table

**ClickHouse** — columns, types, default kinds, comments:

```bash
python3 scripts/clickhouse_query.py describe <table> [database]
```

**MySQL** — columns, types, key (PRI/UNI/MUL), default, extra (e.g. `auto_increment`):

```bash
python3 scripts/mysql_query.py describe <table> [database]
```

**MongoDB** — indexes, estimated document count, random sample docs (default `--sample 3`):

```bash
python3 scripts/mongo_query.py describe <collection> [database] [--sample N]
```

MongoDB has no column catalog. Infer fields from `describe` samples and the larger sample in Step 2.

Read column names and types closely — they usually reveal purpose (`booking_id`, `affiliate_name`, `margin_usd`). For MySQL, `key` and `extra` flag primary keys and auto-increment.

### 2. Sample 100 rows (latest first)

Do not use bare `LIMIT 100`. It returns arbitrary rows and documents stale data.

Pick one sort column that reflects recency, in this order:

1. Time column: `DateTime` / `Date` or names like `created_at`, `updated_at`, `timestamp`, `event_date`, `day_added`, `search_time`.
2. If no time column: a monotonic surrogate such as `id` or `*_id` when it clearly tracks insert order.
3. If neither fits: run an unordered `LIMIT 100` as a last resort and note in the doc ("sample is unordered; values may not reflect current usage").

Use `ORDER BY <sort_column> DESC` (add `NULLS LAST` on ClickHouse when the column is nullable). On very large ClickHouse tables, add a recent filter on a partition or date column in `WHERE` if the query is slow.

**ClickHouse:**

```bash
python3 scripts/clickhouse_query.py query "SELECT * FROM [database.]<table> ORDER BY <sort_column> DESC NULLS LAST LIMIT 100"
```

**MySQL** (with `MYSQL_DATABASE` set, a bare table name works; otherwise `database.table`; wrap reserved words in backticks):

```bash
python3 scripts/mysql_query.py query "SELECT * FROM <table> ORDER BY <sort_column> DESC LIMIT 100"
```

MySQL sorts NULLs first on `DESC`. If that hides real rows:
`ORDER BY <sort_column> IS NULL, <sort_column> DESC LIMIT 100`.

**MongoDB** — `find` defaults to `--limit 100`. Sort is JSON (`-1` = descending). Use `--json` for Extended JSON (ObjectIds, dates).

```bash
python3 scripts/mongo_query.py find <collection> [database] --sort '{"<sort_field>": -1}' --limit 100
```

Add `--filter '{"field": "value"}'` for a subset. For ad hoc analytics use `aggregate`:

```bash
python3 scripts/mongo_query.py aggregate <collection> '[{"$match": {...}}, {"$limit": 20}]' [database]
```

`aggregate` filters are JSON-only (no `ISODate` in the shell string). For date-bounded pipelines on large collections, use mongosh, Compass, or pymongo.

In the doc, name the sort column so readers know what "sample" means. For large append-only logs, list `date_added` (or the recency field used) under Recommended constraints, and note which top-level fields hold supplier payloads vs app exceptions (e.g. `Response` vs `message`).

Watch for: value patterns, NULLs, data freshness, status/flag columns, business logic hints.

### 3. Check table metadata

**ClickHouse:**

```bash
python3 scripts/clickhouse_query.py query "SELECT engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = '<database>' AND name = '<table>'"
```

**MySQL:**

```bash
python3 scripts/mysql_query.py query "SELECT ENGINE AS engine, TABLE_ROWS AS total_rows, CONCAT(ROUND(DATA_LENGTH / 1024 / 1024, 2), ' MB') AS size FROM information_schema.TABLES WHERE TABLE_SCHEMA = '<database>' AND TABLE_NAME = '<table>'"
```

For InnoDB, `TABLE_ROWS` in `information_schema` is an estimate. Say so in the doc if you rely on it. For an exact count: `SELECT COUNT(*) FROM <table>` (may be expensive).

**MongoDB** — use the estimated document count from Step 1 (`describe`). No `information_schema`; the index list from `describe` substitutes for engine / key hints. Use a `collStats` aggregation for storage stats if needed.

### 4. Draft the doc

Template:

```markdown
## <table_name>

**Database:** `<database_name>`
**Engine:** `<engine>`  |  **Rows:** `<total_rows>`  |  **Size:** `<size>`
**Purpose:** <One line: what this table stores and why it matters.>

| Column | Type | Description |
|--------|------|-------------|
| `column_name` | `type` | What it represents — business-specific |

**Key relationships:**
- Joins to `other_table` on `column` (what this join gives you)

**Common queries:**
```sql
-- What this query does
SELECT ... FROM table_name WHERE ...
```

**Query guidance:**
- **Size class:** <small / medium / large / very large> — <why, e.g. "~500M rows, always filter by date">
- **Recommended constraints:** <columns that should usually appear in WHERE>
- **Typical date range:** <how far back data goes and granularity>

**Notes:**
- Gotchas, quirks, context
```

Size classes:

- **small**: < 1M rows — no special constraints
- **medium**: 1M–50M rows — filtering recommended
- **large**: 50M–500M rows — always filter by date or partition key
- **very large**: > 500M rows — filter by date and at least one other dimension

ClickHouse: use partition key and engine from metadata + `system.tables` / column stats.
MySQL: use indexes (`describe` shows `key`), primary keys, typical time-range columns.
MongoDB: document observed field paths (including nested keys), index list from `describe`, and that schemas evolve — flag optional or sparse fields.

Column descriptions: be specific, list enum-like values seen, note FKs, group IDs / timestamps / metrics / dimensions mentally.

Purpose: tie to business questions (bookings, revenue). Flag uncertainty.

### 5. Confirm with the user

Show the draft. Ask:

- Is the purpose right?
- Any columns or fields misread or needing more context?
- Any relationships or common queries to add?

Apply feedback before saving.

### 6. Save to db-docs/

Save under the engine matching the script used:

- `scripts/clickhouse_query.py` → `db-docs/clickhouse/<table_name>.md`
- `scripts/mysql_query.py` → `db-docs/mysql/<table_name>.md`
- `scripts/mongo_query.py` → `db-docs/mongodb/<collection_name>.md`

Default to `db-docs/clickhouse/` unless the user specified MySQL, MongoDB, or exploration used `mysql_query.py` / `mongo_query.py`.

Filename: table or collection name, lowercase, as-is. After saving, tell the user the path.
