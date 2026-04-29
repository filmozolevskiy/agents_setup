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

The deliverable is **header paragraph → findings table → recommended next step**, nothing in between. Follow the canonical layout from [`report_format.md`](report_format.md); for single-booking reports there is one table (no separate failure-causes table — there's only one cluster of one).

- **Header paragraph** — one short paragraph stating booking ID, supplier, route + date(s), and the headline outcome. Quote the supplier verbatim if it's the headline ("Failed at the booking step. `Downtowntravel::BookFlight` returned `{\"message\":\"failed: Similar order already exists\",\"reason\":\"failed\"}`. Client had cancelled a same-itinerary booking 38 minutes earlier — matches the documented rebook-after-cancel pattern. Customer did not recover."). Do **not** also bullet the per-stage outcomes — every stage is already a row in the table below.
- **Findings table** — one row per stage the booking actually traversed, plus optional cross-stage rows:
  - **Per-stage rows (`PASS` / `FAIL` / `AMBIGUOUS` / `SKIPPED`)** — Search, Availability, Optimization, Payment, Booking, Ticketing, Cleanup. `Finding` is the business label ("Search returned packages", "Card was authorised", "Supplier rejected the booking"). `Explanation` quotes the supplier `Response` body verbatim when the row is `FAIL` ("`Downtowntravel::BookFlight` returned `{\"message\":\"failed: Similar order already exists\",\"reason\":\"failed\"}`") and gives one sentence of context after the quote. `Proof` is a `debug_logs` permalink — always on the `voyagesalacarte.ca` host (ResPro is shared across brands; full URL shape in [`harvest_permalinks.md`](harvest_permalinks.md#permalink-url-shape)). For `PASS` rows the stage-filtered shape is fine: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>?context=<stage context>`. For `FAIL` rows pin to the exact entry that proves the failure: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` (pull `<_id>` from Mongo for the supplier-error context — cheat-sheet in [`standard_bookability_report.md`](standard_bookability_report.md#supplier-error-context-cheat-sheet)). For rows sourced from MySQL, inline the runnable query directly.
  - **Customer recovery row (`PASS` / `FAIL`)** — did the customer book on a different supplier on the same customer attempt? `Proof` is the inline `` `SELECT u.status FROM ota.bookability_customer_attempts u JOIN ota.bookability_contestant_attempts c ON c.customer_attempt_id=u.id WHERE c.search_hash='<hash>'` `` query.
  - **Booking row metadata row (`INFO`)** — `is_test`, `status`, `validating_carrier` from `ota.bookings`. `Proof` is `` `SELECT id, is_test, status, validating_carrier FROM ota.bookings WHERE id = <booking_id>` ``.
  - **Failure-injection rows (when applicable, `PASS`)** — when the user themselves induced the failure (CC Decline test, fare-increase injection), the row that *would* be `FAIL` ships as `PASS` with `Explanation` "behaved as designed".
- **Recommended next step** — one short list of follow-ups (open / update a Trello card, escalate to supplier liaison, no action when the cause is documented and already tracked). Skip the section entirely when no action is genuinely needed.

Every `Proof` cell is runnable — a permalink or an inline query, never a documentation reference. A worked single-booking report lives in [`report_format.md`](report_format.md) § *Worked example 2 — Single-booking flow investigation*. Match its row mix.
