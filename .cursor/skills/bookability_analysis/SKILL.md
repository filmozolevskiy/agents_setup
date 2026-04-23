---
name: bookability-analysis
description: >-
  Use when analyzing bookability, investigating why a fare or booking is not bookable,
  checking failure rates for a carrier, or addressing availability issues
  and price changes for a specific content source, carrier, or office.
  Use for deep bookability analysis: ClickHouse jupiter_booking_errors_v2 for failure signatures,
  MySQL for rates + surfer/recovery, MongoDB debug_logs for raw payloads; payment vs supplier
  attribution, and similar-errors reports.
  Use for single-booking investigation: trace the full flow (checkout, availability, booking, ticketing)
  for a given booking_id or search_hash to understand what went wrong.
---

# Bookability Analysis

Diagnose why specific fares or bookings cannot be finalized. Every investigation follows one shape: SQL overview first (MySQL rates + ClickHouse failure signatures), then an optional MongoDB deep dive driven by what SQL surfaced.

**Before digging:** read `db-docs/mongodb/debug_logs.md` (investigation sections, glossary, content-source hints) and `db-docs/clickhouse/jupiter_booking_errors_v2.md` (error signature table, classification taxonomy). For raw Mongo query mechanics (`transaction_id` / `context` / `Response` filtering, JSON-only CLI, when to switch to mongosh / Compass / pymongo), load [`.cursor/rules/mongodb.md`](../../rules/mongodb.md). Update the matching doc when you confirm durable observability facts.

## Data sources and join key

Every workflow uses all three stores. Each has a fixed job — do not substitute one for another.

| Store | Table / collection | What it gives you | What it cannot give you |
|---|---|---|---|
| **MySQL** `ota` | `bookability_customer_attempts` ← `bookability_contestant_attempts` ← `bookability_built_contestant` (+ `bookings`) | Denominators (total attempts, successes), **contestant bookability success rate**, **customer recovery rate**, `surfer_id` repeats, multi-ticket `master` / `slave` split, single-booking ID resolution (`booking_id` → `search_hash`). | Real supplier error text. `bconta.error` is a coarse code (e.g. `flight_not_available_other`) — treat as fallback only. |
| **ClickHouse** `jupiter` | [`jupiter_booking_errors_v2`](../../../db-docs/clickhouse/jupiter_booking_errors_v2.md) | **Failure signatures**: raw `error_message` from supplier or integration, `booking_step`, `main_group_error` / `sub_group_error`, `classification_category` / `subcategory`, validating_carrier, route. Primary source for the § 3 error bucket and the similar-errors groupings. | Success rows, customer attempt grain, `surfer_id`, `booking_id`. Do not compute rates from this table. |
| **MongoDB** `ota.debug_logs` | OTA debug log for the full flow (search → book → ticket) | Raw request/response payloads, chronological flow for one `transaction_id`, supplier fields not captured by CH (e.g. NDC correlation IDs, full Response bodies). | Cross-source aggregate counts (expensive, rotated window). |

**Join key — one value in three shapes:**

```
ClickHouse  jupiter_booking_errors_v2.search_id
MySQL       bookability_contestant_attempts.search_hash
MongoDB     debug_logs.transaction_id
```

All three are the same string. `NULL` / empty `search_hash` rows cannot be correlated — list them separately.

**Row-count alignment (MySQL vs CH):** both stores count each contestant attempt — master and slave included — as a separate failing row. For the same window + `gds`, counts should match within ingestion-lag noise (≤ a handful of rows). A large gap is a signal something is off (test flag, window clock skew, ingestion lag).

## Pick a workflow

| Trigger | Workflow | Reference |
|---------|----------|-----------|
| "Show failure rates for content source / carrier / office X", "bookability for Y" | **Standard bookability report** — SQL summary + failure details + error bucket, then offer a Mongo deep dive. | [`references/standard_bookability_report.md`](references/standard_bookability_report.md) |
| User supplies a `booking_id` or `search_hash` and asks "understand the flow" / "what went wrong" | **Single-booking flow investigation** — chronological narrative across `debug_logs`. | [`references/single_booking_investigation.md`](references/single_booking_investigation.md) |
| "Deep bookability analysis", "correlate logs", "supplier truth for failures", "similar-errors report" | **Deep bookability analysis** — CH signatures + `search_id` list, MySQL cross-check for rates / `surfer_id` / MT, `debug_logs` by `transaction_id` when CH is too coarse, bookability vs non-bookability attribution, grouped signatures with permalinks. | [`references/deep_bookability_analysis.md`](references/deep_bookability_analysis.md) |

