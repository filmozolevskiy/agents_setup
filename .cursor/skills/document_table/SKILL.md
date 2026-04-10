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

You help the Flighthub team understand and document ClickHouse and MySQL tables and MongoDB
collections. The goal is to produce a clear reference doc that future team members can use to
quickly understand what a table or collection stores, how it relates to other data, and how to
query it effectively.

## Which script to use

| Engine     | Script                         | Env vars |
|------------|--------------------------------|----------|
| ClickHouse | `scripts/clickhouse_query.py`  | `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` |
| MySQL      | `scripts/mysql_query.py`       | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| MongoDB    | `scripts/mongo_query.py`       | `MONGODB_URI`, optional `MONGODB_DATABASE` (when the URI has no database path) |

ClickHouse and MySQL share `describe`, `query`, and `tables`. ClickHouse also has `batch`
(date-chunked queries with `{start}` / `{end}`) for very large tables — use only when sampling or
aggregating would otherwise time out; MySQL has no equivalent in this repo.

MongoDB uses **`collections`** (list collections), **`describe`** (indexes, estimated count, sample
docs), **`find`** (filter / sort / limit; default limit 100), and **`aggregate`** (pipeline as JSON
array). There is no SQL `query` subcommand — use `find` or `aggregate` instead.

If the user does not specify an engine, prefer ClickHouse unless they said MySQL or MongoDB, named a
known MySQL-only database, mentioned a collection, or you are continuing from a specific script’s
output.

Optional discovery:

```bash
set -a && source .env && set +a
python3 scripts/clickhouse_query.py tables [database]
python3 scripts/mysql_query.py tables [database]
python3 scripts/mongo_query.py collections [database]
```

## Inputs

The user provides a **table or collection name** and optionally a **database name**. If no
database is given, use the default from the environment (`CLICKHOUSE_DATABASE`, `MYSQL_DATABASE`, or
for MongoDB the database in `MONGODB_URI` / `MONGODB_DATABASE`).

## Steps

Always load credentials first:

```bash
set -a && source .env && set +a
```

### 1. Describe the table

**ClickHouse** — columns, types, default kinds, comments:

```bash
python3 scripts/clickhouse_query.py describe <table> [database]
```

**MySQL** — columns, types, key (PRI/UNI/MUL), default, extra (e.g. `auto_increment`):

```bash
python3 scripts/mysql_query.py describe <table> [database]
```

**MongoDB** — indexes, estimated document count, and random sample documents (default `--sample 3`):

```bash
python3 scripts/mongo_query.py describe <collection> [database] [--sample N]
```

There is no SQL-style column catalog; infer fields from `describe` samples and from the larger find
sample in Step 2.

Read the output carefully — column names and types often reveal purpose (e.g. `booking_id`,
`affiliate_name`, `margin_usd`). For MySQL, `key` and `extra` hint at primary keys and auto-increment.

### 2. Sample 100 rows (latest first)

Do **not** use bare `LIMIT 100` — that returns an arbitrary slice (often oldest or physical order) and
misleadingly documents stale data.

After **Step 1**, pick one **sort column** that reflects recency, in this order of preference:

1. **Time columns:** `DateTime` / `Date`, or names like `created_at`, `updated_at`, `timestamp`,
   `event_date`, `day_added`, `search_time`, etc.
2. **If no time column:** a monotonic surrogate such as `id` or `*_id` when it clearly tracks insert
   order (common in logs).
3. **If neither fits:** run an unordered `LIMIT 100` only as a last resort and **say so in the doc’s
   Notes** (“sample is unordered; values may not reflect current usage”).

Use **`ORDER BY <sort_column> DESC`** (and **`NULLS LAST`** on ClickHouse when the column can be
NULL). On very large ClickHouse tables, if the query is slow or times out, add a **recent** filter on
a partition or date column in `WHERE`, then keep `ORDER BY ... DESC LIMIT 100`.

**ClickHouse:**

```bash
python3 scripts/clickhouse_query.py query "SELECT * FROM [database.]<table> ORDER BY <sort_column> DESC NULLS LAST LIMIT 100"
```

**MySQL** (with `MYSQL_DATABASE` set, a bare table name is enough; otherwise use `database.table`; wrap the name in backticks if it is a reserved word):

```bash
python3 scripts/mysql_query.py query "SELECT * FROM <table> ORDER BY <sort_column> DESC LIMIT 100"
```

(MySQL sorts NULLs first on `DESC`; if that hides real rows, use
`ORDER BY <sort_column> IS NULL, <sort_column> DESC LIMIT 100`.)

**MongoDB** — `find` defaults to `--limit 100`. Pass sort as JSON (`-1` = descending). Use `--json`
for Extended JSON (ObjectIds, dates).

