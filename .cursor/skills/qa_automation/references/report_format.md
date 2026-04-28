# QA Validation Report — output format (canonical)

Every QA run ends with **one** markdown file: `{scenario_dir}/report.md`.
The body is overwhelmingly a single table; prose is limited to a header
paragraph (booking id, env, content source, route/date) and a one-line
overall verdict. The agent reads
[`validation_checklist.md`](validation_checklist.md), classifies each
invariant, and feeds the resulting records to `qa-report`.

## Columns

| Column        | What goes in                                                             |
|---------------|--------------------------------------------------------------------------|
| `Booking ID`  | Repeated per row so a multi-booking report still parses cleanly.         |
| `Validation`  | Short label of the invariant — pulled from `validation_checklist.md`.    |
| `Verdict`     | One of `PASS`, `FAIL`, `AMBIGUOUS`, `SKIPPED` (see vocabulary below).    |
| `Explanation` | One QA-voice sentence — the outcome, not the internal field.            |
| `Proof`       | A runnable query (inline backticks) **or** a debug-log permalink (raw URL). |

## Verdict vocabulary

| Verdict     | When                                                                                       |
|-------------|--------------------------------------------------------------------------------------------|
| `PASS`      | Invariant met — proof reproduces the result.                                               |
| `FAIL`      | Invariant violated.                                                                        |
| `AMBIGUOUS` | Expected transient state (e.g. `bookings.status = not_issued` right after book) or partial evidence the agent can't yet decide on. |
| `SKIPPED`   | The run could not exercise the check. Common on production CC-Decline runs that never reach `booking_statement_items`. Always include a `SKIPPED` row instead of dropping the invariant — the table is the audit trail. |

## Per-invariant proof catalogue

Pin one canonical proof per check from
[`validation_checklist.md`](validation_checklist.md). Use the exact
strings below as the starting point; the agent fills in real
`booking_id` / `id_hash` / `transaction_id` / `host` values per run.

| Validation (label for the row)                  | Canonical proof                                                                                                              |
|-------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------|
| `bookings.is_test = 1`                          | `` `SELECT id_hash, is_test FROM ota.bookings WHERE id = <booking_id>` ``                                                    |
| `bookings.status` post-book                     | `` `SELECT status FROM ota.bookings WHERE id = <booking_id>` ``                                                              |
| `bookings.content_source` matches target source | `` `SELECT content_source FROM ota.bookings WHERE id = <booking_id>` ``                                                      |
| `bookings.debug_transaction_id` populated       | `` `SELECT debug_transaction_id FROM ota.bookings WHERE id = <booking_id>` ``                                                |
| Passenger count matches search                  | `` `SELECT COUNT(*) FROM ota.booking_passengers WHERE booking_id = <booking_id>` ``                                          |
| Contestants present + source matches            | `` `SELECT id, content_source FROM ota.booking_contestants WHERE booking_id = <booking_id>` ``                               |
| Segments cover requested route                  | `` `SELECT origin_iata, destination_iata FROM ota.booking_segments WHERE booking_id = <booking_id> ORDER BY position` ``     |
| Statement items vs `total_shown_at_checkout`    | `` `SELECT SUM(amount) FROM ota.booking_statement_items WHERE booking_id = <booking_id>` `` + booker debug-log permalink     |
| Booking task succeeded                          | `` `SELECT task_type, status, message FROM ota.booking_tasks WHERE booking_id = <booking_id> ORDER BY id DESC LIMIT 5` ``    |
| Bookability attempts terminal state             | `` `SELECT id, state FROM ota.bookability_contestant_attempts WHERE search_hash = '<debug_transaction_id>'` ``               |
| `jupiter_booking_errors_v2` clean               | ClickHouse `SELECT count(), groupArray(main_group_error) FROM jupiter.jupiter_booking_errors_v2 WHERE search_id = '<debug_transaction_id>'` |
| Search telemetry shows source called            | ClickHouse `SELECT content_source, response, num_packages_returned FROM search_api_stats.gds_raw WHERE search_id = '<debug_transaction_id>' AND date_added >= now() - INTERVAL 24 HOUR` |
| `debug_logs` present for booker                 | `https://reservations.<host>/debug-logs/log-group/<debug_transaction_id>`                                                     |
| `optimizer_logs` present (reprice scenarios)    | `https://reservations.<host>/optimizer-logs/log-group/<debug_transaction_id>`                                                 |

`<host>` is the brand-aware ResPro host: `reservations.flighthub.com`,
`reservations.justfly.com`, or `reservations.voyagesalacarte.ca`.

## Worked example

```markdown
# QA Validation Report

booking `297983572` — env `production` — site `flighthub` — content source `amadeus` — YUL-LAX on 2026-07-15.

Overall verdict: **AMBIGUOUS** (5 validations run).

Scenario dir: `qa_automation/reports/20260428-110135-prod-amadeus-ac-yul-yvr`

| Booking ID | Validation | Verdict | Explanation | Proof |
|------------|------------|---------|-------------|-------|
| 297983572 | bookings.is_test = 1 | PASS | flagged as test booking, ResPro cleanup will pick it up | `SELECT id_hash, is_test FROM ota.bookings WHERE id = 297983572` |
| 297983572 | bookings.content_source matches target source | PASS | booked on amadeus as requested | `SELECT content_source FROM ota.bookings WHERE id = 297983572` |
| 297983572 | Shown vs charged total | PASS | $437.20 shown at checkout = $437.20 sum of statement_items | `SELECT SUM(amount) FROM ota.booking_statement_items WHERE booking_id = 297983572` |
| 297983572 | debug_logs present for booker | PASS | log group exists for the booker transaction | https://reservations.flighthub.com/debug-logs/log-group/abc123 |
| 297983572 | bookings.status post-book | AMBIGUOUS | status is not_issued; ticketing happens later in async workers | `SELECT status FROM ota.bookings WHERE id = 297983572` |
```

## Calling `qa-report`

```bash
cat <<'JSON' | uv run qa-report
{
  "header": {
    "booking_id": 297983572,
    "env": "production",
    "site": "flighthub",
    "content_source": "amadeus",
    "route": "YUL-LAX",
    "depart": "2026-07-15",
    "scenario_dir": "qa_automation/reports/20260428-110135-prod-amadeus-ac-yul-yvr"
  },
  "records": [
    {
      "booking_id": 297983572,
      "validation": "bookings.is_test = 1",
      "verdict": "PASS",
      "explanation": "flagged as test booking, ResPro cleanup will pick it up",
      "proof": "`SELECT id_hash, is_test FROM ota.bookings WHERE id = 297983572`"
    }
  ]
}
JSON
```

`qa-report` writes `{scenario_dir}/report.md` and emits one JSON object on
stdout: `{"report_path": "...", "overall_verdict": "PASS",
"validations_count": 1}`.

## Cell escaping

The renderer escapes pipes (`\|`) and collapses embedded newlines so each
row stays on a single line. Don't pre-escape pipes in the JSON envelope —
pass the raw query / explanation and let the renderer handle it.

## What this card does **not** cover

- Wording / tone of the `Explanation` cell — that's
  [`UEZ0oMf4`'s sibling `h0aYC7fr`](https://trello.com/c/h0aYC7fr).
- New comparisons (e.g. compare-vs-supplier) — those are the EPIC's other
  children. Once landed, they slot into the same per-row shape.
