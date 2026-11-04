# Payments (Payhub)

How money moves for a booking: the customer charge, the virtual card that pays the supplier, and the financial records. Payhub is the internal payment processor (not only the external card gateway).

_Schemas: `../../db_access/db-docs/mysql/booking_statement_items.md`, `booking_statement_transactions.md`, `booking_virtual_card_statement_items.md`. Seeded 2026-07-30 from `debug_logs.md`; Known traps merged from the old bookability notes 2026-11-04; extend via the maintenance loop._

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

When supplier-side evidence shows a payment cause under a generic code (or the reverse), flag "SQL vs Mongo mismatch"; supplier / payment evidence wins for the root-cause narrative. Watch for clusters that *look* like payment but are not (e.g. virtual-card clusters) — see [Known traps](#known-traps). Lens table: [`booking-flow.md`](booking-flow.md#error-classification-lenses-mysql--clickhouse).

## Tracing a VCC decision / failure

When the supplier leg settled as cheque but should have used a VCC, follow these `ota.debug_logs` contexts (join on `transaction_id`):

1. **`booker-payment-manager-vcc-availability`** — the eligibility decision. Evaluated more than once per transaction. It can flip: a booking can be VCC-ineligible at checkout and eligible at ticketing (e.g. `IsFareUnderRule` turns true when margin drops). `_scopes` `Booking` is checkout / booker; `_scopes` `TicketProcessor` is ticket-issue recovery. Each supplier (ConnexPay, B2B Wallet, …) has its own `success` flag here. The `context` object inside those JSON result fields is where ticket-issue recovery will show `fopRejectRecovery` after genesis PR 55361.
2. **`booker-payment-manager-failed-to-issue-vcc`** — VCC was eligible but issuance threw. The PHP exception (class, message, stack) is in the `exception` field. This is where a crash before the Payhub `IssueCard` call shows up.
3. **`IssueTicketsPipe::retry`** — on VCC failure the pipe logs `RetryException: "FOP switched to check successfully. Retrying issuance."` and re-issues on cheque. This is the fallback that leaves `fop=cheque` with no `booking_virtual_card_statement_items` link.
4. **`issue-documents::fop-handling` / `pre-issuance-pnr-update::fop-handling`** — the GDS-side FOP the ticket was actually written with (cheque here).

A silent cheque fallback = VCC was eligible (step 1 true) but issuance crashed (step 2), not that VCC was never considered. Check `booking_virtual_cards` for the booking: no row means the card was never minted.

Known regression: a `TypeError` in `PaymentManager::prepareVcc` (`Mv_Ota_Site::getNameForId()` called with an array `site_id`) crashes issuance before any Payhub call, forcing cheque. First seen 2026-07-27; 8 bookings in the first 3 days. Signature: context `booker-payment-manager-failed-to-issue-vcc` with `exception` matching `getNameForId`.

**Clickable evidence:** build a permalink to the exact log entry as `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` so the reader opens the row in one click.

## Known traps

### Downtowntravel: "Virtual card merchant fare statement items failed"

Signature (ClickHouse): `gds = 'downtowntravel'`, `error_message = 'Virtual card merchant fare statement items failed'`, `booking_step` `Mv_Ota_Air_Booker->processVirtualCardMerchantFareStatementItems()`, `classification_category = 'PAYMENT_ERRORS'`. MySQL: `bconta.error = 'payment_error'`, `bookings.status = 'cancelled'`, `cancel_reason = 'aborted'`, `multiticket_part IS NULL`.

Trap: the same cleanup chain runs after **two different events**.
- **(A) The Sale failed** (decline, suspected fraud). Cleanup tears down the virtual card. Real payment failure. The ClickHouse class is right.
- **(B) The Sale succeeded**, then a fare increase or supplier rejection reverses the charge. Real bookability failure. The ClickHouse class is wrong.

`cancel_reason = 'aborted'` does not tell A from B. The app sets it for any post-Sale cleanup. Do not use it as proof.

Disambiguate before any reclassification. Count successful Sales per transaction:

```json
[{"$match": {"transaction_id": {"$in": ["<HASH1>", "<HASH2>"]},
             "context": "payhub_api_response_Momentum\\Payhub\\Request\\Sale"}},
 {"$project": {"transaction_id": 1,
               "is_success": {"$regexMatch": {"input": "$response", "regex": "\"success\":\\s*true"}}}},
 {"$group": {"_id": "$transaction_id", "sales_total": {"$sum": 1},
             "sales_succeeded": {"$sum": {"$cond": ["$is_success", 1, 0]}}}}]
```

Run it with `.claude/skills/db_access/scripts/mongo_query.py aggregate debug_logs "<pipeline>" ota --json`. For each transaction with `sales_succeeded >= 1`, list contexts `loss-limit-fare-increase` and the `Sale` response sorted by `date_added`, and check the order.

| Evidence | Class | Action |
|---|---|---|
| `sales_succeeded = 0` for the cluster | Payment is right | Keep as payment. Exclude from the bookability rate. |
| Some Sales succeeded, but every `loss-limit-fare-increase` comes **before** the successful Sale | Payment is right | Keep as payment. The customer booked later under another `booking_id`. That belongs in the recovery rate. |
| Sale succeeded and `loss-limit-fare-increase` comes **after** it, right before `DeferredRefundPaidStatementItemsAction::run` | Payment is wrong | Reclassify as bookability. Anchor on the post-Sale `loss-limit-fare-increase` log `_id`. State the effect on the rate. |

The same check applies to any payment-shaped wrapper, such as `Credit Card payment declined`.

Recorded miss (2026-05-05): a ClickHouse-only reading projected the rate dropping from 90.1% to 86.0%. Mongo showed 11 of 45 Sales succeeded across 14 sessions, and every fare-increase event came before the Sale. Variant A for all sessions. The claim was retracted.

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** `payhub_api_request_*` / `payhub_api_response_*` contexts for Verify / 3DS / IssueCard / Sale / CancelCard.
- **MySQL `ota`:** `booking_statement_items`, `booking_statement_transactions`, `booking_virtual_card_statement_items` for the financial records; `bookings` for status.
- **Datadog:** payment-service traces / app-logs and error tracking for gateway-side failures with no clean DB row.
- Full evidence map: [`observability.md`](observability.md).

## Open gaps (fill via investigations)

- Payhub log service names / dashboards and index names are not yet documented here — `debug_logs.md` flags the same gap. Confirm during a payment investigation and propose an update.
