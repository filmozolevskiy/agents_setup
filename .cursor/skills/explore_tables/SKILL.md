---
name: meta-analyst:explore-tables
description: >
  Explore ClickHouse, MySQL, and MongoDB schemas to find tables or collections that contain
  specific information. Use when you need data from the database but db-docs/ doesn't cover
  the right table or collection, or when the user asks "which table has", "find table", "explore
  tables", "check database", "search database", "what table stores", or any question about where
  specific data lives. Also triggered automatically by meta-analyst:analyze when no documented table
  matches the query.
---

# Explore Tables Skill

You help the Flighthub team discover which database tables contain specific information.
This is the go-to skill when `db-docs/` doesn't have what you need — it systematically searches
ClickHouse, MySQL, and MongoDB schemas, presents candidates, and documents the best matches for
future use.

## Inputs

The user provides a **data concept** they're looking for — e.g., "booking block reasons", 
"payment statuses", "bookability_failures".

## Steps

### 1. Understand the data need

Parse the question to extract the core data concept. Identify:
- **What information** is being sought (e.g., "why bookings get blocked")
- **Keywords** to search for in table/column names (e.g., "block", "booking", "status", "reason")
- **Data nature** — is this analytical/aggregated (likely ClickHouse) or operational/transactional (likely MySQL)

If the concept is ambiguous, ask a clarifying question before proceeding.

### 2. Check existing `db-docs/`

Read all files in `db-docs/clickhouse/`, `db-docs/mysql/`, and `db-docs/mongodb/` to see if any
documented table or collection already covers the concept.

- **Full match found** → Report the table and stop. No exploration needed.
- **Partial match** → Note it (e.g., "revenue table has booking IDs but not block reasons") and continue exploring for better candidates.
- **No match** → Continue to Step 3.

### 3. Determine database scope

Ask the user: **"Do you know which database this might be in?"**

Present the options:
- **ClickHouse** — analytics warehouse (searches, clicks, revenue, competitiveness)
- **MySQL / OTA** — operational database (bookings, payments, users, fare rules, blocks)
- **MongoDB** — document / log / application data (varies by deployment; use when the user names Mongo or a known Mongo database)
- **Not sure** — explore the engines that fit the concept

If the user isn't sure, use your judgment based on the data concept:
- Analytics/aggregation concepts → start with ClickHouse
- Operational/transactional concepts → start with MySQL
- Document logs, flexible-schema events, or app-owned stores → consider MongoDB when applicable
- Explore other engines if the first yields no good candidates

### 4. Explore the schema

Use the appropriate script based on the database. ClickHouse and MySQL share `tables` / `describe`
/ `query`. MongoDB uses **`collections`**, **`describe`**, **`find`**, and **`aggregate`** (see
`scripts/mongo_query.py`).

```bash
# ClickHouse
set -a && source .env && set +a && python3 scripts/clickhouse_query.py tables [database]
set -a && source .env && set +a && python3 scripts/clickhouse_query.py describe <table> [database]
set -a && source .env && set +a && python3 scripts/clickhouse_query.py query "SELECT ... LIMIT 20"

# MySQL
set -a && source .env && set +a && python3 scripts/mysql_query.py tables [database]
set -a && source .env && set +a && python3 scripts/mysql_query.py describe <table> [database]
set -a && source .env && set +a && python3 scripts/mysql_query.py query "SELECT ... LIMIT 20"

# MongoDB (collections = equivalent of listing tables)
set -a && source .env && set +a && python3 scripts/mongo_query.py collections [database]
set -a && source .env && set +a && python3 scripts/mongo_query.py describe <collection> [database] --sample 3
set -a && source .env && set +a && python3 scripts/mongo_query.py find <collection> [database] --limit 20
```

#### 4a. List all tables or collections

Run `tables` (ClickHouse / MySQL) or **`collections`** (MongoDB). Scan names for keyword matches.

#### 4b. Search columns (if table names aren't obvious)

Search for column names matching your keywords:

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

Try multiple keyword variations (e.g., "block", "blocked", "block_reason", "status").

**MongoDB** — there is no `information_schema`. After shortlisting collections by name, use
`describe` and `find` / `aggregate` with small limits to inspect field names and values. For a quick
scan across keys, you can use an aggregation with `$objectToArray` on a small `$sample` when
appropriate.

#### 4c. Sample candidates in parallel

For the top 3-5 candidate tables or collections, run `describe` and sample queries (`query` with
`LIMIT 20` for SQL; `find --limit 20` for Mongo) **in parallel** using multiple Bash tool calls in a
single message. This dramatically speeds up exploration.

For each candidate, check:
- Do the columns make sense for the concept?
- Does the sample data actually contain the information sought?
- What's the row count and freshness (date ranges)?

### 5. Present candidates to the user

Show a ranked list of candidate tables:

```
### Candidate Tables

| # | Table | Database | Rows | Size | Confidence |
|---|-------|----------|------|------|------------|
| 1 | booking_blocks | MySQL | 2.3M | 450 MB | High |
| 2 | order_status_log | MySQL | 15M | 2.1 GB | Medium |
| 3 | booking_events | ClickHouse | 500M | 12 GB | Low |

**1. booking_blocks** (High confidence)
- Columns: `booking_id`, `block_reason`, `blocked_at`, `unblocked_at`, `blocked_by`
- Sample shows block reasons like "fraud_check", "payment_hold", "manual_review"
- Direct match for what you're looking for

**2. order_status_log** (Medium confidence)
- Has `status` column with values including "blocked", but also many other statuses
- Larger table, would need filtering

**3. booking_events** (Low confidence)
- Event-sourced table with booking lifecycle events
- Block events exist but mixed with all other events
```

For each candidate, explain:
- **Why** it's a candidate (which columns/values matched)
- **How** it could be used (what queries would answer the question)
- **Caveats** (size, filtering needed, data gaps)

Ask: **"Which table(s) should I document for future use?"**

### 6. Document and hand off

For each table the user selects:

1. **Invoke `meta-analyst:document-table`** — this creates proper documentation in `db-docs/`
2. **Summarize findings** for the next step in the workflow:
   - Which table to use and why
   - Key columns relevant to the original question
   - Recommended query patterns
   - Any joins needed with other tables

This summary allows the calling skill (e.g., `meta-analyst:analyze`) to pick up where
exploration left off and continue with the actual analysis.

## Important Notes

- **Always check `db-docs/` first** — don't waste time exploring if the answer is already documented.
- **Parallel is key** — when sampling multiple tables, always run queries in parallel.
- **Don't over-explore** — if a high-confidence candidate is found early, present it. Don't keep searching for the sake of completeness.
- **Column search is powerful** — table names can be misleading. Searching `system.columns` / `information_schema.COLUMNS` by column name often finds tables that name matching misses.
- **Ask before documenting** — always get user confirmation on which tables to document.
