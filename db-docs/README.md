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

Note: MongoDB exploration is currently limited to the **`OTA`** database and the **`debug_logs`** and **`optimizer_logs`** collections.


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

Currently documented: 2 collections total.

### MySQL

| Table | Database | Purpose |
|-------|----------|---------|
| `bookability_customer_attempts` | `ota` | Core operational metadata for booking attempts |
| `booking_contestants` | `ota` | Fare contestants generated during booking flows |
| `bookability_built_contestant` | `ota` | Junction between attempts and contestants |
| `bookability_contestant_attempts` | `ota` | GDS errors and exceptions for built contestants |
| `bookings` | `ota` | Finalized bookings with pricing, status, and test flags |
| `optimizer_attempts` | `ota` | Each Optimizer execution for a search / package / checkout |
| `optimizer_candidates` | `ota` | Contestants (fare options) the Optimizer generated per attempt |
| `optimizer_candidate_tags` | `ota` | Key-value tags attached to optimizer candidates |
| `optimizer_tags` | `ota` | Reference table of tag names used by the Optimizer |
| `optimizer_attempt_bookings` | `ota` | Junction linking the winning candidate to its booking |

### MongoDB

| Collection | Database | Purpose |
|------------|----------|---------|
| `debug_logs` | `ota` | General debug and error logs from OTA processes |
| `optimizer_logs` | `ota` | Logs specifically related to the booking optimizer |

