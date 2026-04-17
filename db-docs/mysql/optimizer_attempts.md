## optimizer_attempts

**Database:** `ota` (default)
**Engine:** `InnoDB`  |  **Rows:** `~520K`  |  **Size:** `~1.7GB`
**Purpose:** Tracks each execution of the optimizer for a search, package selection, or checkout.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key |
| `checkout_id` | `varchar(32)` | ID of the checkout session (if applicable) |
| `search_id` | `varchar(32)` | ID of the search session |
| `package_id` | `varchar(32)` | ID of the selected package |
| `created_at` | `timestamp` | When the optimizer attempt started |
| `gds` | `varchar(30)` | Primary GDS involved in the attempt |
| `trip_type` | `enum` | Type of trip (`oneway`, `roundtrip`, `multi`) |
| `affiliate_id` | `int` | ID of the affiliate making the request |
| `package` | `json` | Full JSON representation of the selected package/fare |

**Key relationships:**
- Parent to `optimizer_candidates` (one attempt has many candidates)

**Common queries:**
```sql
-- Get details of a specific optimizer attempt
SELECT * FROM optimizer_attempts WHERE id = 6364862;
```

**Query guidance:**
- **Size class:** medium — ~520K rows, filter by `id`, `search_id`, or `created_at`.
- **Recommended constraints:** `id`, `search_id`, `created_at`.
- **Typical date range:** Data is kept for several months.

**Notes:**
- The `package` column contains a large JSON blob with full itinerary and pricing details.
