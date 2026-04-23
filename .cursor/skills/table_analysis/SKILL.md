---
name: table-analysis
description: >-
  Find and document ClickHouse, MySQL, or MongoDB tables and collections.
  Use when the user names a table or collection and wants its purpose, columns,
  or docs under `db-docs/`; when the user needs data but `db-docs/` does not cover
  the right table; or for any question like "which table has", "find table",
  "what table stores", "document the X table", "what does this table do",
  "explore tables", "check database", "search database". Handles both the
  exploration side (shortlist candidates from schema + samples) and the
  documentation side (save a reference doc under `db-docs/`). Works for
  ClickHouse (`scripts/clickhouse_query.py`), MySQL (`scripts/mysql_query.py`),
  and MongoDB (`scripts/mongo_query.py`). Other skills (e.g. `bookability_analysis`,
  `optimizer_analysis`) may invoke this when no documented table matches the
  question.
---

# Table Analysis Skill

Two entry points, one skill:

- **Explore** — the user needs data but does not know which table holds it. Shortlist candidates, pick the best, then document.
- **Document** — the user names a table or collection. Inspect structure and sample data, infer purpose, save docs under `db-docs/`.

When exploration finds a good candidate, continue straight into documentation. Do not hand off or re-enter the skill.

## Tooling

| Engine     | Script                         | Env vars |
|------------|--------------------------------|----------|
| ClickHouse | `scripts/clickhouse_query.py`  | `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` |
| MySQL      | `scripts/mysql_query.py`       | `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` |
| MongoDB    | `scripts/mongo_query.py`       | `MONGODB_URI`, optional `MONGODB_DATABASE` |

ClickHouse and MySQL share `tables`, `describe`, `query`. ClickHouse also has `batch` (date-chunked with `{start}` / `{end}`) — use only when sampling or aggregating would time out. MongoDB uses `collections`, `describe` (indexes, estimated count, sample docs), `find` (filter / sort / limit; default limit 100), and `aggregate` (pipeline as JSON array). No SQL `query` on Mongo.

Load credentials once per session: `set -a && source .env && set +a`. All commands below assume that env.

If the engine is not specified, default to ClickHouse. Use MySQL or MongoDB if the user said so, named a known database, mentioned a collection, or the previous step used that script.

## Pick the entry point

| Trigger | Entry point |
|---------|-------------|
| User names a table or collection ("document `bookings`", "what does `debug_logs` do") | **Document** — jump to § Document a table. |
| User describes data they need ("which table has block reasons", "find table with payment statuses") | **Explore** — § Explore first, then § Document for each table the user selects. |

---

## Explore

Goal: find which table or collection holds a given concept. Use when `db-docs/` does not already answer.

### 1. Parse the data need

Extract:
- What information is being sought (e.g. "why bookings get blocked").
- Keywords for name and column search (e.g. "block", "booking", "status", "reason").
- Data nature — analytical / aggregated (ClickHouse) vs operational / transactional (MySQL) vs document / log (MongoDB).

If the concept is ambiguous, ask one clarifying question before searching.

### 2. Check `db-docs/` first

Read files under `db-docs/clickhouse/`, `db-docs/mysql/`, `db-docs/mongodb/`.

- **Full match** → report the table, stop.
- **Partial match** → note it (e.g. "revenue table has booking IDs but not block reasons") and keep looking.
- **No match** → Step 3.

### 3. Pick the engine

Ask: "Do you know which database this might be in?"

Options:
- **ClickHouse** — analytics warehouse (searches, clicks, revenue, competitiveness).
- **MySQL / OTA** — operational data (bookings, payments, users, fare rules, blocks).
- **MongoDB** — document / log / app data (use when the user names Mongo or a known Mongo database).
- **Not sure** — explore the engines that fit the concept.

If the user is unsure:
- Analytics / aggregation → start ClickHouse.
- Operational / transactional → start MySQL.
- Document logs, flexible-schema events, app-owned stores → MongoDB.
- Move to other engines if the first has no good candidates.

### 4. Explore the schema

```bash
# ClickHouse
python3 scripts/clickhouse_query.py tables [database]
python3 scripts/clickhouse_query.py describe <table> [database]
python3 scripts/clickhouse_query.py query "SELECT ... LIMIT 20"

# MySQL
python3 scripts/mysql_query.py tables [database]
python3 scripts/mysql_query.py describe <table> [database]
python3 scripts/mysql_query.py query "SELECT ... LIMIT 20"

# MongoDB (collections = listing tables)
python3 scripts/mongo_query.py collections [database]
python3 scripts/mongo_query.py describe <collection> [database] --sample 3
python3 scripts/mongo_query.py find <collection> [database] --limit 20
```

