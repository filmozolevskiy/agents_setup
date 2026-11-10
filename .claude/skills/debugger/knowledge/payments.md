# Payments (Payhub)

How money moves for a booking: the customer charge, the virtual card that pays the supplier, and the financial records. Payhub is the internal payment processor (not only the external card gateway).

_Schemas: `../../db_access/db-docs/mysql/booking_statement_items.md`, `booking_statement_transactions.md`, `booking_virtual_card_statement_items.md`. Seeded 2026-07-30 from `debug_logs.md`; FOP-reject cheque reasons 2026-08-31; Travelfusion customer-card fallback 2026-09-02; Known traps merged from the old bookability notes 2026-11-04; extend via the maintenance loop._

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
2. **`booker-payment-manager-failed-to-issue-vcc`** / **`fop-switch-vcc-issuance-failed`** — VCC was eligible but issuance threw. The PHP exception (class, message, stack) is in the `exception` field. This is where a crash before the Payhub `IssueCard` call shows up. Genesis PR 55340 renamed the ticket-pipeline context from `issue-tickets-pipe-vcc-issuance-failed` to `fop-switch-vcc-issuance-failed` (PNR update, fare auth, and issue-tickets share it).
3. **`IssueTicketsPipe::retry`** — on VCC failure the pipe logs `RetryException: "FOP switched to check successfully. Retrying issuance."` and re-issues on cheque. This is the fallback that leaves `fop=cheque` with no `booking_virtual_card_statement_items` link.
4. **`issue-documents::fop-handling` / `pre-issuance-pnr-update::fop-handling`** — the GDS-side FOP the ticket was actually written with (cheque here).

A silent cheque fallback = VCC was eligible (step 1 true) but issuance crashed (step 2), not that VCC was never considered. Check `booking_virtual_cards` for the booking: no row means the card was never minted. After Amadeus FOP-reject recovery (below), a missing `TicketProcessor` availability log is usually “fares already have a VCC”, not a crash.

## Amadeus FOP-reject recovery

Genesis PR 55340 (merged 2026-08-28) tries a virtual card before cheque at PNR update, fare auth, and issue-tickets. Ticket-issue recovery sets `fopRejectRecovery: true` on the `TicketProcessor` availability log. A ResPro note `FOP not accepted. Switching to check` after that deploy is **not** the old PNR-update skip. Cheque still happens when:

