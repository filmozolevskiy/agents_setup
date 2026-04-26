# QA Validation Checklist

How to interpret the evidence blob returned by `qa-validate`. The runner
doesn't decide anything; this file is where judgment lives.

Each section maps an evidence key to the invariants the agent should check.
Every check has one of three outcomes:

- **PASS** — invariant met.
- **AMBIGUOUS** — expected transient state (e.g. booking just created, not
  yet issued). Report as "ok for now, re-check later" without failing.
- **FAIL** — invariant violated; report and proceed to `qa-cleanup`.

When something is clearly not covered here, say so in the report rather
than inventing a rule.

---

## `mysql.bookings` (one row)

Background: [`db-docs/mysql/bookings.md`](../../../../db-docs/mysql/bookings.md).

| Field | Expected right after `qa-book` | Notes |
|---|---|---|
| `id_hash` | matches `qa-book`'s `id_hash` | FAIL if different — wrong row. |
| `is_test` | `1` | FAIL if `0`; ResPro cleanup will not run and the `is_test=1` cron won't pick it up. |
| `status` | `not_issued` | AMBIGUOUS — ticketing happens later in async workers. Don't wait on `issued`. |
| `booking_date` | within the last few minutes | FAIL if wildly off. |
| `content_source` | the source the agent targeted | FAIL otherwise. |
| `debug_transaction_id` | non-empty string | FAIL if null — validation can't join to Mongo/CH without it. |
| `passenger_count_adt` etc. | match what `qa-search` used | FAIL otherwise. |

---

## `mysql.booking_contestants` (list)

Background: [`db-docs/mysql/booking_contestants.md`](../../../../db-docs/mysql/booking_contestants.md).

- **PASS**: at least one row for `booking_id`, with `content_source` matching
  `bookings.content_source`.
- **FAIL**: empty list, or all rows have a different `content_source` than
  the one booked.

---

## `mysql.booking_passengers` (list)

Background: [`db-docs/mysql/booking_passengers.md`](../../../../db-docs/mysql/booking_passengers.md).

- **PASS**: count matches `adt + chd + inf` passed to `qa-search`.
- **FAIL**: off-by-one or missing passenger type.

---

## `mysql.booking_segments` (list)

Background: [`db-docs/mysql/booking_segments.md`](../../../../db-docs/mysql/booking_segments.md).

- **PASS**: at least one segment per leg (1 for oneway, 2+ for roundtrip), and
  origin/destination of the first segment match what `qa-search` asked for.
- **AMBIGUOUS**: empty list is uncommon post-book but can happen on some
  content sources until the async segment-ingest finishes. Report as
  "segments not yet materialized, retry in ~30s".
- **FAIL**: segments exist but for a different route.

---

## `mysql.booking_statement_items` (list)

Background: [`db-docs/mysql/booking_statement_items.md`](../../../../db-docs/mysql/booking_statement_items.md).

- **PASS**: at least one row. Sum of signed amounts approximates the displayed
  total from `qa-book` (`total_shown_at_checkout`).
- **FAIL**: empty list (billing layer never ran) — this is a surprising gap.

---

## `mysql.booking_tasks` (list)

Background: [`db-docs/mysql/booking_tasks.md`](../../../../db-docs/mysql/booking_tasks.md).

- Informational. Look for `task_type = 'book'` rows with `status = 'done'`.
- `status = 'failed'` is a **FAIL** signal even if the portal said
  "successful" — check the most recent row's `message` column.

---

## `mysql.bookability_contestant_attempts_for_search`

Background: [`db-docs/mysql/bookability_contestant_attempts.md`](../../../../db-docs/mysql/bookability_contestant_attempts.md).

- **PASS**: at least one row with `state` indicating a successful book
  (e.g. `completed`, `succeeded`; reconcile with db-doc wording).
- **FAIL**: only failure states (`blocked_by_rules`, `timeout`, etc.) and
  yet `bookings.status` is not `cancelled`.

---

## `clickhouse.jupiter_booking_errors_v2`

Background: see `bookability_analysis` skill and its ClickHouse references.

- **PASS**: empty list.
- **FAIL**: any rows. Every row is a booking error signature. Report the
  `error_name`, `content_source`, and any payload snippet present.

---

## `clickhouse.search_telemetry_rows` (`search_api_stats.gds_raw`)

Background: [`db-docs/clickhouse/search_api_stats_gds_raw.md`](../../../../db-docs/clickhouse/search_api_stats_gds_raw.md).

`qa-validate` emits the raw `gds_raw` rows for this `search_id`, clipped by
`search_telemetry_window_hours` (default 24). The checklist is:

- **PASS**: the booked `content_source` appears in the rows with at least
  one `response = 'success'` call on `search_type = 'main'`. Ideally
  `num_packages_returned > 0` on that call.
- **AMBIGUOUS**: the source appears only on follow-up `search_type` values
  (e.g. `upsell`, `reprice`). That happens when the initial search call
  predates the window — widen `--search-telemetry-window-hours` and
  re-validate before concluding.
- **FAIL**: the booked source is absent from the rows entirely **or** every
  call for it has `response != 'success'` (e.g. `timeout`, an auth error).
  In that case the booking went through some other path (cached fare,
  manual override) — flag it.

Cross-check: if `response != 'success'` on the main call and
`jupiter_booking_errors_v2` has a row for the same `search_id`, the two
should agree on the source. Mismatch is always a FAIL.

---

## `mongodb.debug_logs_count` / `debug_logs_top`

Background: `bookability_analysis/references/debug_logs_query_patterns.md`
(not copied here — agents running qa-validate should open that doc if deep
payload inspection is needed).

- **PASS**: `debug_logs_count >= 1`, and at least one top doc has
  `context: "book"` with `Response_has: true` (or a non-empty `Response_preview`).
- **FAIL**: `debug_logs_count == 0`.
- **AMBIGUOUS**: `count > 0` but no `book` context doc found in the top N;
  increase `--mongo-limit` and re-validate.

Common patterns inside `Response` (via `_preview`):

- `status: "OK"` / `booking_reference` / `pnr_code` — good.
- HTTP 4xx / 5xx from supplier → map to the error observed in
  `jupiter_booking_errors_v2` if possible.

---

## `mongodb.optimizer_logs_count`

- Informational only. Non-zero is expected for reprice scenarios.
- If the scenario involved repricing and `optimizer_logs_count == 0`, flag
  as suspicious and cross-reference with `/optimizer_analysis`.

---

## Putting it together

1. Walk the blob top-to-bottom.
2. Record each check as PASS / AMBIGUOUS / FAIL.
3. Final outcome:
   - All PASS → "validation passed". Proceed to `qa-cleanup`.
   - Any FAIL → "validation failed: <list>". Still proceed to `qa-cleanup`
     unless the user asked to keep the booking.
   - PASS + AMBIGUOUS only → "validation ok, with deferred checks:
     <list>". Suggest re-running `qa-validate` after N seconds for the
     AMBIGUOUS items.
