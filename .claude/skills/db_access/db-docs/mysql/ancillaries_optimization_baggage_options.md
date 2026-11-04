# ancillaries_optimization_baggage_options

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~218 (staging dev-testing through 2026-05-12)  |  **Size:** ~0.3 MB data + ~0.2 MB indexes
**Purpose:** One row per **baggage option** returned by the new ancillaries / bags optimizer (Trello [#2435](https://trello.com/c/YLbz944q/2435-ancillaries-new-bags-system), genesis PRs #52602 → #52655). Child of `ancillaries_optimization_baggage` — each header row spawns N option rows (one per `type` × city-pair × segment combination). Carries the priced bag, weight, dimension, carrier, and fare-basis context the supplier returned. Empty when the parent had `error IS NOT NULL`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint unsigned` | Primary key. `auto_increment`. |
| `ancillaries_optimization_baggage_id` | `bigint unsigned` | **FK to `ancillaries_optimization_baggage.id`** — the parent optimizer call. Indexed. |
| `city_pair_index` | `tinyint unsigned` | 0-based index of the city pair within the booking. Indexed. Default `0`. |
| `segment_index` | `tinyint unsigned` | 0-based index of the segment within the city pair. Indexed. Default `0`. |
| `currency` | `char(3)` | Option currency (`USD` / `CAD` / `EUR` seen). Indexed. |
| `key` | `varchar(500)` | Supplier-specific dedup key. Pipe-separated when one option covers multiple segments (e.g. `<hash>/0GO/first_checked/1/1/1\|<hash>/0GO/first_checked/1/2/1`). Sometimes base64-ish for Amadeus / Sabre legacy paths. Not human-readable; use for dedup, not display. |
| `departure_code` | `varchar(4)` | IATA airport / city code of segment departure (e.g. `YYZ`, `YHZ`). |
| `arrival_code` | `varchar(4)` | IATA airport / city code of segment arrival (e.g. `ORD`, `YYC`). |
| `departure_date` | `datetime` | Scheduled segment departure. Indexed. |
| `arrival_date` | `datetime` | Scheduled segment arrival. Indexed. |
| `marketing_carrier` | `char(3)` | Marketing airline (e.g. `AC`, `WS`, `AA`, `PD`). Indexed. |
| `operating_carrier` | `char(3)` | Operating airline. Often `NULL` on legacy paths; equals `marketing_carrier` on direct-marketing supplier responses. Indexed. |
| `fare_basis` | `varchar(50)` | Fare basis code that priced this bag (e.g. `VNN0AHM1`, `ACUD0QBJ`, `LK7J1HBK/SLO`). `NULL` when the supplier did not return one. Indexed. |
| `fare_family` | `varchar(50)` | Fare family / branded fare (e.g. `MAIN`, `BASIC`). `NULL` when supplier did not return one. |
| `flight_id` | `varchar(10)` | Supplier-side flight identifier (e.g. WestJet's numeric ID). `NULL` for some suppliers. |
| `type` | `varchar(150)` | **Bag type — the most useful dimension.** Observed values: `first_checked` (~55%), `second_checked` (~39%), `carry_on` (~5%). Indexed. |
| `price` | `decimal(10,2) unsigned` | Base price of the bag in `currency`. `0.00` seen on free-bag options. |
| `fees` | `decimal(10,2) unsigned` | Fees component (`10.00` constant in current staging dataset — likely a flat markup). |
| `total` | `decimal(10,2) unsigned` | `price + fees` (computed by the writer, not a generated column). Range seen `10.00` → `296.85`. |
| `weight_unit` | `varchar(20)` | Casing varies — `KG` / `kg` seen; downstream consumers must `LOWER()`. Imperial (`LB`) not yet observed on staging. |
| `weight` | `int unsigned` | Allowance in `weight_unit` (e.g. `23 KG`, `32 KG`). |
| `dimension_unit` | `varchar(20)` | Linear dimension unit. `CM` / `cm` / `None` seen. Imperial (`IN`) not yet observed. |
| `dimension` | `int unsigned` | Max linear dimension (sum of L+W+H, typically `157` / `158` cm). `NULL` on some legacy Amadeus / WestJet rows. |
| `payload` | `json` | Raw supplier-side payload for the option (debug / audit). Do not surface in Looker. |
| `codeshare_carrier_id` | `varchar(50)` | Codeshare carrier identifier when this leg is operated by a different carrier than the marketing carrier. Indexed. |
| `codeshare_carrier_name` | `varchar(100)` | Display name of the codeshare carrier. |

**Key relationships:**

- `ancillaries_optimization_baggage_options.ancillaries_optimization_baggage_id = ancillaries_optimization_baggage.id` — one parent → many options. Drives the join shape in the Looker `content_integration_ancillaries` model.
- Indirectly to `bookings` via the parent's `search_id = bookings.debug_transaction_id`. Join through the parent — never directly here.

**Common queries:**

```sql
-- Option mix per parent optimizer call
SELECT aob.id AS parent_id, aob.provider_gds, aob.gds AS baggage_gds,
       aoba.type, COUNT(*) opts,
       MIN(aoba.total) min_total, MAX(aoba.total) max_total,
       GROUP_CONCAT(DISTINCT aoba.currency) currs
FROM ancillaries_optimization_baggage aob
JOIN ancillaries_optimization_baggage_options aoba
       ON aoba.ancillaries_optimization_baggage_id = aob.id
WHERE aob.created_at >= NOW() - INTERVAL 30 DAY
GROUP BY aob.id, aob.provider_gds, aob.gds, aoba.type
ORDER BY aob.id DESC;
```

```sql
-- Average bag price by supplier × type × currency (last 30 days)
SELECT aob.gds AS baggage_gds, aoba.type, aoba.currency,
       COUNT(*) options_count,
       ROUND(AVG(aoba.total), 2) avg_total,
       MIN(aoba.total) min_total, MAX(aoba.total) max_total
FROM ancillaries_optimization_baggage aob
JOIN ancillaries_optimization_baggage_options aoba
       ON aoba.ancillaries_optimization_baggage_id = aob.id
WHERE aob.created_at >= NOW() - INTERVAL 30 DAY
GROUP BY aob.gds, aoba.type, aoba.currency
ORDER BY baggage_gds, type, currency;
```

```sql
-- Unit casing audit (must be case-insensitive downstream)
SELECT weight_unit, dimension_unit, COUNT(*) cnt
FROM ancillaries_optimization_baggage_options
GROUP BY weight_unit, dimension_unit
ORDER BY cnt DESC;
```

**Query guidance:**

- **Size class:** small (~220 rows today; staging-only). Will become medium/large once PR #52655 lands — one option row per bag type × city-pair × segment per confirmed booking.
- **Recommended constraints:** filter through the parent's `created_at` window. Never scan this table without a `JOIN ancillaries_optimization_baggage` time-bound.
- **Typical date range:** dev-testing 2026-03-27 → 2026-04-30 then silence; staging64 active again from 2026-05-12.

**Notes:**

- **Fees are a flat `10.00`** across every row in the current staging dataset — likely a placeholder markup, not a supplier value. Confirm with the optimizer team before treating it as supplier-real.
- **`type` cardinality is small** (`first_checked` / `second_checked` / `carry_on` only). Safe to use as a Looker dimension and tile pivot.
- **`weight_unit` / `dimension_unit` casing varies** (`KG` vs `kg`, `CM` vs `cm`, sometimes `None` string for dimension). LookML dimensions must `LOWER()` before grouping.
- **`key` is a dedup helper, not a display field.** Some rows store base64-ish encoded keys for legacy paths; do not parse it client-side.
- **`payload` is JSON debug** — leave it out of LookML to keep the explore lean.
- **Empty for error parents.** When `ancillaries_optimization_baggage.error IS NOT NULL`, no child rows are written. A `LEFT JOIN` from parent is the right shape for coverage / error mixes.
- **`operating_carrier` is frequently `NULL`** on legacy Amadeus / WestJet rows. Coalesce to `marketing_carrier` if a downstream tile needs a single carrier column.
- **One parent writes many options.** Booking `299443502` (single one-way Amadeus) produced 3 parent rows; each parent on a fares-priced supplier produces ~2–4 options per `type`. Aggregations must dedup on parent when comparing parent-level metrics, or count children directly when comparing per-option pricing.
