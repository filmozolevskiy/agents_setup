## fare_family_upgrade_options_event

**Database:** `upsells`
**Engine:** `Distributed` over `ReplicatedMergeTree` (local shard `fare_family_upgrade_options_event_shard`)  |  **Rows:** ~15.4M / 14 days (append-only event stream, ~1M+/day)  |  **Size:** ~421 MiB per shard
**Purpose:** One event row per fare-family upgrade-options computation/display attempt across the booking funnel. Emitted by the fare-family upsell service Brandon deployed (Trello [#3121](https://trello.com/c/0M6IVMyn)). Single-table replacement for the multi-source join behind the `checkout_with_upsell` Looker explore (which stitches `gtm_views.begin_checkout` + `jupiter.jupiter_fare_priceupsellwithoutpnr` + `jupiter.jupiter_consolidated` + `jupiter.jupiter_upsell_proposals`). Backs the `upsell_coverage_new` explore in the `fare_family` Looker project. Enables launching fare families with `aircanadandc` once QA passes.

**Verified:** 2026-07-28 (America/Toronto). Live to now.

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | `String` | Unique event id. Primary key in LookML. |
| `event_key` | `String` | Grouping key for related events (search_id + package scope). |
| `search_id` | `String` | Search this event belongs to. Join key to search-side data. |
| `base_package_id` | `String` | Package the upgrade options were computed from. |
| `current_package_id` | `Nullable(String)` | Package currently selected (set once upgraded). |
| `checkout_id` | `Nullable(String)` | Checkout id. Populated for `context='checkout'`; NULL/`undefined` for pre-checkout contexts by design. |
| `is_multiticket` | `Bool` | Multi-ticket combination (master + slave tickets). |
| `affiliate_id` | `Nullable(Int32)` | Affiliate. |
| `currency` | `LowCardinality(Nullable(String))` | Display currency. |
| `site_id` | `Nullable(Int32)` | Site. 1 and 4 are the main storefronts; 5 = agencia. |
| `device_type` | `LowCardinality(String)` | `desktop` (dominant), `mobile`, `mobile_app`, `tablet`. |
| `is_upgraded_package` | `Bool` | Event is for an already-upgraded package. |
| `timestamp` | `DateTime` | Event time (seconds). Main time dimension. |
| `timestamp_micro` | `DateTime64(6)` | Microsecond event time. |
| `context` | `LowCardinality(Nullable(String))` | Funnel stage: `search_results_preload` (~85%), `search_results`, `checkout`, `unknown` (mobile app / agencia gap), `post-booking`. |
| `is_eligible` | `Bool` | See Notes — almost always `False`; NOT an "upsell shown" flag. |
| `ineligibility_reason` | `LowCardinality(Nullable(String))` | Why ineligible. Dominated by `upsell_already_called_for_package` (dedup of repeated preloads); also `ineligible_for_inl`, `ineligible_for_bus_train`, `upsell_already_called_for_upgraded_package`, `ineligible_for_tablets`, `ineligible_for_carrier`. |
| `is_cached` | `Bool` | Result served from cache. ~98% True. |
| `master_upgrade_source` | `LowCardinality(Nullable(String))` | Upgrade source for the master ticket. |
| `slave_upgrade_source` | `LowCardinality(Nullable(String))` | Upgrade source for the slave ticket (multi-ticket). |
| `gds_no_options_reason` | `LowCardinality(Nullable(String))` | Why the GDS returned no options. |
| `master_gds_upsell_count` | `Int32` | GDS upsell options for the master ticket. |
| `slave_gds_upsell_count` | `Int32` | GDS upsell options for the slave ticket. |
| `master_fare_family_names` | `LowCardinality(String)` | Fare-family names offered (master). |
| `slave_fare_family_names` | `LowCardinality(String)` | Fare-family names offered (slave). |
| `has_atpco_features` | `Bool` | ATPCO fare-family feature data present. |
| `atpco_error` | `LowCardinality(Nullable(String))` | ATPCO error, if any. |
| `master_filtered_empty_count` / `slave_filtered_empty_count` | `Nullable(Int32)` | Options dropped as empty. |
| `master_filtered_cheaper_count` / `slave_filtered_cheaper_count` | `Nullable(Int32)` | Options dropped as cheaper than base. |
| `master_filtered_lesser_count` / `slave_filtered_lesser_count` | `Nullable(Int32)` | Options dropped as lesser value. |
| `master_filtered_multiticket_count` / `slave_filtered_multiticket_count` | `Nullable(Int32)` | Options dropped by multi-ticket rules. |
| `master_filtered_price_cap_count` / `slave_filtered_price_cap_count` | `Nullable(Int32)` | Options dropped by price cap. |
| `master_options_displayed_count` / `slave_options_displayed_count` | `Nullable(Int32)` | Options actually displayed to the user. |
| `master_displayed_fare_family_names` / `slave_displayed_fare_family_names` | `LowCardinality(Nullable(String))` | Fare-family names displayed. |
| `no_options_reason` | `LowCardinality(Nullable(String))` | Why nothing was shown: `None` (options shown), `no_options_found`, `all_options_filtered`, `one_option_found`. |
| `adt_pax_count` / `chd_pax_count` / `ins_pax_count` / `inl_pax_count` | `Int32` | Passenger counts by type (adult / child / infant-seat / infant-lap). |
| `trip_type` | `LowCardinality(Nullable(String))` | `oneway`, `roundtrip`, etc. |
| `master_marketing_carriers` / `slave_marketing_carriers` | `LowCardinality(String)` | Marketing carriers. |
| `master_operating_carriers` / `slave_operating_carriers` | `LowCardinality(String)` | Operating carriers. |
| `master_validating_carrier` / `slave_validating_carrier` | `LowCardinality(Nullable(String))` | Validating carrier. |
| `original_master_gds` / `original_slave_gds` | `LowCardinality(Nullable(String))` | GDS of the base package. |
| `current_master_gds` / `current_slave_gds` | `LowCardinality(Nullable(String))` | GDS of the current/upgraded package. |
| `original_master_office_id` / `original_slave_office_id` | `LowCardinality(Nullable(String))` | Office id of the base package. |
| `current_master_office_id` / `current_slave_office_id` | `LowCardinality(Nullable(String))` | Office id of the current/upgraded package. |
| `original_master_target_id` / `original_slave_target_id` | `Nullable(Int32)` | Target id of the base package. |
| `current_master_target_id` / `current_slave_target_id` | `Nullable(Int32)` | Target id of the current/upgraded package. |
| `original_air_revenue` | `Nullable(Float64)` | Air revenue before upgrade. Populated on ~13% of rows (see Notes). |
| `current_air_revenue` | `Nullable(Float64)` | Air revenue after upgrade. Populated with `original_air_revenue`. |
| `is_synthetic` | `Nullable(Bool)` | Synthetic upgrade selection. Populated on the same ~13% slice. |
| `booking_id` | `Nullable(Int32)` | Booking this event resulted in. Barely populated yet (~0.05% / 7d) — linkage fix pending (see Notes). |

**Key relationships:**
- `search_id` → search-side tables (same key used by `checkout_with_upsell`'s CTEs).
- `booking_id` → `ota.bookings.id` (MySQL) once populated — the cross-store link to revenue/ticketing.
- `checkout_id` → checkout-side events for `context='checkout'`.

**Common queries:**
```sql
-- Daily event volume by funnel stage
SELECT toDate(timestamp) AS d, context, count() AS n
FROM upsells.fare_family_upgrade_options_event
WHERE timestamp >= now() - INTERVAL 14 DAY
GROUP BY d, context ORDER BY d, n DESC;

-- checkout_id / booking_id gap inside checkout context, by site + device
SELECT site_id, device_type, count() AS n,
       countIf(checkout_id IS NULL OR checkout_id='' OR checkout_id='undefined') AS bad_checkout,
       countIf(booking_id IS NULL) AS no_booking
FROM upsells.fare_family_upgrade_options_event
WHERE timestamp >= now() - INTERVAL 3 DAY AND context='checkout'
GROUP BY site_id, device_type ORDER BY n DESC;

-- Revenue coverage
SELECT countIf(current_air_revenue IS NOT NULL) AS has_rev, count() AS total
FROM upsells.fare_family_upgrade_options_event
WHERE timestamp >= now() - INTERVAL 7 DAY;
```

**Query guidance:**
- **Size class:** large — ~1M+ rows/day. Always filter by `timestamp`.
- **Recommended constraints:** `timestamp` window; add `context` to avoid mixing funnel stages.
- **Typical date range:** live event stream; keep windows tight (days, not months).

**Notes:**
- **`ORDER BY timestamp DESC LIMIT` fails** on the distributed table with `CANNOT_PARSE_DATETIME` (`__topKFilter`) when combined with a string `WHERE`. Sample with a date-bounded filter and a plain `LIMIT` instead.
- **`is_eligible` semantics are not "upsell shown."** It is `True` on ~2 rows / 3 days; upgraded packages that displayed 3–6 options still carry `is_eligible=False`. Do not use `eligible_count` as a denominator (the scaffolded `upsell_coverage_new.upgrade_rate` measure does this and is unreliable). Confirm the intended meaning with Brandon before building rate metrics on it.
- **`checkout_id` "missing" ~95% overall is by design** — most events are pre-checkout (`search_results_preload`). Measure the gap only within `context='checkout'`, where it is now near-zero on main sites; the residual sits in `context='unknown'` (mobile app / agencia, site_id=5). Card notes context/checkout_id fixes for mobile land in August.
- **`booking_id` is present but not yet wired** — ~0.05% populated over 7 days. Treat booking-level joins as not-ready until this rises.
- **Revenue + `is_synthetic`** populated on ~13% of rows (7d), across both upgraded and non-upgraded packages. Confirm the revenue unit/scope with Brandon (sample values are small, e.g. 19.99 → 29.99).
- **`master_*` vs `slave_*`** = the two tickets of a multi-ticket combination.
- Distributed engine does not report `total_rows`; count with a date filter or query the `_shard` table.
- **Duplicate event emission — no natural unique key.** The service emits some events multiple times as exact full-row copies (same `event_id`, `event_key`, `context`, `timestamp_micro`, and every other column). ~0.14% of rows are duplicates over 1 day (2,272 of ~1.60M); a single `event_id` can appear up to 5×. Every candidate composite key (`event_id`+`timestamp_micro`, `event_id`+`context`, `event_id`+`event_key`) collapses to the same distinct count as `event_id` alone, so no column combination dedups them. Consequence: `count(*)` over-reports by the duplicate rate. Use `uniqExact(event_id)` (ClickHouse) / a `count_distinct` measure on `event_id` (LookML) for entity counts. The LookML `primary_key: yes` on `event_id` is therefore an approximate key (~99.86% unique); acceptable only while the view has no joins. Flag to Brandon as a source-side QA item.
