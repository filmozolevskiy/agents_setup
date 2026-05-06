# bookability_built_contestant

**Database:** `ota`
**Purpose:** Junction table between a customer attempt and the specific fare contestant that was "built" for that attempt, including multiticket details.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key |
| `date_created` | `datetime` | When the built contestant was created |
| `customer_attempt_id` | `bigint` | ID of the customer booking attempt |
| `booking_contestant_id` | `bigint` | ID of the specific fare contestant |
| `multiticket_part` | `varchar(64)` | `master` (outbound), `slave` (inbound), or `NULL` |
| `contestant_type` | `varchar(64)` | Type of contestant (e.g., `eligible`) |

**Key relationships:**
- Joins to `bookability_customer_attempts` on `customer_attempt_id`
- Joins to `booking_contestants` on `booking_contestant_id`
|- Joins to `bookability_contestant_attempts` on `id = built_contestant_id`

**Common queries:**
```sql
-- Filter to only master or non-multiticket bookings to avoid double counting
SELECT * FROM ota.bookability_built_contestant 
WHERE multiticket_part = 'master' OR multiticket_part IS NULL
LIMIT 100;
```

**Notes:**
- Central junction table for bookability analysis.
