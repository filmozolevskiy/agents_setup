# bookability_customer_attempts

**Database:** `ota`
**Purpose:** Stores operational metadata for user attempts to book a flight, including content source, carrier, and office identifier.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key |
| `date_created` | `datetime` | Timestamp of the booking attempt |
| `source` | `varchar(64)` | The content source for the attempt (e.g., website domain) |
| `office_id` | `varchar(32)` | The GDS office ID where the attempt occurred |
| `gds` | `varchar(32)` | The GDS being used (e.g., `amadeus`, `sabre`) |
| `validating_carrier` | `varchar(4)` | The airline carrier being booked |
| `surfer_id` | `varchar(32)` | Unique user identifier (key for each customer) |
| `status` | `varchar(32)` | Final status of the attempt |

**Key relationships:**
- Joins to `bookability_built_contestant` on `id = customer_attempt_id`
- Joins to `bookability_contestant_attempts` on `id = customer_attempt_id`

**Common queries:**
```sql
-- Find common failures by carrier
SELECT validating_carrier, status, COUNT(*) 
FROM ota.bookability_customer_attempts 
WHERE date_created > NOW() - INTERVAL 1 DAY 
GROUP BY 1, 2;
```

**Notes:**
- Large table (18M+ rows). Always filter by `date_created` index.