```bash
python3 scripts/mongo_query.py find <collection> [database] --sort '{"<sort_field>": -1}' --limit 100
```

Add `--filter '{"field": "value"}'` when you need a subset. For ad hoc analytics use `aggregate`:

```bash
python3 scripts/mongo_query.py aggregate <collection> '[{"$match": {...}}, {"$limit": 20}]' [database]
```

`aggregate` filters are JSON-only (no `ISODate` in the shell string); for date-bounded pipelines on
large collections, use mongosh, Compass, or Python with pymongo.

In the saved doc, mention which column you sorted by so readers know what “sample” means. For
**large append-only logs**, list **`date_added`** (or the recency field you used) under **Recommended
constraints**, and note which top-level fields hold **supplier payloads** vs **app exceptions** when
you observe them (e.g. `Response` vs `message`).

Pay attention to: value patterns, NULLs, **how recent** the data looks, status/flag columns, and
business logic hints.

### 3. Check table metadata

**ClickHouse:**

```bash
python3 scripts/clickhouse_query.py query "SELECT engine, total_rows, formatReadableSize(total_bytes) AS size FROM system.tables WHERE database = '<database>' AND name = '<table>'"
```

**MySQL:**

```bash
python3 scripts/mysql_query.py query "SELECT ENGINE AS engine, TABLE_ROWS AS total_rows, CONCAT(ROUND(DATA_LENGTH / 1024 / 1024, 2), ' MB') AS size FROM information_schema.TABLES WHERE TABLE_SCHEMA = '<database>' AND TABLE_NAME = '<table>'"
```

For **InnoDB**, `TABLE_ROWS` in `information_schema` is an **estimate**, not an exact count — say so
in the doc if you rely on it. For an exact MySQL row count when needed: `SELECT COUNT(*) FROM
<table>` (may be expensive on huge tables).

**MongoDB** — use the **estimated document count** from Step 1 (`describe`). MongoDB has no
`information_schema`; index list from `describe` substitutes for “engine” / key hints. For
storage stats you can run a `collStats` aggregation when needed (optional).

### 4. Analyze and draft documentation

Based on everything gathered, draft documentation following this template:

```markdown
## <table_name>

**Database:** `<database_name>`
**Engine:** `<engine>`  |  **Rows:** `<total_rows>`  |  **Size:** `<size>`
**Purpose:** <One-line description of what this table stores and why it matters to the business.>

| Column | Type | Description |
|--------|------|-------------|
| `column_name` | `type` | What it represents — be specific and business-oriented |

**Key relationships:**
- Joins to `other_table` on `column` (explain what this join gives you)

**Common queries:**
```sql
-- Example: description of what this query does
SELECT ... FROM table_name WHERE ...
```

**Query guidance:**
- **Size class:** <small / medium / large / very large> — <brief explanation, e.g., "~500M rows, always filter by date">
- **Recommended constraints:** <columns that should usually appear in WHERE to avoid full scans>
- **Typical date range:** <how far back data goes and granularity>

**Notes:**
- Any gotchas, quirks, or important context
```

**Query guidance** helps future skills query safely. Size classes:

- **small**: < 1M rows — no special constraints needed
- **medium**: 1M–50M rows — filtering recommended
- **large**: 50M–500M rows — always filter by date or partition key
- **very large**: > 500M rows — filter by date and at least one other dimension

For **ClickHouse**, use partition key and engine from metadata + `system.tables` / column stats.
For **MySQL**, use indexes (`describe` shows `key`), primary keys, and typical time-range columns.
For **MongoDB**, document observed field paths (including nested keys), index list from `describe`,
and that schemas can evolve — call out optional or sparse fields.

When writing column descriptions: be business-specific; list enum-like values you saw; note FKs;
group IDs, timestamps, metrics, and dimensions mentally.

When inferring purpose: tie to business questions (bookings, revenue); flag uncertainty for the user.

### 5. Confirm with the user

Present the draft and ask:

- Does the purpose description look right?
- Any columns or fields misunderstood or needing more context?
- Any relationships or common queries to add?

Incorporate feedback before saving.

### 6. Save to db-docs/

Save under the engine that matches the script you used:

- `scripts/clickhouse_query.py` → `db-docs/clickhouse/<table_name>.md`
- `scripts/mysql_query.py` → `db-docs/mysql/<table_name>.md`
- `scripts/mongo_query.py` → `db-docs/mongodb/<collection_name>.md`

Default to `db-docs/clickhouse/` unless the user specified MySQL, MongoDB, or exploration used
`mysql_query.py` / `mongo_query.py`.

Filename: table or collection name, lowercase, as-is. After saving, tell the user the path.
