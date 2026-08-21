# Ticketing

The last stage: turning a confirmed booking into issued tickets and finalizing its financial records. Runs in `post-air-booker` and the Ticketer.

_Schemas: `../../db_access/db-docs/mysql/booking_tasks.md`, `booking_statement_items.md`, `booking_statement_transactions.md`. Tables `booking_wenrix_reservations` / `booking_wenrix_reservation_notifications` / `booking_work_orders` are undocumented in `db-docs/` as of 2026-08-13. Seeded 2026-07-30 from `debug_logs.md`; Wenrix queue vs agent-queue split confirmed 2026-08-13._

## Ticketer flow

Keyed by `debug_logs._scopes` / payload operations:

- **Ticketer** (marker in `_scopes`) — the main ticketing process.
- **AirTicketRQ** (operation in payload) — the actual request to the GDS (e.g. Sabre) to issue the tickets.
- **pending-statement-transaction** / **current-statement-item** — finalizing the financial records (statement items) during ticketing.
- **SessionCloseRQ** (operation in payload) — closes the GDS session once ticketing completes.

## Wenrix issuance

Amadeus offices on the Wenrix list (including `YKXC42100`) take the `ticket/issue-wenrix` work-order path, not a GDS agent queue.

1. `PushPreTicketingOptimizationPipe` POSTs to Wenrix `reservations`. Success is HTTP 201 plus a row in `booking_wenrix_reservations`.
2. `CheckPreTicketingOptimizationPipe` suspends the work order until Wenrix finishes or the issuance deadline hits. Log text: `Queued to Wenrix waiting for price optimization until …`.
3. Wenrix callbacks land in `booking_wenrix_reservation_notifications` (`optimizing_pnr` → `ticketed` / `rejected` / `optimization_halted`).
4. On `ticketed`, the pipeline resumes and still calls Amadeus `DocIssuance_IssueTicket`. Wenrix does not skip that Amadeus call.

**Do not read `booking_tasks.sent_to_queue` or `handle_type` as “queued to Wenrix”.** Those columns are the agent / GDS task queue. Wenrix send truth is the reservation row + `wenrix-api-call:reservations` log + work order `type = 'ticket/process'` with option `ticket/issue-wenrix`.

## Normal vs abnormal

- **Normal:** `Ticketer` fires → `AirTicketRQ` succeeds → statement items finalize → `SessionCloseRQ` closes the session. `ota.bookings.status` moves to issued.
- **Normal (Wenrix):** reservation HTTP 201 → work order `sleeping` while Wenrix optimizes → `ticketed` notification → Amadeus `DocIssuance_IssueTicket` returns `OK ETICKET WELL ISSUED` → `bookings.status` moves to issued and the ticketing task resolves.
- **Abnormal signals:** a confirmed booking stuck `not_issued`; `AirTicketRQ` returning a GDS error; a session that never closed; statement items not finalized. On staging / test bookings, `is_test=1` blocks real ticketing server-side — a `not_issued` test booking is expected, not a failure.
- **Abnormal (Wenrix):** agent says “not queued to Wenrix” because `sent_to_queue = 0` / `handle_type = manual`, but a `booking_wenrix_reservations` row already exists. Or Amadeus issued tickets (`booking_tickets` populated) while `bookings.status` stayed `not_issued` and the work order stayed `sleeping` — see bookability [`known_pitfalls.md`](../../bookability/references/known_pitfalls.md) (MySQL gone-away after issue).

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** `Ticketer` scope, `AirTicketRQ` / `SessionCloseRQ` operations, statement-transaction contexts for one `transaction_id`. Wenrix: `wenrix-api-call:reservations`, `CheckPreTicketingOptimizationPipe::suspend` / `::exit`, `amadeus-sh4-api[…] DocIssuance_IssueTicket_9_1`.
- **MySQL `ota`:** `bookings.status`, `booking_tasks` (post-book task state), `booking_statement_items` / `booking_statement_transactions`. Wenrix: `booking_wenrix_reservations`, `booking_wenrix_reservation_notifications`, `booking_work_orders` (`type = 'ticket/process'`), `booking_tickets`.
- **Datadog:** ticketing-service traces / error tracking for GDS-side issuance failures.
- Full evidence map: [`observability.md`](observability.md).

## Note

Ticketing sits downstream of payment and booking — a ticketing symptom often has a root cause earlier in [`booking-flow.md`](booking-flow.md) or [`payments.md`](payments.md). Confirm the booking actually confirmed and was charged before treating this as a pure ticketing failure.
