---
name: explore-tables
description: >
  Explore ClickHouse, MySQL, and MongoDB schemas to find tables or collections that contain
  specific information. Use when you need data from the database but db-docs/ doesn't cover
  the right table or collection, or when the user asks "which table has", "find table", "explore
  tables", "check database", "search database", "what table stores", or any question about where
  specific data lives. Other skills (e.g. `bookability-analysis`) may invoke this when no
  documented table matches the question.
---

# Explore Tables Skill

Find which table or collection holds a given piece of data. Use when `db-docs/` does not already answer it. The goal: shortlist candidates, pick the best one, and document it for reuse.

## Inputs

A data concept — e.g. "booking block reasons", "payment statuses", "bookability_failures".

## Steps

### 1. Parse the data need

Extract:
- What information is being sought (e.g. "why bookings get blocked")
- Keywords for name search (e.g. "block", "booking", "status", "reason")
- Data nature — analytical/aggregated (ClickHouse) vs operational/transactional (MySQL)

If the concept is ambiguous, ask one clarifying question before searching.

### 2. Check `db-docs/` first

Read files under `db-docs/clickhouse/`, `db-docs/mysql/`, `db-docs/mongodb/`.

- **Full match** → report the table, stop.
- **Partial match** → note it (e.g. "revenue table has booking IDs but not block reasons") and keep looking.
- **No match** → go to Step 3.

### 3. Pick the engine

Ask: "Do you know which database this might be in?"

Options:
- **ClickHouse** — analytics warehouse (searches, clicks, revenue, competitiveness)
- **MySQL / OTA** — operational data (bookings, payments, users, fare rules, blocks)
- **MongoDB** — document / log / app data (use when the user names Mongo or a known Mongo database)
- **Not sure** — explore the engines that fit the concept

If the user is unsure:
- Analytics / aggregation → start ClickHouse
- Operational / transactional → start MySQL
- Document logs, flexible-schema events, app-owned stores → MongoDB
- Move to other engines if the first has no good candidates.

### 4. Explore the schema

ClickHouse and MySQL share `tables` / `describe` / `query`. MongoDB uses `collections`, `describe`, `find`, `aggregate` (see `scripts/mongo_query.py`).

Load credentials once: `set -a && source .env && set +a`. All commands below assume that env.

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
- Why it is a candidate (matching columns / values)
- How it could answer the question
- Caveats (size, filtering, gaps)

Ask: "Which table(s) should I document for future use?"

### 6. Document and hand off

For each selected table:

1. Invoke the `document-table` skill (`.cursor/skills/document_table/SKILL.md`) to add proper docs under `db-docs/`.
2. Summarize for the next step:
   - Which table to use and why
   - Key columns relevant to the original question
   - Recommended query patterns
   - Joins needed with other tables

The summary lets the calling skill (e.g. `bookability-analysis`) or the user continue the analysis.

## Rules

- Check `db-docs/` first. Do not re-explore documented territory.
- Sample candidates in parallel.
- Do not over-explore. If a high-confidence candidate shows up early, present it.
- Column search beats name search. Table names mislead; `system.columns` / `information_schema.COLUMNS` finds what names miss.
- Get user confirmation before documenting.
