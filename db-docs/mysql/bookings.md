# bookings

**Database:** `ota`
**Purpose:** The central table for all finalized bookings, capturing customer information, pricing, status, and test flags.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key |
| `is_test` | `tinyint(1)` | `1` = test booking, `0` = real booking |
| `surfer_id` | `varchar(32)` | Unique user identifier |
| `date_added` | `datetime` | When the booking was created |
| `status` | `varchar(32)` | Final status of the booking |

**Key relationships:**
- Joins to `bookability_contestant_attempts` on `id = booking_id`

**Common queries:**
```sql
-- Filter out test bookings
SELECT * FROM ota.bookings WHERE is_test = 0 LIMIT 100;
```

**Notes:**
- Used to filter out test bookings during bookability analysis.
- Extremely large table; always filter by `date_added` or `id`.
