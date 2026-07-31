# Ticketing

The last stage: turning a confirmed booking into issued tickets and finalizing its financial records. Runs in `post-air-booker` and the Ticketer.

_Schemas: `../../db_access/db-docs/mysql/booking_tasks.md`, `booking_statement_items.md`, `booking_statement_transactions.md`. Seeded 2026-07-30 from `debug_logs.md`; extend via the maintenance loop._

## Ticketer flow

Keyed by `debug_logs._scopes` / payload operations:

- **Ticketer** (marker in `_scopes`) — the main ticketing process.
- **AirTicketRQ** (operation in payload) — the actual request to the GDS (e.g. Sabre) to issue the tickets.
- **pending-statement-transaction** / **current-statement-item** — finalizing the financial records (statement items) during ticketing.
- **SessionCloseRQ** (operation in payload) — closes the GDS session once ticketing completes.

## Normal vs abnormal

- **Normal:** `Ticketer` fires → `AirTicketRQ` succeeds → statement items finalize → `SessionCloseRQ` closes the session. `ota.bookings.status` moves to issued.
- **Abnormal signals:** a confirmed booking stuck `not_issued`; `AirTicketRQ` returning a GDS error; a session that never closed; statement items not finalized. On staging / test bookings, `is_test=1` blocks real ticketing server-side — a `not_issued` test booking is expected, not a failure.

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** `Ticketer` scope, `AirTicketRQ` / `SessionCloseRQ` operations, statement-transaction contexts for one `transaction_id`.
- **MySQL `ota`:** `bookings.status`, `booking_tasks` (post-book task state), `booking_statement_items` / `booking_statement_transactions`.
- **Datadog:** ticketing-service traces / error tracking for GDS-side issuance failures.
- Full evidence map: [`observability.md`](observability.md).

## Note

Ticketing sits downstream of payment and booking — a ticketing symptom often has a root cause earlier in [`booking-flow.md`](booking-flow.md) or [`payments.md`](payments.md). Confirm the booking actually confirmed and was charged before treating this as a pure ticketing failure.
