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
| `passenger_count_adt`, `departure_date`, `departure_airport_code`, `departure_airport_code`, `destination_airport_code`, etc. | match what `qa-search` used | FAIL otherwise. |


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

## `mysql.booking_statement_transactions` (list)

Background: [`db-docs/mysql/booking_statement_transactions.md`](../../../../db-docs/mysql/booking_statement_transactions.md).

Full processor-operation log for the booking — every `auth`,
`auth_capture`, `capture`, `auth_reversal`, `refund`, `void`,
`card_verification`, `payout` row across every processor (`payhub`,
`agency`, `gordian`, `xcover-*`, …). Use this list when you need to
inspect refund / reversal chains or non-Payhub processors. For the
"what we charged the customer?" comparison the aggregate helpers below
are easier — but the raw rows are what they're aggregating.

---

## Payment consistency (cross-evidence)

Background:
[`db-docs/mysql/booking_statement_transactions.md`](../../../../db-docs/mysql/booking_statement_transactions.md),
[`db-docs/mysql/booking_statement_items.md`](../../../../db-docs/mysql/booking_statement_items.md),
[`db-docs/mysql/booking_virtual_card_statement_items.md`](../../../../db-docs/mysql/booking_virtual_card_statement_items.md).

`qa-validate` does **not** compute payment verdicts. It surfaces three
SQL-side aggregates under `mysql.*`; you compare them against each
other and against the `qa-book` DOM total.

| Evidence key | What it is |
|---|---|
| `mysql.payhub_capture_summary` | `SUM(amount)` / `currency_set` / `row_count` / `billing_info_ids` over `booking_statement_transactions` filtered to `processor='payhub' AND type='auth_capture' AND status='success'`. The **gateway grand total**. |
| `mysql.payhub_ledger_summary` | `SUM(customer_amount)` / `currency_set` / `row_count` / `billing_info_ids` / `type_breakdown` over `booking_statement_items` filtered to `payment_processor='payhub' AND transaction_type='sale' AND status='paid'` (no `bsi.type` filter — fare + service_fees + ancillary_* + seatmap_fee). The **ledger grand total**. The `type_breakdown` is forensic detail; the comparison uses the grand total. |
| `mysql.agency_supplier_payout_fop` | `payhub_capture_count`, `payhub_billing_info_ids`, `agency_cc_billing_info_ids` — the inputs to the double-payment guard. |
| `mysql.bookings.checkout_fare_total` / `display_currency` | **Auxiliary only.** Fare-only, not the grand total. Do not anchor a grand-total comparison on this. |

Decimal amounts are emitted as JSON **strings** (e.g. `"366.97"`) so
precision survives the round-trip. Convert with `Decimal(value)` before
comparing.

You also need the customer-shown grand total from your own session
context — `qa-book`'s `total_shown_at_checkout` /
`currency_shown_at_checkout`. The runner does not echo this back; you
already have it from the preceding `qa-book` call.

### Sub-checks to run, in order

#### 1. Internal consistency: gateway vs ledger

Always run. The gateway log and the per-line ledger are two views of
the same charges; they must agree.

- **PASS** — `payhub_capture_summary.sum == payhub_ledger_summary.sum`
  AND the single-element `currency_set` matches AND `row_count > 0` on
  both. Treat amounts as `Decimal`; exact match (no epsilon) for FH/JF.
- **AMBIGUOUS** — `payhub_capture_summary.row_count == 0`. No successful
  Payhub capture row yet — capture pending. Retry validation after a
  short delay.
- **FAIL** — gateway and ledger disagree on amount or currency, or
  gateway has a row but ledger has none (or vice versa). This is always
  a hard FAIL: the two internal sources should never drift. Cite both
  sums verbatim and flag the booking for manual review.

#### 2. DOM vs charged: customer-facing consistency

Compare the `qa-book` DOM total against **both** `payhub_ledger_summary`
and `payhub_capture_summary` (treat them as one if sub-check 1 passed).

- **PASS** — `qa-book.total_shown_at_checkout` matches `ledger_total`
  amount AND `qa-book.currency_shown_at_checkout` matches the ledger's
  single-element `currency_set`.
- **AMBIGUOUS** — sub-check 1 was AMBIGUOUS (capture pending). Retry.
- **FAIL `currency_mismatch`** — currencies differ. Hard FAIL.
- **FAIL `amount_mismatch`** — amounts differ. Hard FAIL. Report both
  values verbatim.
- **NOT_APPLICABLE** — you don't have a fresh `qa-book` total in
  context (e.g. you're revalidating a historical booking outside a
  fresh book flow). `bookings.checkout_fare_total` is fare-only and is
  **not** a substitute. Skip this sub-check; sub-checks 1 and 3 still
  apply.

#### 3. Double-payment guard

Detects whether the customer was both charged on Payhub *and* their
card sent to the supplier on the agency leg. Inputs come from
`mysql.agency_supplier_payout_fop`:

- `payhub_capture_count` — successful Payhub captures on the booking.
- `payhub_billing_info_ids` — `billing_info_id` set for Payhub paid-sale
  ledger rows (which card we charged).
- `agency_cc_billing_info_ids` — `billing_info_id` set for agency-side
  **fare** payouts where `fop='credit_card'` AND there's no matching
  `booking_virtual_card_statement_items` row (real customer-card
  passthrough, NOT a VCC).

Verdicts:

- **PASS** — at most one of `{payhub_billing_info_ids,
  agency_cc_billing_info_ids}` is non-empty. Single-pay path.
- **AMBIGUOUS** — both are empty AND `payhub_capture_count == 0`. No
  fare leg yet — capture pending or not-issued. Retry.
- **FAIL `double_payment_same_card`** — both sets non-empty AND they
  share at least one `billing_info_id`. The customer's card was charged
  by us *and* sent to the supplier. Hard FAIL — escalate.
- **FAIL `double_payment_disjoint_cards`** — both sets non-empty but
  disjoint. Less severe (could be a reissue/exchange artefact or
  misconfiguration), but still a FAIL — call it out.

### Decision shortcut

```
all three sub-checks PASS              → payment validation passed
any sub-check FAIL                     → payment validation failed
                                          (cite the failing values)
any sub-check AMBIGUOUS, none FAIL     → retry qa-validate after a
                                          short delay; do not cleanup yet
sub-check 2 NOT_APPLICABLE,
  sub-checks 1 + 3 PASS                → "payment validation partial —
                                          DOM total not in context";
                                          rerun via qa-book to anchor
                                          the customer-facing comparison
```

Tolerance: amounts are exact-decimal-match for FH/JF. Currencies are
exact-string-match (`"USD" == "USD"`, `"CAD" != "USD"`). If a future
supplier needs an epsilon, document it inline in the report rather
than silently widening the rule.

Out of scope here: supplier-sent amount/currency. That comparison is
deferred to a follow-up card under the same epic.

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
