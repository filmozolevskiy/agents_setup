# Payments (Payhub)

How money moves for a booking: the customer charge, the virtual card that pays the supplier, and the financial records. Payhub is the internal payment processor (not only the external card gateway).

_Schemas: `../../db_access/db-docs/mysql/booking_statement_items.md`, `booking_statement_transactions.md`, `booking_virtual_card_statement_items.md`. Seeded 2026-07-30 from `debug_logs.md`; extend via the maintenance loop._

## Payhub call sequence

Logged as `payhub_api_request_*` / `payhub_api_response_*` in `ota.debug_logs`, in this order:

1. **Verify** — card validation / authorization.
2. **ThreeDs** / **UpdateThreeDs** — 3D Secure authentication flow.
3. **IssueCard** — generates a virtual credit card (VCC) used to pay the supplier.
4. **Sale** — the actual charge to the customer's card.
5. **CancelCard** — voids the VCC if the booking fails (part of `CancelProcessor`).

## Normal vs abnormal

- **Normal:** Verify → (3DS if required) → Sale succeeds → IssueCard funds the supplier payment → booking proceeds to ticketing.
- **Abnormal signals:** `Sale` failure (card decline), 3DS challenge abandoned or failed, `IssueCard` failing to mint a VCC, `CancelCard` firing (booking rolled back), a customer charged with no booking, or a VCC issued with no supplier booking.

## Payment vs bookability attribution

Payment failures are **not** bookability failures — keep them out of the bookability rate.
- MySQL: `contestant_error = payment_error`.
- ClickHouse: `classification_category = 'PAYMENT_ERRORS'`.

When supplier-side evidence shows a payment cause under a generic code (or the reverse), flag "SQL vs Mongo mismatch"; supplier / payment evidence wins for the root-cause narrative. Watch for clusters that *look* like payment but are not (e.g. virtual-card clusters) — see `../../bookability/references/known_pitfalls.md`.

## Tracing a VCC decision / failure

When the supplier leg settled as cheque but should have used a VCC, follow these `ota.debug_logs` contexts (join on `transaction_id`):

1. **`booker-payment-manager-vcc-availability`** — the eligibility decision. Evaluated more than once per transaction. It can flip: a booking can be VCC-ineligible at checkout and eligible at ticketing (e.g. `IsFareUnderRule` turns true when margin drops). `_scopes` `Booking` is checkout / booker; `_scopes` `TicketProcessor` is ticket-issue recovery. Each supplier (ConnexPay, B2B Wallet, …) has its own `success` flag here. The `context` object inside those JSON result fields is where ticket-issue recovery will show `fopRejectRecovery` after genesis PR 55361.
2. **`booker-payment-manager-failed-to-issue-vcc`** — VCC was eligible but issuance threw. The PHP exception (class, message, stack) is in the `exception` field. This is where a crash before the Payhub `IssueCard` call shows up.
3. **`IssueTicketsPipe::retry`** — on VCC failure the pipe logs `RetryException: "FOP switched to check successfully. Retrying issuance."` and re-issues on cheque. This is the fallback that leaves `fop=cheque` with no `booking_virtual_card_statement_items` link.
4. **`issue-documents::fop-handling` / `pre-issuance-pnr-update::fop-handling`** — the GDS-side FOP the ticket was actually written with (cheque here).

A silent cheque fallback = VCC was eligible (step 1 true) but issuance crashed (step 2), not that VCC was never considered. Check `booking_virtual_cards` for the booking: no row means the card was never minted.

Known regression: a `TypeError` in `PaymentManager::prepareVcc` (`Mv_Ota_Site::getNameForId()` called with an array `site_id`) crashes issuance before any Payhub call, forcing cheque. First seen 2026-07-27; 8 bookings in the first 3 days. Signature: context `booker-payment-manager-failed-to-issue-vcc` with `exception` matching `getNameForId`.

**Clickable evidence:** build a permalink to the exact log entry as `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` so the reader opens the row in one click.

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** `payhub_api_request_*` / `payhub_api_response_*` contexts for Verify / 3DS / IssueCard / Sale / CancelCard.
- **MySQL `ota`:** `booking_statement_items`, `booking_statement_transactions`, `booking_virtual_card_statement_items` for the financial records; `bookings` for status.
- **Datadog:** payment-service traces / app-logs and error tracking for gateway-side failures with no clean DB row.
- Full evidence map: [`observability.md`](observability.md).

## Open gaps (fill via investigations)

- Payhub log service names / dashboards and index names are not yet documented here — `debug_logs.md` flags the same gap. Confirm during a payment investigation and propose an update.
