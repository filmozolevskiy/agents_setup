# Database Documentation

Table- and collection-level documentation organized by engine. Each file covers one table or collection with schema details, query guidance, gotchas, and example SQL or MongoDB queries.

## Structure

```text
db-docs/
├── clickhouse/   # Tables queried via scripts/clickhouse_query.py
├── mysql/        # Tables queried via scripts/mysql_query.py
└── mongodb/      # Collections queried via scripts/mongo_query.py
```

The access tool determines the folder. Use `clickhouse/` for `clickhouse_query.py`, `mysql/` for
`mysql_query.py`, and `mongodb/` for `mongo_query.py`.


## Adding Table Documentation

Use the **document-table** skill (`.cursor/skills/document_table/SKILL.md`), or follow this template:

**Database:** `database_name`
**Purpose:** One-line description of what this table stores.
```
| Column | Type | Description |
|--------|------|-------------|
| `column_name` | `type` | What it represents |
```

**Key relationships:**
- Joins to `other_table` on `column`

**Common queries:**
```sql
-- Example: description of what this query does
SELECT ... FROM table_name WHERE ...
```

**Notes:**
- Any gotchas, quirks, or important context

## Documented Tables

Currently documented: 11 tables total.

### ClickHouse

| Table | Database | Purpose |
|-------|----------|---------|


### MySQL

| Table | Database | Purpose |
|-------|----------|---------|

