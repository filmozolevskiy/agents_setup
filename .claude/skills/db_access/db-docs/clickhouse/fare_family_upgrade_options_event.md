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
| `has_atpco_features` | `Bool` | Route Happy (ATPCO) fare-family features were attached to the package. One value for the whole package, not per leg. See Notes. |
| `atpco_error` | `LowCardinality(Nullable(String))` | Always NULL: 0 of 43,073,797 events (2026-08-30 to 2026-09-29 NY, whole table). Route Happy errors are only in `ota.debug_logs`; see Notes. |
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
| `booking_id` | `Nullable(Int32)` | Booking this event resulted in. Set on `context='post-booking'` events only (6,758 / 6,758 rows on 2026-09-22 NY); NULL in every other context. Master leg only for multi-ticket. |

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
- **Booking link = `event_key`.** `booking_id` lands only on post-booking events; join them to checkout events on `event_key` (one search + one package; 1 key per booking, 1 key per checkout, several checkouts per key). Post-booking `checkout_id` is set only on ~6% of rows (mostly `mobile_app`) and never matches a checkout-context `checkout_id`. Coverage vs MySQL `ota.bookings` (`checkout_status='booked'`, `is_test=0`, sites 1/4, excluding `aborted` / `unconfirmed_segments` / `multiticket_booking_fail` cancels and slave legs): 99.1% on 2026-09-21 to 09-23; 99.95% of those with a PNR. Pending bookings, slave legs and failed bookings without a PNR have no post-booking event. ~1% of post-booking booking_ids are MySQL test bookings.
- **Revenue + `is_synthetic`** populated on ~13% of rows (7d), across both upgraded and non-upgraded packages. Confirm the revenue unit/scope with Brandon (sample values are small, e.g. 19.99 → 29.99).
- **`master_*` vs `slave_*`** = the two tickets of a multi-ticket combination.
- **`*_options_displayed_count = 1` means the original fare only — no upgrade.** An upgrade is available only when the count is `> 1`. Single-ticket checkout events with count 1 always carry `no_options_reason` and an empty `*_displayed_fare_family_names` (3,419 events on 2026-09-22 America/New_York); count ≥ 2 never carries a reason (0 events, 2026-09-18 to 09-24). Multi-ticket events never have count 1. Using `> 0` overstates checkout coverage by ~4 points (71.17% vs 67.18% on 2026-09-22).
- **`timestamp` is in the server timezone `America/New_York`** (`SELECT timezone()`), so `toDate(timestamp)` is a New York day. Looker filters `timestamp` without conversion, so Looker days are New York days too.
- Distributed engine does not report `total_rows`; count with a date filter or query the `_shard` table.
- **Duplicate event emission — no natural unique key.** The service emits some events multiple times as exact full-row copies (same `event_id`, `event_key`, `context`, `timestamp_micro`, and every other column). ~0.14% of rows are duplicates over 1 day (2,272 of ~1.60M); a single `event_id` can appear up to 5×. Every candidate composite key (`event_id`+`timestamp_micro`, `event_id`+`context`, `event_id`+`event_key`) collapses to the same distinct count as `event_id` alone, so no column combination dedups them. Consequence: `count(*)` over-reports by the duplicate rate. Use `uniqExact(event_id)` (ClickHouse) / a `count_distinct` measure on `event_id` (LookML) for entity counts. The LookML `primary_key: yes` on `event_id` is therefore an approximate key (~99.86% unique); acceptable only while the view has no joins. Flag to Brandon as a source-side QA item.
- **ATPCO miss = options filtered as Empty.** When the content source returns options but `has_atpco_features = False`, the options carry no fare-family features and the Empty filter removes all of them (2,991 of 3,206 Amadeus Fresh checkouts, 2026-09-22 to 09-28 NY; only 211 still displayed). With ATPCO, 90.2% of the same population displayed options. Miss rate on Fresh checkouts with options returned, same window: Amadeus 2.26%, ACNDC 1.58%, Farelogix 0.82%, FRONTIERNDC / NAVITAIRENDC 0%. By trip type: multi-city 22.95% (2,292 of 9,988), one-way 1.14%, round trip 0.51%.
- **Why ATPCO is missing** (496 Fresh checkouts with options returned and no ATPCO, 2026-09-28 NY, matched to `ota.debug_logs` by `search_id` = `transaction_id`): 399 (80%) our side — `…Package::addFeaturesToPackageCityPairs(): Segment count to city pair data mismatch` notice; Route Happy answered with data but we dropped it. 74 (15%) Route Happy `Segment #N is not matched` and 22 (4%) `Fare for flight … is not matched` in `response.itineraries[].errors.messages` (HTTP 200, empty `data`). 1 unexplained. Trello: https://trello.com/c/C86gUQB1. Log context details: [`debug_logs.md`](../mongodb/debug_logs.md) (Route Happy ATPCO miss row).
- **`ineligibility_reason = 'ineligible_for_alt_carrier'`** is new since 2026-09-23 (17 events on 09-21, 4 on 09-22, ~500/day after). Every event still has 1 option returned, named `CHEAPEST`, with `no_options_reason = all_options_filtered` and no upgrade source (3,228 checkout events 2026-09-22 to 09-28 NY). It inflates Options Returned for Ineligible checkouts; exclude Ineligible when measuring content-source performance.
- **Multi-ticket coverage is per leg.** A multi-ticket checkout counts as covered when either leg displayed options. Grouped by master carrier or master GDS, it credits the slave leg's coverage to the master (F8 / Intelisys showed ~16% with 0 master legs displayed). Use a leg-level split (master and slave fields paired) for coverage by carrier or content source. Intelisys (F8), NDCOne (DE) and low-cost carriers sold through Kiwi get `gds_no_options_reason = no_upsells_returned` from the Amadeus upgrade-source offices on every call (2026-09-22 to 09-28 NY).
