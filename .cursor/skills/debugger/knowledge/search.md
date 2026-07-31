# Search

From a user submitting a search to the results page listing flight options, and which content sources responded. The stage before checkout / booking-flow.

_Schemas: `../../db_access/db-docs/clickhouse/search_api_stats_gds_raw.md`. Terms ("search results page"): `../../../GLOSSARY.md`. Seeded 2026-07-30 from the qa_assistant skill; extend via the maintenance loop._

## What happens

- The user submits the search form; the platform fans the query out to content sources and assembles packages onto the **search results page** (`/flight/search`).
- Each search has a `transaction_id` (= `search_hash` in MySQL, `search_id` in ClickHouse). It threads through the whole downstream flow.
- **Search telemetry** answers "which content sources actually responded for this search" — the basis for deciding whether a missing supplier is a search problem or a later one.

## Normal vs abnormal

- **Normal:** the search returns packages; the expected content sources appear in telemetry; a package carries through to checkout with a stable price.
- **Abnormal signals:** no packages / empty results; an expected source absent from telemetry (it did not respond, vs it responded but was filtered later); a package on the results page that fails to reprice at `Check Availability` (that is a booking-flow symptom — see [`booking-flow.md`](booking-flow.md)).

## Diagnosing "wrong / missing supplier"

Order matters — establish where the source dropped out:
1. Did the source **respond** at search? Check `search_api_stats_gds_raw` for the `transaction_id`. Absent → search-side (supplier timeout / no inventory / not queried).
2. Responded but **not on results page** → filtering / packaging.
3. On results page but **not booked** → optimizer reroute or a checkout-stage failure ([`optimizer.md`](optimizer.md), [`booking-flow.md`](booking-flow.md)).

## Where to look (evidence map)

- **ClickHouse `jupiter`:** `search_api_stats_gds_raw` — per-source response stats for a search.
- **MongoDB `ota.debug_logs`:** search-stage contexts for one `transaction_id`.
- Full evidence map: [`observability.md`](observability.md).

## Hand off

Live reproduction of a search / results-page issue → [`../../qa_assistant/SKILL.md`](../../qa_assistant/SKILL.md) (`qa-search` + `qa-search-telemetry`).