For a "standard" ask, run the standard report and offer the deep dive at the end. Do not jump to MongoDB preemptively.

## Cross-cutting references

- **ClickHouse error table** (signature source for § 3 error bucket + similar-errors groupings): [`db-docs/clickhouse/jupiter_booking_errors_v2.md`](../../../db-docs/clickhouse/jupiter_booking_errors_v2.md).
- **Debug-log query patterns** (effective `$match` shape, evidence hierarchy, prevalence): [`references/debug_logs_query_patterns.md`](references/debug_logs_query_patterns.md).
- **Permalink harvest pipelines** (Variants A/B/C + URL shape): [`references/harvest_permalinks.md`](references/harvest_permalinks.md).
- **Trello formatting** (posting findings to the Content Integration board): [`../trello_assistant/SKILL.md`](../trello_assistant/SKILL.md).
- **Exploring or documenting tables** (table / collection not in `db-docs/`, or needs fresh docs): [`../table_analysis/SKILL.md`](../table_analysis/SKILL.md).

## Key data points (MySQL `ota`)

Used across all three workflows:

- `surfer_id` — unique user.
- `multiticket_part` — `master` (outbound), `slave` (inbound), or `NULL`.
- `is_from_search` — `1` (from search), `0` (optimized).
- `bconta.status` — contestant outcome: `1` success, `0` failure (per content source attempt).
- `bcusta.status` — customer outcome: did the user book on this attempt.
- `contestant_error` — GDS error code or generic label.
- `exception` — internal stack / wrapper text.
- `is_test` — `1` if `source LIKE '%staging%'` or explicitly flagged.
- `search_hash`, `package_hash` — identifying hashes. `search_hash` = Mongo `transaction_id`.

> Contestant attempts = our tries with different content sources. Customer attempts = what the customer ends up with.

## Base filters (every workflow)

All metrics and exports must come from the same row set:

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` → `bookability_built_contestant`.
- `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- **Production only:** `(b.is_test = 0 OR b.is_test IS NULL)` (unless tests are requested).
- **Multi-ticket:** count master and slave rows separately. Each leg is a distinct contestant attempt and a distinct failure opportunity, so the default grain keeps both. Filter to `master` only (or run a self-join on `search_hash`) only for explicit MT-pair audits — see § *Multi-ticket pair audits*.
- **Time window:** bound `bcusta.date_created` (indexed). Never scan the full table.

Full SQL templates in [`references/standard_bookability_report.md`](references/standard_bookability_report.md) and [`references/deep_bookability_analysis.md`](references/deep_bookability_analysis.md).

## Multi-ticket pair audits

Use when the ask is "find the combination of CARRIER_A + CARRIER_B (often the same carrier twice) in multi-ticket bookings" — e.g. *"F8 + F8 across all content sources except Intelysis"*, or any carrier-pair / content-source-pair rule. The grain is `ota.bookability_contestant_attempts` (customer booking attempts), **not** `ota.optimizer_candidates`. Several low-cost carriers (notably Flair / F8) do not surface in `optimizer_candidates` the same way as in the booking pipeline, so optimizer-side queries silently return zero for carriers plainly present in production. A card titled `OPTIMIZER: …` does not change this; confirm the grain from the TODO itself.

Each multi-ticket customer attempt has two `bookability_contestant_attempts` rows sharing one `search_hash`, one per `multiticket_part` (`master` / `slave`). Self-join on `search_hash` so both halves' `validating_carrier`, `gds`, and `status` are directly comparable. Do not pivot via `GROUP BY customer_attempt_id` + `CASE WHEN multiticket_part = 'master' …`; the self-join is easier to read and debug in isolation.

