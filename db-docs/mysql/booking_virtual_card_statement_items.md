# booking_virtual_card_statement_items

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~6.9M (InnoDB estimate)  |  **Size:** ~219 MB data + ~303 MB indexes
**Purpose:** Link table that marks a `booking_statement_items` row as being settled with a virtual credit card (VCC). Agency-side supplier payouts with `fop='cheque'` that actually went out on a VCC are identified by the presence of a row here.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int unsigned` | Primary key. `auto_increment`. |
| `virtual_card_id` | `int` | FK to the virtual card record (card issued for this payout). Indexed. |
| `statement_item_id` | `int` | FK → `booking_statement_items.id`. Indexed. The statement item that this VCC funded. |

**Key relationships:**
- `booking_virtual_card_statement_items.statement_item_id = booking_statement_items.id` — the statement item being funded. In practice the linked item is the agency-side fare-sale row (`type='fare'`, `transaction_type='sale'`, `payment_processor='agency'`) with `fop='cheque'`.
- `booking_virtual_card_statement_items.virtual_card_id` → virtual cards table — details of the issued VCC (card number token, expiry, amount, status).

**Common queries:**

```sql
-- Is a given statement item VCC-funded?
SELECT bsi.id, bsi.booking_id, bsi.fop, bvcsi.virtual_card_id
FROM booking_statement_items bsi
LEFT JOIN booking_virtual_card_statement_items bvcsi
  ON bvcsi.statement_item_id = bsi.id
WHERE bsi.booking_id = 298185632;
```

```sql
-- FOP classification per booking (cc / real cheque CK / virtual card VCC).
-- Presence of a bvcsi row flips a cheque-FOP agency item from CK to VCC.
SELECT
    b.id,
    CASE
        WHEN bsi.fop = 'credit_card'                     THEN 'cc'
        WHEN bsi.fop = 'cheque' AND bvcsi.id IS NULL     THEN 'CK'
        WHEN bsi.fop = 'cheque' AND bvcsi.id IS NOT NULL THEN 'VCC'
    END AS fop
FROM bookings b
JOIN booking_statement_items bsi
      ON bsi.booking_id = b.id
     AND bsi.type = 'fare'
     AND bsi.transaction_type = 'sale'
     AND bsi.payment_processor = 'agency'
LEFT JOIN booking_virtual_card_statement_items bvcsi
      ON bvcsi.statement_item_id = bsi.id
WHERE b.booking_date > NOW() - INTERVAL 1 DAY
GROUP BY b.id;
```

**Query guidance:**
- **Size class:** medium (~7M rows, ~220 MB). No date column — filter through `booking_statement_items` (on `create_date`) or `bookings` (on `booking_date`) when scoping a window.
- **Recommended constraints:** always join from `booking_statement_items` via `statement_item_id`; use `LEFT JOIN` when the goal is existence-checking VCC usage.

**Notes:**
- Acts as a boolean flag: "this statement item was paid with a virtual card." For supplier-payment attribution, a cheque-FOP agency fare-sale row with **no** matching `bvcsi` row is a real cheque/ACH; **with** a matching row it is a virtual credit card.
- Sampled rows confirm the linked `booking_statement_items` are almost always `fop='cheque'`, `payment_processor='agency'`, `transaction_type='sale'`, `type` in (`fare`, `ancillary_chargeable_seat`, …). Rely on existence, not on fields of this table, for the classification.
- One `virtual_card_id` can back multiple statement items on the same booking (e.g. multiple fare rows for multi-passenger or multi-ticket).
