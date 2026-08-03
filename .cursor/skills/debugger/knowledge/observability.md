# Observability (evidence map)

Cross-cutting: for each subsystem, where the evidence lives. Use this to decide which store / tool to open once a subsystem file has named the hypothesis. Behavior of each subsystem is in its own file; this file is only the pointer map.

_Seeded 2026-07-30. Datadog surfaces are largely undocumented — fill them in as investigations confirm the right services / dashboards._

## The join key (one value, three shapes)

```
ClickHouse  <table>.search_id
MySQL       bookability_contestant_attempts.search_hash  (also bookings.id_hash for a booking)
MongoDB     debug_logs.transaction_id  /  optimizer_logs.transaction_id
```

All the same string for a given transaction. `NULL` / empty means it cannot be correlated — handle separately. Resolve a `booking_id` → `search_hash` via the MySQL bookability tables.

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

## Tooling

- **Databases:** `.cursor/skills/db_access/scripts/{mysql,clickhouse,mongo}_query.py`. Load `.env` once: `set -a && source .env && set +a`. Foundations + query discipline: [`../../db_access/SKILL.md`](../../db_access/SKILL.md); Mongo mechanics: [`../../db_access/references/mongodb_query_mechanics.md`](../../db_access/references/mongodb_query_mechanics.md).
- **Code:** sync then read — [`../../codebase_access/SKILL.md`](../../codebase_access/SKILL.md).
- **Datadog:** MCP server `plugin-datadog-datadog` (traces, APM, logs, error tracking, RUM). Setup / auth: the `ddsetup` skill under `~/.cursor/plugins/.../datadog/skills/`; if the server is unresponsive, `ddconfig`. Read-only.
- **Debug-logs UI (permalinks):** `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` — the canonical ResPro host; pin the exact log entry with `#<_id>`.

## Maintenance

The Datadog column is the biggest gap. When an investigation confirms the service name, dashboard, or a useful saved query for a subsystem, propose it into the matching cell (with the exact identifier so the next session can reuse it), and bump `_index.md`.
