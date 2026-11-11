# Ticketing

The last stage: turning a confirmed booking into issued tickets and finalizing its financial records. Runs in `post-air-booker` and the Ticketer.

_Schemas: `../../db_access/db-docs/mysql/booking_tasks.md`, `booking_statement_items.md`, `booking_statement_transactions.md`. Tables `booking_wenrix_reservations` / `booking_wenrix_reservation_notifications` / `booking_work_orders` are undocumented in `db-docs/` as of 2026-08-13. Seeded 2026-07-30 from `debug_logs.md`; Wenrix queue vs agent-queue split confirmed 2026-08-13; Known traps merged 2026-11-04._

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
- **Abnormal (Wenrix):** agent says “not queued to Wenrix” because `sent_to_queue = 0` / `handle_type = manual`, but a `booking_wenrix_reservations` row already exists. Or Amadeus issued tickets (`booking_tickets` populated) while `bookings.status` stayed `not_issued` and the work order stayed `sleeping` — see [Known traps](#known-traps) (MySQL gone-away after issue).

## Known traps

### Amadeus / Wenrix: tickets issued, booking still `not_issued`

Surface: `bookings.status = 'not_issued'`, `process_status = 'open'`, ticketing task unresolved, work order `ticket/process` `sleeping`. An agent reports "not queued to Wenrix" because `booking_tasks.sent_to_queue = 0` and `handle_type = 'manual'`. But `booking_tickets` already has `issued` rows (`processed = 0`), `booking_wenrix_reservations.status = 201`, and the last notification is `ticketed`.

Cause: Amadeus `DocIssuance_IssueTicket` returned `OK ETICKET WELL ISSUED`. Then MySQL failed with `SQLSTATE[HY000]: General error: 2006 MySQL server has gone away`. The post-issue pipes (`ResolveBookingAsTicketedPipe`) never ran, and the escalation to a manual-ticket child failed on the same dead connection.

Disambiguate before saying "not queued" or "re-issue":

```sql
SELECT id, status, process_status FROM ota.bookings WHERE id = <booking_id>;
SELECT id, status, optimization_type, reference, created_at FROM ota.booking_wenrix_reservations WHERE booking_id = <booking_id>;
SELECT type, status, created_at FROM ota.booking_wenrix_reservation_notifications
 WHERE wenrix_reservation_id IN (SELECT id FROM ota.booking_wenrix_reservations WHERE booking_id = <booking_id>);
SELECT ticket_number, status, issued_date, processed FROM ota.booking_tickets WHERE booking_id = <booking_id>;
SELECT id, type, status FROM ota.booking_work_orders WHERE booking_id = <booking_id>;
```

Then `debug_logs` for the `transaction_id`, contexts `wenrix-api-call:reservations`, `amadeus-sh4-api[<office>] DocIssuance_IssueTicket_9_1` (use the booking's `gds_account_id`) and `Mv_Ota_Booking_Note_Record::save()`, sorted by `date_added`.

| Evidence | Meaning | Action |
|---|---|---|
| No reservation row and no `wenrix-api-call:reservations` HTTP 201 | Never sent to Wenrix | Real queue miss. |
| HTTP 201, notification still `optimizing_pnr`, no `booking_tickets` | Waiting on Wenrix | Do not escalate as "not queued". Wait or check the issuance deadline. |
| `DocIssuance` text `OK ETICKET WELL ISSUED` and note-save error `2006 MySQL server has gone away` | Tickets issued, bookkeeping crashed | **Do not re-issue. Do not re-queue.** Refresh the PNR from Amadeus, mark the booking issued, resolve the ticketing task. |

Recorded case (booking `305516461`, 2026-08-13): reservation HTTP 201, `ticketed` notification four days later, then [`DocIssuance` OK](https://reservations.voyagesalacarte.ca/debug-logs/log-group/fdc65df156f3326742680918841d15c4#6a7aff74f98406fc1408896c) and [note-save 2006 error](https://reservations.voyagesalacarte.ca/debug-logs/log-group/fdc65df156f3326742680918841d15c4#6a7aff74f98406fc1408896d) in consecutive log lines. Tickets existed; the booking stayed `not_issued`.

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** `Ticketer` scope, `AirTicketRQ` / `SessionCloseRQ` operations, statement-transaction contexts for one `transaction_id`. Wenrix: `wenrix-api-call:reservations`, `CheckPreTicketingOptimizationPipe::suspend` / `::exit`, `amadeus-sh4-api[…] DocIssuance_IssueTicket_9_1`.
- **MySQL `ota`:** `bookings.status`, `booking_tasks` (post-book task state), `booking_statement_items` / `booking_statement_transactions`. Wenrix: `booking_wenrix_reservations`, `booking_wenrix_reservation_notifications`, `booking_work_orders` (`type = 'ticket/process'`), `booking_tickets`.
- **Datadog:** ticketing-service traces / error tracking for GDS-side issuance failures.
- Full evidence map: [`observability.md`](observability.md).

## Note

Ticketing sits downstream of payment and booking — a ticketing symptom often has a root cause earlier in [`booking-flow.md`](booking-flow.md) or [`payments.md`](payments.md). Confirm the booking actually confirmed and was charged before treating this as a pure ticketing failure.
