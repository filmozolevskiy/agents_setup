# Single-booking flow investigation

Use when the user provides a **`booking_id`** or **`search_hash`** and asks "understand the flow",
"what went wrong for this booking", or equivalent.

**Goal:** chronological narrative of the booking's lifecycle, identifying the exact point and
reason for failure.

## Workflow

### 1. Resolve IDs

If only `booking_id` is provided, query MySQL to find the corresponding `search_hash` (same value
as `transaction_id` in Mongo).

```sql
SELECT search_hash
FROM ota.bookability_contestant_attempts
WHERE booking_id = 'YOUR_BOOKING_ID'
LIMIT 1;

-- If nothing there, fall back to the bookings table:
SELECT debug_transaction_id FROM ota.bookings WHERE id = 'YOUR_BOOKING_ID';
```

### 2. Fetch the full timeline

Query `ota.debug_logs` for the `transaction_id`. **Do not** filter by `context` initially — the
point is to see the whole picture.

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": "YOUR_HASH"}' \
  --sort '{"date_added": 1}' \
  --limit 2000 \
  --json
```

(Load `.env` first per `.cursor/rules/global_setup.md`.)

### 3. Identify key stages

Use the markers in `db-docs/mongodb/debug_logs.md` to segment the logs:

- **Checkout:** `checkout-deeplink`, `pre-checkout`
- **Availability:** `Check Availability` scope
- **Optimization:** `Optimization` scope
- **Payment:** `payhub_api_request_...`, `Verify`, `ThreeDs`, `Sale`
- **Booking:** `Booking flow` scope, `pre-air-booker`, `post-air-booker`
- **Ticketing:** `Ticketer` scope, `AirTicketRQ`
- **Failure / cleanup:** `CancelProcessor` scope, `CancelCard`

### 4. Analyze failures

- Look for `level: "error"` or `level: "critical"`.
- Inspect `Response` payloads from suppliers / GDS for raw error messages.
- Check Payhub responses for payment declines or 3DS issues.
- When both exist for the same event, **read supplier request/response first** (see
  [`debug_logs_query_patterns.md`](debug_logs_query_patterns.md#source-of-truth-supplier-traffic-vs-local-exceptions)).

### 5. Report findings

- **Summary** — one-sentence verdict (e.g. "Failed at booking stage due to GDS price increase").
- **Timeline** — bulleted list of key events with timestamps and `context`.
- **Root Cause** — detailed explanation including the raw supplier / processor message and a
  **permalink** to the log document (URL shape in
  [`harvest_permalinks.md`](harvest_permalinks.md#permalink-url-shape)).