1. **Fares already have a virtual card.** Recovery does not mint a second card. No `TicketProcessor` `booker-payment-manager-vcc-availability` row. Note is only `FOP not accepted. Switching to check`. Airline text is often `CREDIT CARD NOT ACCEPTED BY TICKETING AIRLINE` or `CREDIT CARD DENIAL 5.51`. Confirmed 2026-08-31 on [307409891](https://reservations.voyagesalacarte.ca/booking/index/307409891) / [availability](https://reservations.voyagesalacarte.ca/debug-logs/log-group/21d5df99735fb9357b139d01b46ae8f6#6a951a7dbd8d639a3a0ee5bb) (`Booking` only).
2. **First-part availability still fails.** `TicketProcessor` log has `fopRejectRecovery: true` and both ConnexPay / B2B Wallet `success: false`. Common last rule: the fare does not support a credit card (`IsCreditCardSupportedRule` on `ruleStack`). A virtual card is still a credit card, so cheque is the designed fallback. Confirmed 2026-08-31 on [307406831](https://reservations.voyagesalacarte.ca/booking/index/307406831) / [availability](https://reservations.voyagesalacarte.ca/debug-logs/log-group/5c57b93b0e8895f0f7113c8f56eb7528#6a9509a9ae24db2acf070f0c).
3. **The issued virtual card is then refused.** First note `FOP not accepted. Switching to VCC`. Airline then refuses that card (often `CREDIT CARD DENIAL 5.51 - INSUFFICIENT FUNDS`). Second note `FOP not accepted. Switching to check` via the already-carded guard in (1). Confirmed 2026-08-31 on [307248111](https://reservations.voyagesalacarte.ca/booking/index/307248111) / [availability](https://reservations.voyagesalacarte.ca/debug-logs/log-group/cea32acdc9b82250cf0d917ac73aa429#6a91fc3d61e2acfc4e05fc55).

**Excluded-currency vs recovery:** checkout can fail `IsNotExcludedAirlineByCurrencyRule` (`CADUA`, also `CADCX` / `CADLA` / `CADMU` / `CADAT`) while `TicketProcessor` recovery with `fopRejectRecovery: true` succeeds and a virtual card is issued. Confirmed 2026-08-31 on [307414991](https://reservations.voyagesalacarte.ca/booking/index/307414991) — checkout [failed `CADUA`](https://reservations.voyagesalacarte.ca/debug-logs/log-group/6e910ea37b87040d9897d40b0df2953b#6a9570f984849069c1011052), recovery [both suppliers true](https://reservations.voyagesalacarte.ca/debug-logs/log-group/6e910ea37b87040d9897d40b0df2953b#6a957111868fb4b39e0e18ad). Sibling card [3198](https://trello.com/c/UDBb9ZKj) expected excluded gates to stay 0 VCC. Intent is not settled; do not treat this as a miss of 55340.

Known regression: a `TypeError` in `PaymentManager::prepareVcc` (`Mv_Ota_Site::getNameForId()` called with an array `site_id`) crashes issuance before any Payhub call, forcing cheque. First seen 2026-07-27; 8 bookings in the first 3 days. Signature: context `booker-payment-manager-failed-to-issue-vcc` with `exception` matching `getNameForId`.

**Clickable evidence:** build a permalink to the exact log entry as `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` so the reader opens the row in one click.

## Travelfusion when a virtual card is missing or fails

Travelfusion charges a card at book time. It does **not** fall back to cheque. The Amadeus FOP-reject recovery above does not apply.

Virtual card is optional here. Travelfusion is not in the “must use virtual card” set (Amadeus / some portals are). If eligibility fails, or issuance returns nothing, the booker sends the **customer credit card** to Travelfusion and continues. Agency fare `fop` is `credit_card`. Travelfusion may add a card surcharge; markup can absorb it (ResPro note `TravelFusion card surcharge … Paid by us, not charged to the customer.`).

Two other paths skip virtual-card issuance entirely:

1. **TfPay** (Travelfusion prepay) — required up front for a fixed carrier / office list (Frontier, Spirit, Norwegian, Condor, Pegasus, Turkish, Alaska, and others; some only on `TFUSD` / `TFCAD` / `TFVALCUSD`). Retry: if the first try fails with card declined or 3-D Secure required, the booker can reprice and retry on TfPay. That retry is **off** for `TFGLOBAL*` and `TFVALC*` offices.
2. **BSP cash** (pre-registered card at the supplier) — Copa, British Airways, and Turkish only.

Test bookings never send a virtual card to Travelfusion even if one was minted.

Confirmed 2026-09-02 on staging [307532551](https://reservations.voyagesalacarte.ca/booking/index/307532551) / [availability](https://staging83-reservations.voyagesalacarte.ca/debug-logs/log-group/d0e97f6a6bea3545b7c619659a99b156#6a972b2184ea559ee20e3694): NZ / `TFGLOBALUSD`, ConnexPay / Nium / Corporate all `success: false` (departure ~47 days, not a low-fee card), B2B Wallet `success: true` on the currency-mismatch arm (package USD, supplier NZD) but no `IssueCard` and cancel says [No virtual card found](https://staging83-reservations.voyagesalacarte.ca/debug-logs/log-group/d0e97f6a6bea3545b7c619659a99b156#6a97476219eb0f6cea0bd951). Booked on the customer Visa; surcharge absorbed ([cc-fee log](https://staging83-reservations.voyagesalacarte.ca/debug-logs/log-group/d0e97f6a6bea3545b7c619659a99b156#6a972b2e84ea559ee20e3699)). Log contexts: `travelfusion-google-cc-fee-absorbed`, `travelfusion-cc-fee-statement-item` — see `../../db_access/db-docs/mongodb/debug_logs.md`.

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
