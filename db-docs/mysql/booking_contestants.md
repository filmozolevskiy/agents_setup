# booking_contestants

**Database:** `ota`
**Purpose:** Stores specific fare "contestants" generated during the booking flow, identifying whether they come from search or were optimized.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key |
| `booking_id` | `int` | Related booking identifier |
| `search_id` | `varchar(32)` | Unique ID for the search event (cross-references with MongoDB) |
| `is_original` | `tinyint(1)` | 1 = from original search, 0 = optimized result |
| `gds` | `enum(...)` | The GDS used for this contestant |
| `is_booked` | `tinyint(1)` | Whether this specific contestant was selected and booked |
| `date_added` | `datetime` | When the contestant was created |

**Key relationships:**
- Joins to `bookability_built_contestant` on `id = booking_contestant_id`

**Common queries:**
```sql
-- Count original vs optimized contestants
SELECT is_original, COUNT(*) 
FROM ota.booking_contestants 
WHERE date_added > NOW() - INTERVAL 1 DAY 
GROUP BY 1;
```

**Notes:**
- Extremely large table (148M+ rows, 271 GB). Use `search_id` or `booking_id` indexes for filtering.