```sql
-- F8 + F8 multi-ticket pairs by day and content-source pair (last 7d).
-- Swap carriers / window / grouping as needed. The content-source pair
-- (master_gds, slave_gds) keeps existing exceptions (e.g. `intelisys +
-- intelisys`) visible next to the cross-content-source combinations a new
-- rule would start affecting.
with mt_parts as (
    select
        master.date_created,
        master.booking_id,
        master.gds as master_gds,
        slave.gds  as slave_gds
    from ota.bookability_contestant_attempts master
    join ota.bookability_contestant_attempts slave
      on master.search_hash = slave.search_hash
    where master.multiticket_part    = 'master'
      and slave.multiticket_part     = 'slave'
      and master.validating_carrier  = 'F8'
      and slave.validating_carrier   = 'F8'
      and master.date_created > now() - interval 1 week
)
select DATE(date_created) dd, master_gds, slave_gds, count(*) bookings
from mt_parts
group by 1, 2, 3
order by 1 desc, bookings desc;
```

For Trello cards with a TODO like *"write a query to find the combination of X + Y"*, adapt this template and post the query (plus a short output sample) via the comment flow in [`../trello_assistant/SKILL.md`](../trello_assistant/SKILL.md#responding-to-todos--direct-requests-on-an-existing-card).

## Non-bookability errors (`contestant_error`)

Used by the bookability success-rate denominator. These codes are excluded from both numerator and denominator because they are not "supplier said no" bookability failures. Extend as stable codes appear.

- `payment_error` — payment / card path (card decline, charge failures, Payhub-side outcomes surfaced in MySQL). ClickHouse equivalent: `classification_category = 'PAYMENT_ERRORS'`.

**Bookability side:** every other contestant failure counts, including `loss_limit_fare_increase` (fare / limit / repricing during book).

If a deep dive (see [`deep_bookability_analysis.md`](references/deep_bookability_analysis.md)) shows payment evidence under a generic SQL code — or the reverse — reclassify in the similar-errors report and flag "SQL vs Mongo mismatch". Supplier evidence wins for root-cause narrative.

If the user cares about a different split, state the list used in that report.

## Error classification mapping (MySQL ↔ ClickHouse)

Two classification lenses coexist. State which lens you are using when you report numbers — they disagree on `FARE_INCREASES`.

| MySQL `bconta.error` | CH `classification_category` | Bookability-rate lens (this skill) | Integration-health lens (CH doc default) |
|---|---|---|---|
| `payment_error` | `PAYMENT_ERRORS` | Excluded (non-bookability) | Excluded (noise) |
| `loss_limit_fare_increase` | `FARE_INCREASES` | **Included** (bookability failure) | Excluded (noise) |
| `flight_not_available_other` | `FLIGHT_AVAILABILITY_ERRORS` | Included | Excluded (noise) |
| generic / empty / pricing wrappers | `PRICING_DISCREPANCY_ERRORS` | Included | Excluded (noise) |
| internal exceptions wrapped into `flight_not_available_other` or similar | `TECHNICAL_ERRORS`, `CONTENT_SOURCE_ERRORS`, `CUSTOMER_INPUT_ERRORS`, `OTHER` | Included | **Included** |

- **Bookability-rate lens** (this skill's default): only `PAYMENT_ERRORS` / `payment_error` is excluded from numerator and denominator. Everything else is a bookability failure — including fare increases.
- **Integration-health lens** (used by `content_integration_reporter` and the CH doc's scan recipe): also exclude `FLIGHT_AVAILABILITY_ERRORS`, `FARE_INCREASES`, `PRICING_DISCREPANCY_ERRORS` — only supplier / technical / customer-input / other survive. Use this when the question is "what integration issues should we open a ticket for", not "what is the bookability rate".

When a `bconta.error` code that is not in this table appears, classify by the CH `classification_category` of the same `search_hash` / `search_id` and add it here.

## MongoDB: collection choice

Deep dives always use `ota.debug_logs` — the main OTA debug log for the full flow (search through booking / ticketing). Do not use `optimizer_logs` in a bookability investigation; that collection is repricing-only and belongs to optimizer work.