#### 4a. List all tables or collections

Run `tables` (ClickHouse / MySQL) or `collections` (MongoDB). Scan names for keyword matches.

#### 4b. Search columns (if names are not obvious)

**ClickHouse:**
```sql
SELECT database, table, name, type
FROM system.columns
WHERE name LIKE '%keyword%'
ORDER BY database, table
```

**MySQL:**
```sql
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE
FROM information_schema.COLUMNS
WHERE COLUMN_NAME LIKE '%keyword%'
ORDER BY TABLE_SCHEMA, TABLE_NAME
```

Try keyword variations (e.g. "block", "blocked", "block_reason", "status").

**MongoDB** — no `information_schema`. Shortlist collections by name, then use `describe` and `find` / `aggregate` with small limits to inspect fields. For a cross-key scan, use an aggregation with `$objectToArray` on a small `$sample`.

**Efficiency (esp. logs like `debug_logs`):** constrain `date_added` (or the recency field) on large collections. Prefer equality on stable dimensions (`context`, `transaction_id`) over `$regex` on `context` when the exact string is known. After sampling one doc, query the field that actually holds the text (e.g. supplier `Response`) instead of searching stringified `meta` or stitching fields. See `.cursor/skills/bookability_analysis/references/debug_logs_query_patterns.md`.

#### 4c. Sample candidates in parallel

For the top 3–5 candidates, run `describe` and sample queries (`query` with `LIMIT 20` for SQL, `find --limit 20` for Mongo) in parallel, in a single message.

For each candidate, check:
- Do the columns fit the concept?
- Does the sample data actually contain what was asked for?
- Row count and freshness (date ranges).

### 5. Present candidates

Ranked list:

```
### Candidate Tables

| # | Table | Database | Rows | Size | Confidence |
|---|-------|----------|------|------|------------|
| 1 | booking_blocks | MySQL | 2.3M | 450 MB | High |
| 2 | order_status_log | MySQL | 15M | 2.1 GB | Medium |
| 3 | booking_events | ClickHouse | 500M | 12 GB | Low |

**1. booking_blocks** (High)
- Columns: `booking_id`, `block_reason`, `blocked_at`, `unblocked_at`, `blocked_by`
- Sample: block reasons "fraud_check", "payment_hold", "manual_review"
- Direct match.

**2. order_status_log** (Medium)
- `status` column has "blocked" among many others; needs filtering.

**3. booking_events** (Low)
- Event-sourced lifecycle events; block events mixed with everything else.
```

For each:
- Why it is a candidate (matching columns / values).
- How it could answer the question.
- Caveats (size, filtering, gaps).

Ask: "Which table(s) should I document for future use?"

For every selected table, continue into § Document a table. When you are done, summarize for the next step:

- Which table to use and why.
- Key columns relevant to the original question.
- Recommended query patterns.
- Joins needed with other tables.

The summary lets the calling skill (e.g. `bookability_analysis`) or the user continue the analysis.

### Exploration rules

- Check `db-docs/` first. Do not re-explore documented territory.
- Sample candidates in parallel.
- Do not over-explore. If a high-confidence candidate shows up early, present it.
- Column search beats name search. Table names mislead; `system.columns` / `information_schema.COLUMNS` finds what names miss.
- Get user confirmation before documenting.

---

## Document a table

Produce a reference doc that lets the next person query the table without rediscovering its structure.

### Inputs

Table or collection name, optionally a database. If no database is given, use the default from the environment (`CLICKHOUSE_DATABASE`, `MYSQL_DATABASE`, or the database in `MONGODB_URI` / `MONGODB_DATABASE`).

Optional discovery when the table name is unknown or uncertain:

```bash
python3 scripts/clickhouse_query.py tables [database]
python3 scripts/mysql_query.py tables [database]
python3 scripts/mongo_query.py collections [database]
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

- **small**: < 1M rows — no special constraints.
- **medium**: 1M–50M rows — filtering recommended.
- **large**: 50M–500M rows — always filter by date or partition key.
- **very large**: > 500M rows — filter by date and at least one other dimension.

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

### 6. Save to `db-docs/`

Save under the engine matching the script used:

- `scripts/clickhouse_query.py` → `db-docs/clickhouse/<table_name>.md`
- `scripts/mysql_query.py` → `db-docs/mysql/<table_name>.md`
- `scripts/mongo_query.py` → `db-docs/mongodb/<collection_name>.md`

Default to `db-docs/clickhouse/` unless the user specified MySQL, MongoDB, or exploration used `mysql_query.py` / `mongo_query.py`.

Filename: table or collection name, lowercase, as-is. After saving, tell the user the path.
