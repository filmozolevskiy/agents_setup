# Run summary voice — worked examples

Two anchors so the agent does not regress to developer voice when writing
the final run summary. Both are real-shaped runs (booking IDs and totals
are illustrative; the structure and phrasing are canonical). Read them
side-by-side: the **internal-voice** column is what the agent has
historically written and must stop writing; the **QA-voice** column is
the deliverable.

The structure (header → per-stage outcomes → validation table) and the
ban-list are pinned in
[`../SKILL.md`](../SKILL.md) §
"Run summary: write for QA, not for the agent's author". The validation
table columns / verdict vocabulary come from sibling
[https://trello.com/c/UEZ0oMf4](https://trello.com/c/UEZ0oMf4).

---

## Example 1 — Staging happy path (Amadeus, YUL→LAX)

Scenario: `qa-search` → `qa-search-telemetry` → `qa-book
--content-source amadeus` → `qa-validate` → `qa-cleanup` on
`staging2.flighthub.com`. Booking confirmed; all invariants met.

### Internal voice (do NOT write this)

> Run summary
>
> - qa-search: ok. transaction_id=`abc123…` captured from
>   `https://staging2-api.flighthub.com/storefront-api/...`. 17
>   packages enumerated. Debug Filter sources: Amadeus, Kiwi,
>   Navitaire-ndc, Tripstack. Origin autocomplete fell back to IATA
>   `YUL`. Selector probe `results.debug_filter_toggle` ok.
> - qa-search-telemetry: ok. `gds_raw` returned 1 row for amadeus,
>   `status="ok"`, attempt_count=20, packages_won=17.
> - qa-book: ok. `--content-source amadeus`, optimizer disabled. id_hash
>   `2F3…`, booking_id `297983572`, debug_transaction_id `abc123…`.
>   `is_test=1`. checkout React form mounted in 4.8 s. Storefront-API
>   URL probe missed for one segment; not blocking.
> - qa-validate: ok. bookings.is_test=1, status=not_issued.
>   booking_statement_items SUM matches `total_shown_at_checkout`.
>   debug_logs_count=17. jupiter_booking_errors_v2 empty.
> - qa-cleanup: ok. Override to Cancel clicked, ResPro queued
>   `Work Order Process [Abort Booking]`, banner observed in 35 s.

Why this is wrong: it leaks the booking session ID, the storefront-api
URL, the table name `gds_raw`, the `transaction_id` /
`debug_transaction_id` field names, the `--content-source` flag, "not
blocking" hedging on a probe miss the user does not need to know about,
and ResPro work-order vocabulary. A QA reader has to translate every
line before they can act on the run.

### QA voice (write THIS)

```markdown
## QA run summary

Booking 297983572 on staging via Amadeus, YUL→LAX departing 2026-07-15
(one-way, 1 adult). Outcome: PASS — booking confirmed at $437.20 USD,
all validation checks met, booking cancelled in ResPro.

**Per-stage outcomes**

- **Search** — Returned 17 packages on Amadeus on the first attempt.
- **Search telemetry** — Amadeus responded successfully to the search.
- **Book** — Confirmed at $437.20 USD on Amadeus; portal booking ID
  `2F3…`. Flagged as a test booking, so no ticket was issued.
- **Validate** — All invariants in
  [`validation_checklist.md`](validation_checklist.md) met. See the
  table below.
- **Cleanup** — Booking cancelled in ResPro; cancellation banner
  visible within 35 s.

| Booking ID | Validation | Verdict | Explanation | Proof |
|------------|------------|---------|-------------|-------|
| 297983572  | Flagged as test booking | PASS | `is_test = 1` set on the booking row | `SELECT id_hash, is_test FROM ota.bookings WHERE id_hash = '2F3…'` |
| 297983572  | Supplier matches request | PASS | Booking landed on Amadeus, the supplier asked for | `SELECT content_source FROM ota.bookings WHERE id_hash = '2F3…'` |
| 297983572  | Passenger count matches request | PASS | 1 adult on the booking, 1 adult requested | `SELECT COUNT(*) FROM ota.booking_passengers WHERE booking_id = 297983572` |
| 297983572  | Segments match requested route | PASS | 1 segment present, YUL→LAX | `SELECT origin, destination FROM ota.booking_segments WHERE booking_id = 297983572` |
| 297983572  | Shown vs charged total | PASS | $437.20 shown at checkout = $437.20 sum of statement items | `SELECT SUM(amount) FROM ota.booking_statement_items WHERE booking_id = 297983572` |
| 297983572  | Supplier log group present | PASS | Booking call recorded in the supplier log group | https://reservations.voyagesalacarte.ca/debug-logs/log-group/abc123… |
| 297983572  | No supplier or pipeline errors | PASS | No rows in the booking-error feed for this booking session | (empty result expected) |

Scenario dir: `qa_automation/reports/20260423-120000-amadeus-smoke/`.
```

Notes:

- The booking session ID, table names, exception classes, and selector
  probes are absent from both the per-stage lines and the table. They
  still live in the scenario dir and the captured stdout/stderr per
  [Where to redirect stdout/stderr](../SKILL.md#where-to-redirect-stdoutstderr).
- The `Explanation` cell uses plain language; the field name appears
  only in the `Proof` query, where it has to be runnable.
- Supplier log group is a `Proof` URL, not a sentence; one proof per
  cell per sibling [UEZ0oMf4](https://trello.com/c/UEZ0oMf4).
- The "fell back to IATA" autocomplete detail and the
  `storefront-API URL probe missed; not blocking` line are dropped —
  neither changes what QA does.

---

## Example 2 — Production CC Decline injection (Amadeus, FLL→MEM)

Scenario: `qa-book --booking-failure-reason "CC Decline"` on
`www.flighthub.com`. Expected outcome: payment page re-renders with
the credit-card alert, no supplier call, no charge, no booking row.
Validation runs are mostly `SKIPPED` because there is no booking to
validate.

### Internal voice (do NOT write this)

> Run summary
>
> - qa-search: ok. transaction_id `52d028…` captured. 12 packages.
> - qa-search-telemetry: ok. amadeus responded `status="ok"`.
> - qa-book: error `booking_failed_by_injection`. failure_origin
>   `qa_injection`. front_end_markers=["cc_decline"]. Card never
>   authorised. No `ota.bookings` row persisted. Banner: env=production
>   host=www.flighthub.com content_source=amadeus
>   booking_failure_reason="CC Decline" cc_masked="411111…1111".
> - qa-validate: most checks SKIPPED (no booking_id). debug_logs_count=4
>   for transaction_id `52d028…`, jupiter_booking_errors_v2 empty.
> - qa-cleanup: skipped — nothing to cancel (no booking_id).

### QA voice (write THIS)

```markdown
## QA run summary

CC Decline scenario on production via Amadeus, FLL→MEM departing
2026-07-15 (one-way, 2 adults + 1 child + 1 lap infant). Outcome:
PASS — payment page re-rendered with the credit-card alert as
expected; no charge was made and no booking was persisted.

**Per-stage outcomes**

- **Search** — Returned 12 packages on Amadeus.
- **Search telemetry** — Amadeus responded successfully to the search.
- **Book** — CC Decline behaved as designed: card never authorised,
  payment page showed the credit-card alert, no booking row created.
  This is the expected outcome of a CC Decline run.
- **Validate** — Most checks `SKIPPED`: there is no booking to
  validate. The supplier log group for the booking session is
  present, which confirms the request reached our pipeline before
  the short-circuit.
- **Cleanup** — Skipped — there is no booking to cancel.

| Booking ID | Validation | Verdict | Explanation | Proof |
|------------|------------|---------|-------------|-------|
| —          | Booking row created | PASS | No booking row exists, which is the expected outcome of a CC Decline run | `SELECT * FROM ota.bookings WHERE debug_transaction_id = '52d028…'` |
| —          | Card was not authorised | PASS | Payment page re-rendered with the credit-card alert; no gateway call recorded | https://www.flighthub.com/debug-logs/log-group/52d028… |
| —          | Supplier was not contacted | PASS | No supplier booking call recorded for this booking session | https://www.flighthub.com/debug-logs/log-group/52d028… |
| —          | Flagged as test booking | SKIPPED | No booking row to inspect | n/a |
| —          | Supplier matches request | SKIPPED | No booking row to inspect | n/a |
| —          | Passenger count matches request | SKIPPED | No booking row to inspect | n/a |
| —          | Segments match requested route | SKIPPED | No booking row to inspect | n/a |
| —          | Shown vs charged total | SKIPPED | No booking row to inspect | n/a |

Scenario dir: `qa_automation/reports/20260424-101000-prod-amadeus-cc-decline/`.
```

Notes:

- The injection banner content (env, host, content_source, masked
  card, `failure_origin=qa_injection`) is captured in the
  `qa-book` stderr log inside the scenario dir; the summary just
  says "behaved as designed".
- `failure_origin`, `front_end_markers`, `clickhouse_errors`,
  `booker_diagnosis` are all internal vocabulary — they do not
  appear in the summary. The QA reader gets the outcome
  ("payment page re-rendered with the credit-card alert"), which is
  what they actually need.
- `SKIPPED` is the right verdict for invariants that need a booking
  row when the scenario is designed not to produce one, per sibling
  [UEZ0oMf4](https://trello.com/c/UEZ0oMf4).
- Proof URLs use the production host (`www.flighthub.com`), not
  staging. The agent picks the host per the booking env.

---

## Stage-by-stage QA-voice phrase bank

Use as a starting point when neither example fits exactly. One line per
stage; pick the form that matches the actual outcome.

### `qa-search`

- "Returned N packages on `<supplier>` on the first attempt."
- "Returned N packages after one retry on the next day; first attempt
  came back empty."
- "No packages returned within the retry budget; reported as a
  search failure."
- "Search failed unexpectedly; full traceback in the scenario dir."
- "The site's homepage layout changed; the runner could not submit
  the search form. Selector probe output saved to the scenario dir."

### `qa-search-telemetry`

- "`<supplier>` responded successfully to the search."
- "`<supplier>` did not respond on the initial search call (timeout);
  later calls reused the same booking session."
- "`<supplier>` is absent from the telemetry rows entirely — the
  booking went through some other path."

### `qa-book`

- "Confirmed at $X.XX `<currency>` on `<supplier>`; portal booking ID
  `<id_hash short>`. Flagged as a test booking, so no ticket was
  issued."
- "Supplier rejected the fare (no longer available). Bookability
  drift between search and book."
- "Our payment gateway declined the card."
- "Price drifted past our loss-limit guard between search and book."
- "Submit succeeded but the confirmation page never loaded; the
  booking row exists, so cleanup will still run."
- "CC Decline behaved as designed: card never authorised, payment
  page showed the credit-card alert, no booking row created."
- "The site's checkout layout changed; the runner could not reach
  the payment step. Selector probe output saved to the scenario
  dir."

### `qa-validate`

- "All invariants in `validation_checklist.md` met. See the table
  below."
- "Some invariants did not match; failures are listed in the table
  below."
- "Most checks `SKIPPED`: there is no booking to validate." (failure
  injection / search-only runs)
- "Most checks `AMBIGUOUS` immediately after book; re-run validation
  in ~30 s for segments and statement items."

### `qa-cleanup`

- "Booking cancelled in ResPro; cancellation banner visible within
  N s."
- "Booking was already cancelled before cleanup ran (idempotent
  no-op)."
- "Skipped — there is no booking to cancel."
- "Skipped at user request — booking left in place."
- "ResPro UI changed; the runner could not complete cancellation.
  Selector probe output saved to the scenario dir; booking still
  needs manual cancellation."

---

## What goes outside the summary (engineer-only)

Keep these for the scenario dir and the captured stdout/stderr; do not
echo them in the summary unless the engineer-only context is the whole
ask:

- Booking session IDs (`transaction_id`, `debug_transaction_id`,
  `search_hash`).
- Internal table names (`gds_raw`, `jupiter_booking_errors_v2`,
  `optimizer_logs`, `debug_logs`).
- Internal endpoint names (`storefront-API`, `/storefront-api/`,
  `/debug-logs/log-group/`).
- Exception class names (`Mv_Ota_Air_Booker_Exception_*`,
  `unhandled_exception`, `selector_not_found`).
- Runner-internal field names (`is_test`, `package_id`, `id_hash`,
  `failure_origin`, `front_end_markers`, `failure_origin=qa_injection`).
- Probe / fallback chatter ("storefront-API URL probe missed; not
  blocking", "fell back to IATA autocomplete match", "Debug Filter
  dropdown absent on production, used per-card Show Info toggle",
  "optimizer disabled before submit").
- Retry-ladder steps ("shifted depart +1", "alt route YUL→ORD per
  retry policy"). The summary states the **outcome**: "Search
  retried once on the next day…".

When in doubt: if removing a phrase would not change what a QA reader
does next, remove it.
