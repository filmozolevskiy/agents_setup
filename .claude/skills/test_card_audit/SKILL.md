---
name: test-card-audit
description: >-
  Use when the user asks about money still held, charged, or paid out on
  bookings made with our test credit cards — "pending items on the test
  card", "any pending items on our test cards", "underfunded items on the
  test card", "unvoided items", "did we forget to void anything", "transactions
  not closed on the test card", "what is still charged on the QA card", "did
  we refund all test bookings", "supplier payments not voided on test
  bookings", "check the cc in .env for open charges". Also use after a batch of
  real test bookings (qa_assistant) to confirm every customer charge was
  refunded and every supplier payment was voided. Read-only: matches the test
  cards from `.env` against `ota.booking_billing_info` and walks every
  processor's operations in `ota.booking_statement_transactions`. Does not
  refund, void, cancel, or edit anything.
---

# Test Card Audit

List the open items on bookings made with our test cards. Two categories, one run:

- **Underfunded items** — we charged the test card through Payhub and did not give it all back.
- **Unvoided items** — we paid a supplier (the ticket, a seat, insurance) for a test booking and never voided or refunded that payment.

Read-only.

## When to use

- The user asks for "pending items", "underfunded items", "unvoided items", "open charges", or "transactions not closed" on the test card(s).
- The user asks "did we forget to void anything" for test bookings.
- After a QA session with real bookings, to confirm the cleanup closed every charge on both sides.

## When NOT to use

- One booking's full payment story (why a charge failed, decline reason) → `debugger`.
- Driving or cancelling a test booking → `qa_assistant` (`qa-cleanup`).
- Customer cards. This skill reads only the test cards listed in `.env`.

## Definitions

Each operation in `ota.booking_statement_transactions` on a test-card booking is checked against its own children (rows whose `parent_transaction_id` points at it):

| `kind` | Meaning | Rule |
|---|---|---|
| `open_capture` | Money moved and not fully returned | `auth_capture` or `capture` with `status='success'`, minus its successful `refund` / `void` / `auth_reversal` children, is above 0 |
| `open_auth` | Hold that was never captured or released | `auth` with `status='success'` and amount above 0, minus its `capture` and reversal children, is above 0 |
| `pending_operation` | The processor never confirmed the result | any operation with `status='pending'` |

The `category` comes from the processor:

| `category` | `processor` | Side |
|---|---|---|
| `underfunded` | `payhub` | Customer side: our charge on the test card |
| `unvoided` | `agency` | Supplier side: what we paid the airline / content source for the ticket. On the statement this is the `fare` item with `payment_processor='agency'` (usually `fop='cheque'`, which can be a virtual card) |
| `unvoided` | `gordian`, `chase`, `xcover-*`, `protect-group`, … | Ancillary side: seats, insurance, other add-ons |

Each reversal is matched to its own parent. A `void` against an `auth` closes that auth; it does not reduce a capture. This avoids false positives when a booking has only auths that were voided.

## Inputs

- Test cards come from `.env`: `CC_NUMBER` (one card) and optional `TEST_CC_NUMBERS` (comma-separated). The user pointed the skill at these variables; do not read other credentials.
- Never print, paste, or log a full card number. The script prints only the masked form (first 6 + last 4). In chat, refer to "the test card" or its last 4 digits.

## Workflow

1. Load env and run the script:

   ```bash
   set -a && source .env && set +a
   python3 .claude/skills/test_card_audit/scripts/test_card_audit.py
   ```

   Options: `--only underfunded` or `--only unvoided`, `--since YYYY-MM-DD` (billing row date), `--booking-id N` (one booking), `--json` (for further processing).

   If the user asks only for "pending items" or "underfunded items", still run both categories and report both. Unvoided supplier payments cost more and are easy to miss.

2. Read the summary lines: bookings on the cards, bookings with items, and the open total per category and currency.
3. Report in chat, answer first:
   - One line per category: number of items, number of bookings, open total per currency.
   - One table per category, one row per item. Columns: booking (as a ResPro link `https://reservations.voyagesalacarte.ca/booking/index/<id>`), booking status, processor (unvoided only), date, open amount + currency, the script's `note`. Do not show the transaction id or the original paid amount. Transaction ids belong only in the row-level evidence query or the `WARNING:` lines.
   - Call out bookings with status `issued`. For underfunded items the charge may be expected. For unvoided items an issued test ticket is still live with the supplier — the most urgent case if the void window is still open.
   - Call out `is_test = 0` on test-card bookings if present (the flag is not set on these bookings).
   - Any `WARNING:` lines from the script (reversal with no parent): check those bookings by hand with the row-level query below.
4. Close with the evidence queries (below), the window ("full history" or the `--since` date), and "times are DB server time".
5. If the user wants to know whether a partial leftover is a non-refundable fee (underfunded) or a supplier penalty (unvoided), compare against `ota.booking_statement_items` for that booking (see [`booking_statement_items`](../db_access/db-docs/mysql/booking_statement_items.md)). Until checked, label it `Assumption:`.

## Evidence queries

Paste these in the reply with placeholders. Do not paste real card digits.

Bookings on a test card:

```sql
SELECT DISTINCT booking_id
FROM booking_billing_info
WHERE cc_first_6 = '<FIRST6>' AND cc_last_4 = '<LAST4>';
```

Row-level operations for the flagged bookings (all processors):

```sql
SELECT booking_id, id, processor, type, status, amount, currency,
       parent_transaction_id, transaction_date
FROM booking_statement_transactions
WHERE booking_id IN (<booking_ids>)
ORDER BY booking_id DESC, transaction_date, id;
```

Supplier statement items for one booking (confirms an unvoided `agency` row is the ticket fare):

```sql
SELECT id, type, transaction_type, payment_processor, fop, status,
       customer_amount, paid_transaction_id
FROM booking_statement_items
WHERE booking_id = <booking_id>
  AND payment_processor = 'agency';
```

## What not to do

- Do not refund, void, or cancel anything. Hand off to the user or `qa_assistant` for cleanup.
- Do not sum `captured − refunded` per booking. A void on an `auth` then shows as a fake negative or a fake open hold. Use the per-parent rule above (the script does this).
- Do not mix processors when matching reversals. A Payhub void never closes an `agency` capture; the script groups by booking and processor.
- Do not trust `bookings.is_test` to find test bookings. Match on the card.

## References

- Tables: [`booking_statement_transactions`](../db_access/db-docs/mysql/booking_statement_transactions.md), [`booking_statement_items`](../db_access/db-docs/mysql/booking_statement_items.md), [`bookings`](../db_access/db-docs/mysql/bookings.md).
- `ota.booking_billing_info` is not yet documented under `db_access/db-docs/`. Columns used: `booking_id`, `cc_first_6`, `cc_last_4`, `date_added` (index on `cc_first_6, cc_last_4`).
- Script: [`scripts/test_card_audit.py`](scripts/test_card_audit.py).
