# bookings

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~28.2M (InnoDB estimate)  |  **Size:** ~14.8 GB data + ~17.6 GB indexes
**Purpose:** Central record for every finalized (or attempted) booking — one row per booking, holding PNR, GDS, validating carrier, contact info, currency, status, multi-ticket linkage, and flags used across downstream reporting.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key. `auto_increment`. |
| `pnr` | `varchar(100)` | Supplier PNR. Indexed. |
| `status` | `enum('not_issued','issued','cancelled','voided')` | Lifecycle status of the booking. |
| `process_status` | `enum('open','resolved')` | Internal ops status. |
| `site_id` | `int` | Which front-end site/brand the booking came from. |
| `gds` | `enum(...)` | GDS / content source. Long enum (Amadeus, Sabre, Travelport, Farelogix, Unififi, …). |
| `gds_account_id` | `varchar(25)` | Office / PCC used. Indexed. |
| `cancel_reason` | `enum(...)` | Why it was cancelled (`cc_decline`, `fraud`, `fare_invalid`, …). |
| `booking_date` | `datetime` | When the booking was created. Indexed — primary time filter. |
| `ticketing_deadline` | `datetime` | TTL before ticketing is required. |
| `departure_date` | `datetime` | First-segment departure. Indexed. |
| `departure_airport_code` / `destination_airport_code` | `varchar(3)` | OD. |
| `ticketed_date` | `datetime` | When the ticket was actually issued. Indexed. |
| `currency` | `varchar(3)` | Booking currency. |
| `validating_carrier` | `varchar(4)` | VC airline code. Indexed. |
| `id_hash` | `varchar(32)` | External-safe hash of `id`. |
| `contact_email` / `contact_phone` / `contact_first_name` / `contact_last_name` | `varchar` | Customer contact. All indexed. |
| `is_test` | `tinyint(1)` | `1` = test booking. Always filter out for business metrics. |
| `is_fraud` | `tinyint(1)` | Flagged fraudulent. |
| `has_air` / `has_hotel` | `tinyint(1)` | Product flags. |
| `default_merchant` | `enum('chase','moneris','amex','payvision','globalone','paypal','connexpay-merchant','payhub')` | Merchant acquirer for the customer-side charge. |
| `checkout_status` | `enum('booked','pending')` | Checkout flow end-state. |
| `debug_transaction_id` | `varchar(32)` | Correlates to `ota.debug_logs` (MongoDB) via `transaction_id`. Indexed. |
| `universal_pnr` | `varchar(100)` | Universal/aggregator PNR. Indexed. |
| `provider_code` | `enum('ach','1v','','1p')` | Aggregator code (Travelport legacy). |
| `is_multiticket` | `tinyint(1)` | `1` = multi-ticket booking. |
| `multiticket_related_booking_id` | `int` | Pointer to the other leg in a multi-ticket pair. Indexed. |
| `multiticket_relationship_type` | `enum('master','slave')` | Role in the multi-ticket pair. |
| `multiticket_currency` / `multiticket_exchange_rate` | — | FX handling for cross-currency multi-ticket. |
| `fare_type` | `enum('private','published')` | Private vs public fare. |
| `fare_corporate_code` | `varchar(50)` | Corp code if private. |
| `agent_id` | `int` | Agent who booked (if agent-assisted). Indexed. |
| `is_webfare` | `tinyint(1)` | Web fare flag. |
| `is_airline_controlled` | `tinyint(1)` | Airline-controlled inventory. |
| `checkout_fare_total` | `decimal(10,2)` | Fare total at checkout (display). |
| `display_currency` | `varchar(3)` | Currency shown to the customer. |

(89 columns total — see `describe bookings ota` for the full list.)

**Key relationships:**
- `booking_statement_items.booking_id = bookings.id` — every money movement (fare, service fees, ancillaries) for the booking. Multiple rows per booking.
- `bookability_contestant_attempts.booking_id = bookings.id` — used as a semi-join to keep only bookings that went through the bookability pipeline (and to pull per-attempt GDS / carrier / office if needed).
- `bookings.debug_transaction_id = debug_logs.transaction_id` (MongoDB) — raw supplier payloads.
- `bookings.multiticket_related_booking_id = bookings.id` — self-join for multi-ticket pairs.

**Common queries:**

```sql
-- Recent real bookings with GDS and carrier
SELECT id, booking_date, gds, validating_carrier, status
FROM bookings
WHERE is_test = 0
  AND booking_date > NOW() - INTERVAL 1 DAY;
```

```sql
-- Classify how the supplier was paid (cc / real cheque / virtual card).
-- The fare-sale row with payment_processor='agency' is the agency's supplier-payout leg.
SELECT
    b.id,
    b.booking_date,
    b.gds,
    b.validating_carrier,
    CASE
        WHEN bsi.fop = 'credit_card'                         THEN 'cc'
        WHEN bsi.fop = 'cheque' AND bvcsi.id IS NULL         THEN 'CK'
        WHEN bsi.fop = 'cheque' AND bvcsi.id IS NOT NULL     THEN 'VCC'
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
- **Size class:** large (~28M rows). Always filter by `booking_date` or `id`.
- **Recommended constraints:** `booking_date` range, `is_test = 0`, optionally `status`, `gds`, `validating_carrier`.
- **Typical date range:** full history; practical analysis windows use the last 1–30 days.

**Notes:**
- `is_test = 0` and (depending on the question) `is_fraud = 0` / `cancel_reason IS NULL` are the usual "real booking" filters.
- A booking can spawn many `booking_statement_items` rows: fare / service_fees / ancillary / seatmap, each with `transaction_type` in (`sale`,`refund`,`exchange`,`payout`) and `payment_processor` in (`agency`,`payhub`, …). Always scope the join to the exact row you want — typically `type='fare'`, `transaction_type='sale'`, `payment_processor='agency'` for supplier-payout attribution, or `payment_processor='payhub'` for the customer-facing charge.
- `GROUP BY b.id` in the sample query deduplicates bookings that produce multiple matching agency-fare rows (e.g. one per passenger).
