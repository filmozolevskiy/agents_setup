# ancillaries_optimization_baggage

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~146 (staging dev-testing 2026-03-27 → 2026-04-30 + early 2026-05-12 staging64 runs)  |  **Size:** ~0.1 MB data + ~0.2 MB indexes
**Purpose:** One row per `BaggageOptimization` call made during a confirmed booking — the new ancillaries / bags optimizer (Trello [#2435](https://trello.com/c/YLbz944q/2435-ancillaries-new-bags-system), genesis PRs #52602 → #52711 → #52723 → #52780 → #52655). Writes a header row even on error; the actual baggage options land in `ancillaries_optimization_baggage_options` keyed by `ancillaries_optimization_baggage_id`. Fire-and-forget (`awaitResults: false`) from `Mv_Ota_Air_Booker::createAncillaryServices`, so the optimizer runs even on `is_test=1` bookings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint unsigned` | Primary key. `auto_increment`. |
| `search_id` | `varchar(32)` | **Booking session ID — equals `bookings.debug_transaction_id`**, NOT the search hash returned by `qa-search` / `/storefront-api/search-init`. The path segment in `/checkout/billing/flight/<this>/…`. Indexed. |
| `package_id` | `varchar(32)` | The package chosen at checkout. Indexed. |
| `fare_type` | `varchar(20)` | `economy` / `business` / … |
| `is_upgraded` | `tinyint unsigned` | `1` when this row represents a fare-family upgrade scenario. Indexed. |
| `validating_carrier` | `varchar(3)` | VC airline code of the booked package (e.g. `AC`, `WS`). Indexed. |
| `affiliate_id` | `int` | Indexed. |
| `user_currency` / `site_currency` | `char(3)` | Currency the user saw vs the site's POS currency. Both indexed. |
| `provider_gds` | `varchar(50)` | **Fares supplier** — the GDS that priced the underlying booking package (`amadeus`, `dida`, `intelisys`, `flightroutes24`, `pkfare`, …). Lowercased values. Indexed. |
| `provider_office_id` | `varchar(50)` | Office / PCC on the fares side. Indexed. |
| `gds` | `varchar(50)` | **Baggage / ancillaries supplier** for THIS optimizer attempt. Distinct from `provider_gds`: e.g. `gordian` (ancillaries-only), `amadeus`, `dida`. Indexed. |
| `office_id` | `varchar(50)` | Office / PCC used on the baggage-supplier side (e.g. `YKXC42100` CAD, `LISPA2082` EUR). Indexed. |
| `created_at` | `timestamp` | Row write time. Indexed — primary time filter. Default `CURRENT_TIMESTAMP`. |
| `execution_milliseconds` | `bigint` | Wall-clock duration of the supplier call. `0` on early errors. |
| `item_count` | `int` | Number of options written into `ancillaries_optimization_baggage_options` for this row. `0` on errors. |
| `error` | `text` | `NULL` on success. Error signatures seen on staging: `Serviceability failure: airline_not_supported`, `GDS Error: request parameters 'data' or 'orderNo' must be provided`, `GDS Error: no ancillary`, `Incomplete search status [failed] returned`, `No fares found`, `No matching fares found`, `Total price above original`, Dida `request parameters 'data' or 'orderNo'`, Dida `expired offers`. |

**Key relationships:**

- `ancillaries_optimization_baggage.search_id = bookings.debug_transaction_id` — primary booking join. Empirically verified on booking `id=299443502` (staging64, 2026-05-12) which linked to 3 optimizer rows via `search_id = c73dec85856966b7c61ad4e25e8fe52e`.
- `ancillaries_optimization_baggage_options.ancillaries_optimization_baggage_id = ancillaries_optimization_baggage.id` — one-to-many: each option (`carry_on` / `first_checked` / `second_checked`) is a child row with `price`, `currency`, `weight`, `weight_unit`, `dimension`, `dimension_unit`, `marketing_carrier`, `operating_carrier`, `city_pair_index`, `segment_index`.

**Common queries:**

```sql
-- Coverage: was the bags optimizer called for a given confirmed booking?
SELECT b.id, b.pnr, b.gds, b.debug_transaction_id,
       COUNT(aob.id) AS optimizer_rows,
       SUM(aob.item_count) AS total_options,
       SUM(aob.error IS NOT NULL) AS error_rows
FROM bookings b
LEFT JOIN ancillaries_optimization_baggage aob
       ON aob.search_id = b.debug_transaction_id
WHERE b.id = <booking_id>
GROUP BY b.id;
```

```sql
-- Per-row detail for one booking (header + every option)
SELECT aob.id, aob.provider_gds, aob.gds, aob.error,
       aob.item_count, aob.execution_milliseconds, aob.is_upgraded,
       aoba.type, aoba.price, aoba.currency,
       aoba.weight, aoba.weight_unit, aoba.dimension, aoba.dimension_unit,
       aoba.marketing_carrier, aoba.operating_carrier,
       aoba.city_pair_index, aoba.segment_index
FROM ancillaries_optimization_baggage aob
LEFT JOIN ancillaries_optimization_baggage_options aoba
       ON aoba.ancillaries_optimization_baggage_id = aob.id
WHERE aob.search_id = '<bookings.debug_transaction_id>'
ORDER BY aob.id, aoba.id;
```

```sql
-- Provider failure rate, by fares supplier × baggage supplier × error
SELECT provider_gds, gds AS baggage_gds,
       SUBSTRING(error, 1, 120) AS error_signature,
       COUNT(*) AS attempts
FROM ancillaries_optimization_baggage
WHERE created_at >= NOW() - INTERVAL 24 HOUR
  AND error IS NOT NULL
GROUP BY provider_gds, gds, error_signature
ORDER BY attempts DESC;
```

```sql
-- NDC-ONE silence guard (must stay 0 once PR #52655 is live in prod —
-- the strategy excludes NDC-ONE)
SELECT COUNT(*) AS ndcone_rows_must_be_zero
FROM ancillaries_optimization_baggage
WHERE created_at >= NOW() - INTERVAL 24 HOUR
  AND (provider_gds = 'ndcone' OR gds = 'ndcone');
```

**Query guidance:**

- **Size class:** small (~150 rows today; staging dev-testing only). Will become large once PR #52655 lands in prod (one+ row per confirmed booking, ~all GDS).
- **Recommended constraints:** `created_at` window for any time-series; join via `search_id = bookings.debug_transaction_id` for booking-keyed questions.
- **Typical date range:** dev-testing 2026-03-27 → 2026-04-30 then silence; staging64 active again from 2026-05-12.

**Notes:**

- **Gordian is an ancillaries provider, not a fares content source.** It appears **only** in `gds` (and never in `provider_gds`), and it never appears in `bookings.gds` (0 `bookings.gds='Gordian'` rows in any 90-day window). Empirically (2026-05-12) Gordian sits on top of fares from `amadeus`, `dida`, `intelisys`, `flightroutes24`, `pkfare`. Do not write a "smoke test for booking on Gordian" — you cannot. The Gordian smoke test is: confirmed bookings on the supported fares suppliers should produce optimizer rows with `gds='gordian'` when that's the active baggage provider for that POS / carrier.
- **`provider_gds` vs `gds`** is the most-common confusion: `provider_gds` is the **fares** supplier (matches `bookings.gds` lowercased); `gds` is the **baggage** supplier called for this optimizer attempt. Always group both when reading failure rates.
- **`search_id` is the booking transaction_id**, NOT the search hash. Use `bookings.debug_transaction_id` to bridge from a confirmed booking to its optimizer rows; do not use `bookability_customer_attempts.search_hash` or the qa-search `transaction_id`/`search_id` for this table.
- **One booking writes multiple rows.** The booker fires the optimizer per office / per leg / per attempt — booking `299443502` (single one-way YUL → LAX Amadeus) wrote 3 rows on a single `search_id`. Aggregate carefully when reading coverage.
- **`weight_unit` casing varies** across providers (`kg` vs `KG`); downstream consumers must be case-insensitive. `dimension_unit` likewise (`cm` vs `CM`, and `None` for some Amadeus rows).
- **Imperial units (`LB` / `IN`) absent so far** in the staging dataset — needs a US-POS Amadeus booking on a carrier returning imperial (`UPTO50LB ... 62LI`) to exercise.
- **Optimizer is fire-and-forget** (`awaitResults: false`). Long supplier tails (`max_ms` > 30 s observed for Amadeus / Dida) do not slow the booking, but show on supplier p95 / p99. Any booking-confirm-latency regression after #52655 deploys = bug → revert.
- **`is_test=1` does not gate the optimizer.** Test bookings (autofill, qa-book) produce optimizer rows the same as real ones. Filter on `is_test` via the `bookings` join, not on the optimizer table itself.

