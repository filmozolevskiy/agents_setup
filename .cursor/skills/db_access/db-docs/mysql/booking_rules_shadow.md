## booking_rules_shadow

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~527k (InnoDB estimate)  |  **Size:** ~1616 MB data
**Purpose:** One row per checkout booking-rules fetch that also has Route Happy data. Stores the Mini Rules answer, the Route Happy answer, and the per-dimension comparison used by Looker 1780.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key. `auto_increment`. |
| `log_id` | `char(24)` | Mongo `debug_logs._id` for the `booking-rules-from-package` document. Unique. |
| `search_id` | `varchar(32)` | Search / debug-log `transaction_id`. Indexed. |
| `package_id` | `varchar(32)` | Package id on that search. |
| `time_added` | `datetime(3)` | When the shadow row was written. Indexed. UTC (matches `debug_logs.date_added`). |
| `matches` | `tinyint` | `1` = Mini Rules and Route Happy agree on refund and exchange. `0` = at least one dimension disagrees. `NULL` = comparison could not decide (Mini Rules `serviceable` is `unknown`, or after the checkout skip there is no Mini Rules side). Indexed. **Do not treat `NULL` as “skip happened”** — `NULL` already exists without the skip. |
| `refund_mismatch` | `tinyint` | `1` when refund disagrees. `NULL` when that dimension was not compared. Indexed. |
| `exchange_mismatch` | `tinyint` | `1` when exchange disagrees. `NULL` when that dimension was not compared. Indexed. |
| `rules` | `json` | Mini Rules (or unknown) booking-rules object: `master` / `slave`, each with `void`, `refund.beforeDeparture|afterDeparture`, `exchange.beforeDeparture|afterDeparture`. `slave` is JSON `null` on single-ticket. |
| `rules_routehappy` | `json` | Same shape from Route Happy. |
| `rules_comparison` | `json` | Per-dimension comparison (`refund_before_departure`, …) with `amadeus` / `routehappy` / `match`. |

**Key relationships:**
- `search_id` = Mongo `ota.debug_logs.transaction_id` = MySQL `bookability_contestant_attempts.search_hash`
- `package_id` = `bookability_contestant_attempts.package_hash`
- `log_id` = `debug_logs._id` for `context = "booking-rules-from-package"`

**Common queries:**

```sql
-- Single-ticket checkouts where Mini Rules and Route Happy already agree.
-- Last 2h. UTC.
SELECT search_id, package_id, time_added, matches
FROM booking_rules_shadow
WHERE time_added >= NOW() - INTERVAL 2 HOUR
  AND matches = 1
  AND JSON_TYPE(JSON_EXTRACT(rules, '$.slave')) = 'NULL'
ORDER BY time_added DESC
LIMIT 10;
```

**Query guidance:**
- **Size class:** small (~0.5M rows) — still filter `time_added`.
- **Recommended constraints:** `time_added` (index `idx_time_added`). `search_id` for one session.
- **Typical date range:** rolling checkout traffic; not a long history table.
- Avoid joining a multi-hour shadow slice to `bookability_contestant_attempts` without a tight `time_added` window. A 6h join took ~57s on 2026-08-27.

**Notes:**
- Row exists only when the checkout booking-rules fetch also built a Route Happy comparison. No row ≠ Amadeus without Route Happy; it can also mean booking rules were never fetched.
- Last 24h verified 2026-08-27: 44,152 rows — `matches=1` 23,919; `matches=0` 17,206; `matches IS NULL` 3,027.
- Single-ticket vs multi-ticket: `JSON_TYPE(JSON_EXTRACT(rules, '$.slave')) = 'NULL'` vs `<> 'NULL'`.
- Looker: [https://flighthub.looker.com/dashboards/1780](https://flighthub.looker.com/dashboards/1780)
