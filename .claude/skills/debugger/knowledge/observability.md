# Observability (evidence map)

Cross-cutting: for each subsystem, where the evidence lives. Use this to decide which store / tool to open once a subsystem file has named the hypothesis. Behavior of each subsystem is in its own file; this file is only the pointer map.

_Last updated 2026-11-04 (debug_logs query rules, evidence hierarchy). Seeded 2026-07-30. Datadog surfaces are largely undocumented — fill them in as investigations confirm the right services / dashboards._

## The join key (one value, three shapes)

```
ClickHouse  <table>.search_id
MySQL       bookability_contestant_attempts.search_hash  (also bookings.id_hash for a booking)
MongoDB     debug_logs.transaction_id  /  optimizer_logs.transaction_id
```

All the same string for a given transaction. `NULL` / empty means it cannot be correlated — handle separately. Resolve a `booking_id` → `search_hash` via the MySQL bookability tables (steps: [`booking-flow.md`](booking-flow.md#tracing-one-booking)). Rows with NULL or empty keys cannot be joined; list them apart and do not call them log-verified.

Before opening Mongo, check ClickHouse `jupiter_booking_errors_v2` (`../../db_access/db-docs/clickhouse/jupiter_booking_errors_v2.md`). It already has supplier `error_message`, `booking_step` and a class. Use Mongo for raw request / response bodies, a one-transaction timeline, or fields ClickHouse lacks (full NDC payload, 3DS and Payhub detail).

## Evidence by subsystem

| Subsystem | MySQL `ota` | ClickHouse `jupiter` | MongoDB `ota` | Datadog |
|-----------|-------------|----------------------|---------------|---------|
| [Search](search.md) | — | `search_api_stats_gds_raw` | `debug_logs` (search contexts) | search-service traces (TBD) |
| [Booking flow](booking-flow.md) | `bookability_customer_attempts`, `bookability_contestant_attempts`, `bookability_built_contestant`, `bookings` | `jupiter_booking_errors_v2` | `debug_logs` (`pre-checkout`, `Check Availability`, `pre-air-booker`, `Booking flow`, `post-air-booker`, `CancelProcessor`) | booker-service traces / error tracking (TBD) |
| [Optimizer](optimizer.md) | `optimizer_candidates`, `optimizer_attempts`, `optimizer_candidate_tags`, `optimizer_tags`, `optimizer_attempt_bookings` | — | `optimizer_logs` (`{Source}::Reprice-*`) | optimizer-service traces (TBD) |
| [Payments](payments.md) | `booking_statement_items`, `booking_statement_transactions`, `booking_virtual_card_statement_items` | `jupiter_booking_errors_v2` (`PAYMENT_ERRORS`) | `debug_logs` (`payhub_api_*`) | payment / Payhub service traces + error tracking (TBD) |
| [Content sources](content-sources.md) | `bookings` (`gds`, `gds_account_id`, `validating_carrier`) | `search_api_stats_gds_raw`, `jupiter_booking_errors_v2` | `debug_logs` (per-source contexts) | supplier-integration traces (TBD) |
| [Ticketing](ticketing.md) | `bookings.status`, `booking_tasks`, statement tables | — | `debug_logs` (`Ticketer`, `AirTicketRQ`, `SessionCloseRQ`) | ticketing-service traces / error tracking (TBD) |
| [Ancillaries](ancillaries.md) | `ancillaries_optimization_baggage(_options)`, `booking_passengers`, `booking_segments` | — | `debug_logs` (`available_fare_families`, `package`) | — |

## `debug_logs` query rules

- **Bound `date_added`** on every scan. `debug_logs` is a capped collection. Old events rotate out; say so when a window returns thin data. Never run `find {}`.
- **Exact `context` when known.** Do not `$regex` on `context`. Use a case-insensitive regex on the integration name only when the exact string is unknown.
- **Supplier text** often sits in top-level `Response` (or lowercase `response` for Amadeus). `$match` with `$regex` on that field beats `$expr` / `$concat` over stringified `meta`, which is slower and fails on non-string fields. Escape literal periods (`unique\.`).
- `mongo_query.py` accepts JSON only, so no `ISODate(...)`. For date-bounded pipelines use mongosh, Compass, or Python with pymongo. Mechanics: [`../../db_access/references/mongodb_query_mechanics.md`](../../db_access/references/mongodb_query_mechanics.md).
- **Prevalence:** after one clear signature, count it over 7 and 30 days with the same `$match` plus `$count` (and a distinct `transaction_id` count). One permalink does not prove a pattern. Spot-check a few other `transaction_id`s from the same failure bucket.
- Batch `transaction_id` lookups with `$in` (25 to 100 per batch) and always add the supplier `context`.
- Share supplier-side entries by permalink (shape below). Never paste raw JSON arrays into a report.

## Evidence hierarchy in `debug_logs`

Entries that store the raw supplier request or response beat local exceptions.
- **Conclusions** (root cause, what the supplier said) come from the supplier request / response entry.
- **Local exceptions, stack traces and generic wrappers** (`Unknown error`, `reason: failed`) are a map. Use them to find failures, cluster them and order events. They are not proof of supplier behavior when a nearby entry holds the real response.
- Reading order: supplier request / response first, then the exception that wraps it.
- Link the supplier entry first. Add the local exception entry only when it shows where our stack failed.

Supplier-error `context` values (booking-failure entry for one transaction):

| Step | `context` |
|------|-----------|
| Downtowntravel booking | `Downtowntravel::BookFlight` (`Response`), `Downtowntravel::BookFlight::Error` (`Error-Data`) |
| Downtowntravel price verification | `Downtowntravel::VerifyPrice::Error` |
| Post-Sale fare-increase reversal | `loss-limit-fare-increase` (take the one right after the successful Sale) |
| Payhub card decline | `payhub_api_response_Momentum\Payhub\Request\Sale` (`Response` body) |
| Amadeus | `amadeus-redux-api[<office>] <Op>` / `amadeus-sh4-api[<office>] <Op>`; see [`content-sources.md`](content-sources.md) |

If the context is unknown, run one `find` for the `transaction_id` (no context filter, `--limit 200`, sort `date_added` ascending), scan `context` for `Error` / `failed` / `decline`, and pick the entry.

## Permalinks

One click to the exact log entry:

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>
```

- Host is fixed. ResPro is shared across brands and `voyagesalacarte.ca` is its canonical host. Do not swap in brand hosts.
- `<transaction_id>` = MySQL `search_hash`. `<_id>` = the Mongo `_id` as 24-char hex (`{ $toString: "$_id" }`).
- A link without `#<_id>` opens the whole group, not the proof. For passing stages `?context=<stage context>` after the transaction id is fine.
- Harvest example (one representative link per transaction; run in mongosh or pymongo):

```javascript
[{ $match: { context: "Downtowntravel::BookFlight",
             Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
             date_added: { $gte: ISODate("2026-04-01T00:00:00Z"), $lte: ISODate("2026-05-01T00:00:00Z") } } },
 { $sort: { date_added: -1 } },
 { $group: { _id: "$transaction_id", last_seen: { $max: "$date_added" },
             link: { $first: { $concat: ["https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
                                         "$transaction_id", "#", { $toString: "$_id" }] } } } }]
```

Swap `$group` for `{ $count: "n" }` to get the match count.

## Optimizer logs

- `ota.optimizer_logs` joins to MySQL `optimizer_attempts.search_id` through `transaction_id`. Never scan it without a `transaction_id` and a `context` filter. It is a capped collection: old events may be missing, so say so when a date-bounded scan returns thin data.
- Permalink: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>` (same path as `debug_logs`; `_id` is 24-char hex).
- Payload shape varies by context. Some (unififi, pkfare) carry the body in top-level fields (`Request`, `Response`, `exception`, `packages`). Others carry `meta.*` placeholders; open the permalink to see the body.
- Multi-ticket reprice evidence: contexts `{Source}::Reprice-original-operands`, `{source}-api[{ACCOUNT}] search`, `Reprice <type>+{ACCOUNT}+{visibility}`. `_scopes` shows `Reprice[master_N]` or `Reprice[slave_N]`, one set per leg.
- MySQL: `optimizer_candidates` (~45M rows) and `optimizer_candidate_tags` (~42M rows) must always be bounded on `attempt_id` or a short `created_at` window. Join pattern: [`optimizer_join_pattern.md`](../../db_access/db-docs/mysql/optimizer_join_pattern.md).

## Tooling

- **Databases:** `.claude/skills/db_access/scripts/{mysql,clickhouse,mongo}_query.py`. Load `.env` once: `set -a && source .env && set +a`. Foundations + query discipline: [`../../db_access/SKILL.md`](../../db_access/SKILL.md); Mongo mechanics: [`../../db_access/references/mongodb_query_mechanics.md`](../../db_access/references/mongodb_query_mechanics.md).
- **Code:** sync then read — [`../../codebase_access/SKILL.md`](../../codebase_access/SKILL.md).
- **Datadog:** MCP server `datadog` (traces, APM, logs, error tracking, RUM). Setup / auth: https://docs.datadoghq.com/bits_ai/mcp_server/setup/; domain guides load via `load_datadog_skill`. Read-only.
- **Debug-logs UI (permalinks):** see [Permalinks](#permalinks).

## Maintenance

The Datadog column is the biggest gap. When an investigation confirms the service name, dashboard, or a useful saved query for a subsystem, propose it into the matching cell (with the exact identifier so the next session can reuse it), and bump `_index.md`.
