# booking_notes

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~73.9M (InnoDB estimate)  |  **Size:** ~15.2 GB data
**Purpose:** Timestamped notes attached to a booking. System ticketing and payment recovery write here (`employee_id = 0`). Agents also write here. Shown on the ResPro page.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key. `auto_increment`. |
| `booking_id` | `int` | FK → `bookings.id`. Indexed (composite with `date_added`). |
| `employee_id` | `int` | Writer. **`0` = system.** Non-zero = agent user id. Default `0`. |
| `date_added` | `datetime` | When the note was written. Second column of the `booking_id` index — not a standalone time index. |
| `note` | `text` | Note body. Exact strings matter. |
| `highlight` | `tinyint(1)` | Highlight flag. Default `0`. |

**Key relationships:**
- `booking_notes.booking_id = bookings.id` — parent booking. Join from `bookings` (filter `booking_date` or `id`) so MySQL does not scan `booking_notes` by `date_added` alone.

**Common queries:**

```sql
-- Form-of-payment reject recovery notes on Amadeus (start from bookings).
SELECT n.note, COUNT(DISTINCT b.id) AS bookings
FROM bookings b
JOIN booking_notes n ON n.booking_id = b.id
WHERE b.booking_date >= '2026-08-13 00:00:00'
  AND b.booking_date < '2026-08-21 00:00:00'
  AND b.gds = 'Amadeus'
  AND n.note IN (
    'FOP not accepted. Switching to VCC',
    'FOP not accepted. Switching to check'
  )
GROUP BY n.note;
```

```sql
-- All notes on one booking, oldest first.
SELECT id, employee_id, date_added, note
FROM booking_notes
WHERE booking_id = 306283491
ORDER BY date_added, id;
```

**Query guidance:**
- **Size class:** large (~74M rows). Never filter `booking_notes.date_added` without `booking_id` or a driving `bookings` set.
- **Recommended constraints:** `booking_id`, or `bookings.booking_date` + `bookings.gds` then join notes.
- **Typical date range:** full history; practical windows use `bookings.booking_date` for the last 1–30 days.

**Notes:**
- Ticket-issue form-of-payment recovery writes exactly `FOP not accepted. Switching to VCC` or `FOP not accepted. Switching to check` (`employee_id = 0`). Confirmed 2026-08-20 on Amadeus bookings `306283491` (check), `306236021` (VCC), `306563331` (check).
- That note is the decision at reject time. The later agency fare statement FOP can still be `credit_card` after Wenrix issuance or a new customer card. Do not treat final `booking_statement_items.fop` as proof of this note.
- Related retry log text (debug log, not this table): `FOP switched to VCC successfully. Retrying issuance.` / `FOP switched to check successfully. Retrying issuance.`
