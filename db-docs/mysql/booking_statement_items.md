# booking_statement_items

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~95.6M (InnoDB estimate)  |  **Size:** ~20 GB data + ~18 GB indexes
**Purpose:** Ledger of every money movement attached to a booking. One row per statement item — fare, service fee, ancillary, seatmap fee, etc. — from the perspective of either the customer (`payment_processor='payhub'` or the merchant) or the agency's supplier payout (`payment_processor='agency'`). Used for accounting, payout processing, invoicing, and supplier-payment attribution.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key. `auto_increment`. |
| `booking_id` | `int` | FK → `bookings.id`. Indexed. |
| `type` | `varchar(30)` | What this item is for: `fare`, `service_fees`, `ancillary_chargeable_seat`, `seatmap_fee`, etc. Indexed. |
| `passenger_type` | `varchar(10)` | `ADT`, `CHD`, `INL` when applicable. |
| `optional_service_type` | `varchar(100)` | Specific ancillary subtype. |
| `transaction_type` | `enum('sale','refund','exchange','payout')` | Direction of the money movement. |
| `passenger_id` | `int` | FK to passenger (when the item is per-passenger). Indexed. |
| `room_id` | `int` | FK to hotel room (hotel bookings). |
| `currency` | `varchar(5)` | Currency of the amounts. |
| `status` | `enum('pending','paid','deleted','failed','refunded','voided')` | Lifecycle of the statement item. |
| `net_fare` | `decimal(10,2)` | Net fare component. |
| `base_fare` | `decimal(10,2)` | Base fare before taxes. |
| `tax` | `decimal(10,2)` | Tax component. |
| `comission` | `decimal(10,2)` | (sic) Commission — note the typo in the column name. |
| `merchant_fee` | `float(10,2)` | Merchant / acquirer fee. |
| `supplier_fee` | `float(10,2)` | Fee charged by the supplier. |
| `agency_payout_markup_amount` | `decimal(10,2)` | Agency markup on the payout. |
| `agency_payout_commission_amount` | `decimal(10,2)` | Agency commission on the payout. |
| `penalty` | `float(10,2)` | Penalty (e.g. on exchange/refund). |
| `surcharges` | `decimal(10,2)` | Extra surcharges. |
| `customer_amount` | `decimal(10,2)` | Amount billed to the customer (in their currency). |
| `internal_amount` | `decimal(10,2)` | Amount in the internal accounting currency. |
| `fop` | `enum('cheque','credit_card','crypto','token','points')` | Form of payment for **this statement item**. For `payment_processor='agency'` + `type='fare'` rows, this is how the agency paid the supplier (see Notes). |
| `billing_info_id` | `int` | FK to billing info used on this item. |
| `gds_account_id` | `varchar(25)` | Office/PCC. Indexed. |
| `payment_processor` | `varchar(30)` | Who handled this leg: `payhub`, `agency`, `connexpay-merchant`, etc. Identifies **whose side** of the transaction this row represents (customer charge vs supplier payout). |
| `created_by` | `int` | User/system that created the row. Indexed. |
| `create_date` | `datetime` | Creation timestamp. Indexed — primary time filter. |
| `modified_by` / `modify_date` | — | Last modification audit. |
| `deleted_by` / `deleted_date` | — | Soft-delete audit. Indexed on `deleted_date`. |
| `paid_by` / `paid_date` / `paid_transaction_id` | — | Who/when/what paid this item. Indexed on `paid_date`. |
| `parent_item_id` | `int` | Points to the parent statement item (exchange/refund chains). Indexed. |
| `is_invoiced` | `tinyint(1)` | Whether included on an invoice. |
| `booking_ticket_number` | `varchar(50)` | Ticket number tied to this item. Indexed. |
| `agency_payout_status` | `enum('pending','processed')` | Status of the agency-side payout. |
| `offset_id` | `int unsigned` | Reconciliation offset id. Indexed. |
| `exchange_rate` | `decimal(20,10)` | FX rate used between `customer_amount` and `internal_amount`. |

**Key relationships:**
- `booking_statement_items.booking_id = bookings.id` — parent booking.
- `booking_virtual_card_statement_items.statement_item_id = booking_statement_items.id` — present only when the agency paid the supplier with a virtual credit card. Existence of a row flips a `cheque`-FOP agency item from "real cheque" (`CK`) to "virtual card" (`VCC`).
- `booking_statement_items.parent_item_id = booking_statement_items.id` — self-join for exchanges/refunds.
- `booking_statement_items.passenger_id` → passenger table (per-pax items).

**Common queries:**

```sql
-- Every money movement on a booking
SELECT id, type, transaction_type, payment_processor, fop, status,
       currency, customer_amount, base_fare, tax, create_date
FROM booking_statement_items
WHERE booking_id = 298185632
ORDER BY create_date, id;
```

```sql
-- Supplier-payout FOP (agency side) — one row per booking
SELECT booking_id, MIN(fop) AS supplier_fop
FROM booking_statement_items
WHERE type = 'fare'
  AND transaction_type = 'sale'
  AND payment_processor = 'agency'
  AND create_date > NOW() - INTERVAL 1 DAY
GROUP BY booking_id;
```

```sql
-- Customer-side charge amount
SELECT booking_id, SUM(customer_amount) AS customer_charge
FROM booking_statement_items
WHERE transaction_type = 'sale'
  AND payment_processor = 'payhub'
  AND status = 'paid'
  AND create_date > NOW() - INTERVAL 1 DAY
GROUP BY booking_id;
```

**Query guidance:**
- **Size class:** very large (~96M rows, ~20 GB). Always filter by `create_date` and/or `booking_id`.
- **Recommended constraints:** `create_date` range, plus `type`, `transaction_type`, `payment_processor` depending on which leg of the transaction you want.
- **Typical date range:** full history; practical windows are the last 1–30 days.

**Notes:**
- A single `bookings.id` maps to many rows here. Always narrow by (`type`, `transaction_type`, `payment_processor`) when joining one-to-one to `bookings`.
  - Supplier-payout leg (agency paid supplier): `type='fare'`, `transaction_type='sale'`, `payment_processor='agency'`.
  - Customer-charge leg (payhub charged customer): `type='fare'`, `transaction_type='sale'`, `payment_processor='payhub'`.
- Even with that filter there can be multiple rows per booking (e.g. per passenger or per multi-ticket half). `GROUP BY booking_id` in downstream queries deduplicates.
- `fop` on an agency-side fare-sale row is the supplier-payment method. Combined with `booking_virtual_card_statement_items`:
  - `fop='credit_card'` → real credit card (`cc`).
  - `fop='cheque'` + no virtual card row → real cheque / check (`CK`).
  - `fop='cheque'` + virtual card row → virtual credit card issued under a cheque wrapper (`VCC`).
- Column `comission` is misspelled in the schema — keep the typo when querying.
