# bookability_contestant_attempts

**Database:** `ota`
**Purpose:** Stores specific GDS errors and exceptions related to a fare contestant's booking attempt, including multiticket details.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key |
| `customer_attempt_id` | `bigint` | ID of the customer booking attempt |
| `date_created` | `datetime` | Timestamp of the attempt |
| `multiticket_part` | `varchar(10)` | `master`, `slave`, or `NULL` |
| `booking_id` | `bigint` | ID of the finalized booking (joins to `bookings`) |
| `search_hash` | `varchar(32)` | Hash identifying the search event |
| `package_hash` | `varchar(32)` | Hash identifying the flight package |
| `built_contestant_id` | `bigint` | ID of the built contestant (joins to `bookability_built_contestant`) |
| `validating_carrier` | `varchar(4)` | Airline carrier for the attempt |
| `office_id` | `varchar(32)` | GDS office ID for the attempt |
| `gds` | `varchar(32)` | GDS name (e.g., `amadeus`, `sabre`) |
| `error` | `varchar(255)` | Error reported by the GDS |
| `exception` | `varchar(255)` | Internal exception message from the code |
| `gds_error_message` | `varchar(255)` | Raw error from GDS |
| `status` | `varchar(32)` | Final status of this contestant attempt |

**Key relationships:**
- Joins to `bookability_customer_attempts` on `customer_attempt_id`
- Joins to `bookability_built_contestant` on `customer_attempt_id` and `multiticket_part`

**Common queries:**
```sql
-- Find GDS errors for a specific customer attempt
SELECT error, exception, gds_error_message 
FROM ota.bookability_contestant_attempts 
WHERE customer_attempt_id = 12345678;
```

**Notes:**
- Essential for debugging bookability failures and GDS-specific issues.
- Join with `multiticket_part` is necessary for split-booking scenarios.
