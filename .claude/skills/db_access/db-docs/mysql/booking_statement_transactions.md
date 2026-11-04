# booking_statement_transactions

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~94.0M (InnoDB estimate)  |  **Size:** ~5.4 GB data + ~4.9 GB indexes
**Purpose:** One row per **processor operation** on a booking — `auth`, `auth_capture`, `capture`, `auth_reversal`, `refund`, `void`, `card_verification`, `payout`, `issue_card`, `cancel_card`. Holds the **decimal amount + currency** that was actually authorized / captured / refunded by the processor (Payhub, agency-side payout, Gordian, xcover, etc.). This is the "processor ledger" that sits between the per-line ledger (`[booking_statement_items](booking_statement_items.md)`) and the processor-specific extension tables (`booking_statement_transaction_payhub`, `payhub_transaction_log`, …).


| Column                     | Type                                 | Description                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `int`                                | Primary key. `auto_increment`. Referenced from `booking_statement_items.paid_transaction_id` and `booking_statement_item_transactions.statement_transaction_id`.                                                                                        |
| `booking_id`               | `int`                                | FK → `bookings.id`. Indexed.                                                                                                                                                                                                                            |
| `currency`                 | `varchar(3)`                         | Currency of `amount`. ISO 4217 (e.g. `CAD`, `USD`).                                                                                                                                                                                                     |
| `amount`                   | `decimal(10,2)`                      | **Decimal money** (not minor units) — the amount handled by this processor operation.                                                                                                                                                                   |
| `type`                     | `enum(...)`                          | Processor-operation type. Common values: `auth_capture`, `auth`, `capture`, `auth_reversal`, `refund`, `void`, `card_verification`, `payout`, `issue_card`, `cancel_card`. **Not** a line-item category — for that, use `booking_statement_items.type`. |
| `status`                   | `enum('pending','success','failed')` | Lifecycle state. Use `status='success'` to filter to operations that actually completed.                                                                                                                                                                |
| `transaction_date`         | `datetime`                           | When the processor operation happened. Indexed — primary time filter.                                                                                                                                                                                   |
| `processor_transaction_id` | `int`                                | FK to the processor-specific row in an extension table — for Payhub, this is `booking_statement_transaction_payhub.id`.                                                                                                                                 |
| `processor`                | `varchar(30)`                        | Who handled this op: `payhub` (customer charge), `agency` (supplier payout), `gordian`, `xcover-`*, `protect-group`, `csadirect`, etc.                                                                                                                  |
| `parent_transaction_id`    | `int`                                | Self-FK chaining a refund / reversal back to the original capture. NULL on the original. Indexed.                                                                                                                                                       |


**Key relationships:**

- `booking_statement_transactions.booking_id = bookings.id` — parent booking.
- `booking_statement_items.paid_transaction_id = booking_statement_transactions.id` — every ledger line that has been paid points back to the gateway op that paid it.
- `booking_statement_item_transactions (statement_transaction_id, statement_item_id)` — full junction when a single capture funds multiple ledger lines (e.g. fare + service_fees on the same swipe).
- `booking_statement_transaction_payhub.statement_transaction_id = booking_statement_transactions.id` — Payhub-specific extension, with `amount` in **integer minor units** (so `36697` = `366.97`), gateway response details, decline JSON.
- `booking_statement_transactions.parent_transaction_id = booking_statement_transactions.id` — self-join for refund / reversal chains.

**Common queries:**

```sql
-- Successful Payhub captures for a booking (the customer-side charge).
-- Sum across rows because ancillaries added at checkout can produce
-- multiple captures.
SELECT id, amount, currency, type, status, processor_transaction_id,
       transaction_date
FROM booking_statement_transactions
WHERE booking_id = %(booking_id)s
  AND processor = 'payhub'
  AND type      = 'auth_capture'
  AND status    = 'success'
ORDER BY transaction_date;
```

```sql
-- Cross-check gateway sum against the per-line ledger sum. Should match.
SELECT
  (SELECT SUM(amount)
     FROM booking_statement_transactions bst
    WHERE bst.booking_id = b.id
      AND bst.processor = 'payhub'
      AND bst.type      = 'auth_capture'
      AND bst.status    = 'success')                AS gateway_total,
  (SELECT SUM(customer_amount)
     FROM booking_statement_items bsi
    WHERE bsi.booking_id        = b.id
      AND bsi.payment_processor = 'payhub'
      AND bsi.transaction_type  = 'sale'
      AND bsi.status            = 'paid')           AS ledger_total
FROM bookings b
WHERE b.id = %(booking_id)s;
```

```sql
-- Refund chain: from a capture row, walk forward to refunds / reversals.
SELECT id, amount, type, status, transaction_date, parent_transaction_id
FROM booking_statement_transactions
WHERE booking_id = %(booking_id)s
  AND processor  = 'payhub'
ORDER BY transaction_date, id;
```

**Sample rows (`booking_id = 297938522`, a real cancelled-then-refunded test booking):**


| id           | currency | amount | type           | status  | transaction_date    | processor_transaction_id | processor | parent_transaction_id |
| ------------ | -------- | ------ | -------------- | ------- | ------------------- | ------------------------ | --------- | --------------------- |
| `1097144152` | CAD      | 366.97 | `auth_capture` | success | 2026-04-20 09:07:43 | 208643892                | payhub    | NULL                  |
| `1097168602` | CAD      | 366.97 | `refund`       | success | 2026-04-20 11:10:06 | 208660332                | payhub    | `1097144152`          |


The capture's `processor_transaction_id` (`208643892`) joins to `booking_statement_transaction_payhub`, where the same amount is stored as `36697` (minor units) alongside the Payhub-specific gateway / order id / decline JSON.

**Query guidance:**

- **Size class:** very large (~94M rows, ~10 GB total). Always filter by `booking_id` and/or `transaction_date`.
- **Recommended constraints:** `booking_id` (best — uses the indexed FK) or a `transaction_date` window plus `processor` / `type` / `status`. Never run an unfiltered `SELECT *`.
- **Typical date range:** full history; practical analysis windows are 1–30 days.

**Notes:**

- **Two `type` columns to keep straight.** This table's `type` is the **processor-operation** type (`auth_capture`, `refund`, …). The line-item ledger `booking_statement_items.type` is a different concept (`fare`, `service_fees`, `ancillary_chargeable_seat`, …). They live on different tables and never share values.
- **Successful customer charge** = `processor='payhub' AND type='auth_capture' AND status='success'`. Some integrations split into `auth` + later `capture` instead; if you also want those, accept `type IN ('auth_capture','capture')` and double-check that an `auth` row was followed by a matching `capture`.
- `**refund` and `void` rows are subsequent to a capture.** They are not part of the "what we charged" sum. They have `parent_transaction_id` pointing at the original capture.
- **Non-`payhub` processors** are ancillaries (Gordian seatmaps, xcover insurance, blue_ribbon_bags, …) or the agency-side supplier payout (`processor='agency'`). For "did we charge the customer?" you only care about `payhub`.
- **Empty-`type` rows** show up in the wild (a few percent of recent rows). Treat them as auxiliary / pre-classification — do not rely on them for amount sums; the canonical capture rows are typed.
- `**processor_transaction_id`** semantics depend on `processor`: for Payhub it joins `booking_statement_transaction_payhub.id`; other processors have their own extension tables (or none).

