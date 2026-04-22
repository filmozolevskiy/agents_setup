---
name: bookability-analysis
description: >-
  Use when analyzing bookability, investigating why a fare or booking is not bookable,
  checking failure rates for a carrier, or addressing availability issues
  and price changes for a specific content source, carrier, or office.
  Use for deep bookability analysis: MySQL search_hash → MongoDB debug_logs, payment vs supplier
  attribution, and similar-errors reports.
  Use for single-booking investigation: trace the full flow (checkout, availability, booking, ticketing)
  for a given booking_id or search_hash to understand what went wrong.
---

# Bookability Analysis

You help the Flighthub team diagnose why specific fares or bookings cannot be finalized.
Investigations follow a two-stage shape: **SQL-based overview first**, then an **optional MongoDB
deep dive** driven by what the SQL surfaced.

**System context before digging:** read `db-docs/mongodb/debug_logs.md` (investigation sections,
glossary, content-source hints). For raw Mongo query mechanics (`transaction_id` / `context` /
`Response` filtering, JSON-only CLI, when to switch to mongosh / Compass / pymongo), load
[`.cursor/rules/mongodb.md`](../../rules/mongodb.md). Update `db-docs/mongodb/debug_logs.md` when
you confirm durable observability facts.

## Pick a workflow

| Trigger | Workflow | Reference |
|---------|----------|-----------|
| "Show failure rates for content source / carrier / office X", "bookability for Y" | **Standard bookability report** — SQL summary + failure details + error bucket, then offer a Mongo deep dive. | [`references/standard_bookability_report.md`](references/standard_bookability_report.md) |
| User supplies a `booking_id` or `search_hash` and asks "understand the flow" / "what went wrong" | **Single-booking flow investigation** — chronological narrative across `debug_logs`. | [`references/single_booking_investigation.md`](references/single_booking_investigation.md) |
| "Deep bookability analysis", "correlate logs", "supplier truth for failures", "similar-errors report" | **Deep bookability analysis** — MySQL `search_hash` list → `debug_logs` by `transaction_id`, bookability vs non-bookability attribution, grouped signatures with permalinks. | [`references/deep_bookability_analysis.md`](references/deep_bookability_analysis.md) |

If the user asks for "standard" work, run the standard report and **offer** the deep dive at the
end — do not jump to MongoDB preemptively.

## Cross-cutting references

- **Debug-log query patterns** (effective `$match` shape, evidence hierarchy, prevalence):
  [`references/debug_logs_query_patterns.md`](references/debug_logs_query_patterns.md).
- **Permalink harvest pipelines** (Variants A/B/C + URL shape):
  [`references/harvest_permalinks.md`](references/harvest_permalinks.md).
- **Trello formatting** (when posting findings to the Content Integration board):
  [`../trello_content_integration/SKILL.md`](../trello_content_integration/SKILL.md).
- **Exploring undocumented tables** (when a relevant table/collection is not in `db-docs/`):
  [`../explore_tables/SKILL.md`](../explore_tables/SKILL.md).

## Key data points (MySQL `ota`)

Used across all three workflows:

- `surfer_id` — unique user identifier.
- `multiticket_part` — `master` (outbound), `slave` (inbound), or `NULL`.
- `is_from_search` — `1` (from search), `0` (optimized).
- `bconta.status` — contestant outcome: `1` success, `0` failure (per content source attempt).
- `bcusta.status` — customer outcome: did the user end up booking on this attempt.
- `contestant_error` — GDS error code or generic label.
- `exception` — internal stack / wrapper text.
- `is_test` — `1` if `source LIKE '%staging%'` or explicitly flagged.
- `search_hash`, `package_hash` — identifying hashes. **`search_hash` = Mongo `transaction_id`**.

> Contestant attempts = our tries with different content sources. Customer attempts = what the
> customer ends up with.

## Base filters (shared by every workflow)

All metrics / exports must come from the same row set:

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` →
  `bookability_built_contestant`.
- `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- **Production only:** `(b.is_test = 0 OR b.is_test IS NULL)` (unless tests explicitly requested).
- **No multiticket double-count:** `(bbc.multiticket_part = 'master' OR bbc.multiticket_part IS NULL)`.
- **Time window:** bound `bcusta.date_created` (indexed) — never scan the full table.

Full SQL templates live in
[`references/standard_bookability_report.md`](references/standard_bookability_report.md) and
[`references/deep_bookability_analysis.md`](references/deep_bookability_analysis.md).

## Multi-ticket pair audits

Use when the ask is "find the combination of CARRIER_A + CARRIER_B (often the
same carrier twice) in multi-ticket bookings" — e.g. *"F8 + F8 across all
content sources except Intelysis"*, or any carrier-pair / content-source-pair
rule the product wants to introduce or audit. The grain is
**`ota.bookability_contestant_attempts`** (customer booking attempts), **not**
`ota.optimizer_candidates` — several low-cost carriers (notably Flair / F8)
do not surface in `optimizer_candidates` the same way as in the booking
pipeline, so optimizer-side queries silently return zero for carriers that
are plainly present in production. A card titled `OPTIMIZER: …` does not
change this; confirm the grain from the TODO itself.

Each multi-ticket customer attempt has two `bookability_contestant_attempts`
rows sharing one `search_hash`, one per `multiticket_part` (`master` /
`slave`). **Self-join on `search_hash`** so both halves' own
`validating_carrier`, `gds`, and `status` are directly comparable — do not
pivot via `GROUP BY customer_attempt_id` + `CASE WHEN multiticket_part =
'master' …`; the self-join is easier to read and debuggable in isolation.

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

For Trello cards that carry a TODO like *"write a query to find the
combination of X + Y"*, adapt this template directly and post the query (and
a short output sample) via the Trello comment flow in
[`../trello_content_integration/SKILL.md`](../trello_content_integration/SKILL.md#responding-to-todos--direct-requests-on-an-existing-card).

## Non-bookability errors (`contestant_error`)

Used by the **bookability success-rate denominator** — these codes are excluded from both
numerator and denominator because they are not "supplier said no" bookability failures. Extend
this list as stable codes appear.

- `payment_error` — payment / card path (card decline, charge failures, Payhub-side outcomes
  surfaced in MySQL).

**Bookability side:** every other contestant failure counts toward bookability, **including
`loss_limit_fare_increase`** (fare / limit / repricing during book).

If a deep dive (see [`deep_bookability_analysis.md`](references/deep_bookability_analysis.md))
shows payment evidence under a generic SQL code — or the reverse — reclassify in the
similar-errors report and flag **"SQL vs Mongo mismatch"**. Supplier evidence wins for
root-cause narrative.

If the user cares about a different split, state the list used in that report.

## MongoDB: collection choice

Deep dives always use **`ota.debug_logs`** — the main OTA debug log for the full flow (search
through booking / ticketing). Do **not** reach for `optimizer_logs` in a bookability
investigation; that collection is repricing-only and belongs to optimizer-specific work outside
this skill.
