# Standard bookability report

Default output when the user asks for bookability on a **content source** (`bconta.gds`),
**carrier**, or **office**. Always SQL-first — do NOT jump to MongoDB immediately.

The report pulls from two stores in parallel (see `SKILL.md` § *Data sources and join key*):

- **MySQL `ota.bookability_*`** — summary (§ 1), failure-facing detail (§ 2). Needs successes
  and customer-attempt grain, so CH cannot substitute here.
- **ClickHouse `jupiter.jupiter_booking_errors_v2`** — error bucket (§ 3). Primary source for the
  failure signatures (real supplier text, `booking_step`, classification); MySQL
  `bconta.error` is a coarse fallback only.

The deliverable is a single markdown report that follows the canonical column shape in
[`report_format.md`](report_format.md): a header paragraph, per-section outcomes, a
`Finding | Verdict | Explanation | Proof` table, and a recommended next step. The SQL
below is the **proof source** — every row in the findings table cites one of these
queries (or a CH variant) in its `Proof` column. Do not paste raw SQL output into the
report body; raw output goes to `reports/_stdio/standard-<source>-<UTC>.json`.

After presenting this report, **offer** a Mongo deep dive (see
[`deep_bookability_analysis.md`](deep_bookability_analysis.md)) when CH's `error_message` is
too terse (e.g. generic wrappers, truncated NDC payloads) or when you need the full request /
response body.

## Shared base filters (use these everywhere)

Every metric in the report must come from the same row set:

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` → `bookability_built_contestant`
  (see template below).
- `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- **Production only:** `(b.is_test = 0 OR b.is_test IS NULL)` unless the user asks for tests.
- **Multi-ticket:** keep master + slave rows. Each MT leg is a separate contestant attempt with its own bookability outcome; counting both matches the CH grain and the real number of supplier calls. Use a `multiticket_part` filter only for pair audits (see `SKILL.md` § *Multi-ticket pair audits*).
- **Time window:** bound `bcusta.date_created` (indexed) — never scan the full table.
- **Contestant outcome:** `bconta.status = 1` success, `bconta.status = 0` failure.
- **Customer outcome:** `bcusta.status = 1` customer booked, `bcusta.status = 0` did not.

## Report shape (mandatory)

The report renders as **two tables** per the canonical layout in [`report_format.md`](report_format.md): a findings table for rate / volume / recovery / repeat / classification / uncorrelated rows, and a separate top-failure-causes table for the ClickHouse signature clusters with verbatim supplier evidence.

No preamble bullet list between the header and the tables. No "MySQL vs ClickHouse row-count reconciliation" row.

### Findings table — mandatory rows (in this order)

1. **Volumes** — `Total attempts` and `Total failures`, both `INFO`. One row per day when the report covers more than one day. § 1 SQL. The `Total failures` row's `Explanation` should split bookability vs payment-side and flag *"one of those clusters may be misclassified — see failure-causes table"* when applicable.
2. **Bookability success rate** — `HEALTHY` / `DEGRADED` / `CRITICAL` against the supplier's documented baseline; `INFO` when no documented baseline exists yet (and an "establish baseline" line goes into the recommended next steps). Always state count and share together ("365 / (365 + 59) = 86.1 %"). § 1 SQL.
3. **Customer recovery rate after the supplier failed** — same verdict scheme as above, defaulting to `INFO` when no documented baseline. Always include even when no failures occurred — verdict `SKIPPED` with explanation in that case. § 1 SQL.
4. **Repeat-client failures** — `INFO`. Count of distinct clients (`surfer_id`) with ≥ 2 failing customer attempts in the window, named retriers if interesting. § 2 SQL.

### Optional findings rows

- **Test-flag warning** — `INFO` row when `is_test = 1` rows leaked into a production-only request and were filtered out — state how many.

### Rows we deliberately do **not** include

These rows used to be on every report and rarely changed what anyone did. They are dropped:

- ~~MySQL ↔ ClickHouse classification mismatch~~ — when the failure-causes table uses ClickHouse (which it always does), a sentence in the `Total failures` row's `Explanation` is enough framing. A standalone row was noise.
- ~~Uncorrelated rows~~ — when the count is small (the common case) the row says nothing; when it's large it surfaces inside the failure-causes table as an `AMBIGUOUS` cluster row instead.
- ~~MySQL vs ClickHouse row-count reconciliation~~ — see `SKILL.md` voice rules.

### Top failure causes table — mandatory whenever there are bookability failures

Render as a separate markdown table with the columns defined in [`report_format.md`](report_format.md) § *Top failure causes table*: `Cause | Verdict | Sessions over the window | Supplier verbatim | ClickHouse SQL | Sample session`.

- One row per dominant cluster — typically the top 3–5 by session count, or all clusters owning > 5 % of bookability failures. Skip clusters with `< 5` sessions over the window.
- The `Supplier verbatim` cell quotes the actual `Response` / `Error-Data` body from `debug_logs` for one anchor session per cluster — pull it from Mongo before writing the report (one batched `$in` query over the cluster's sample `search_id`s is enough). Don't paraphrase. Add one sentence of context after the quote when the message alone isn't self-explanatory.
- The `Sample session` cell carries the `debug_logs` permalink for the anchor session whose verbatim text appears in `Supplier verbatim`.
- Verdict mirrors share of bookability-failure bucket: `> 50 %` → `CRITICAL`, `15–50 %` → `DEGRADED`, `< 15 %` → `INFO`. Misclassification clusters that meaningfully shift the headline rate ship as `CRITICAL` regardless of share.

If the user explicitly asks for the raw signature dump (full table by row count), produce it separately under `reports/_stdio/standard-<source>-<UTC>.log` and cite that path in the recommended next steps. Do not inline the full `error_message` × `booking_step` × `classification_category` cross product into the report body — it defeats the qa-style table.

Worked example matching this shape lives in [`report_format.md`](report_format.md) § *Worked example 1 — Standard bookability report*.

### § 1 — Definitions for the rate / recovery rows

| Metric | Definition |
|--------|------------|
| **Total attempts** | Row count of the base set (one row per contestant attempt, counting MT master + slave legs separately). |
| **Total failures** | Rows where `bconta.status = 0`. |
| **Contestant bookability success rate (excl. non-bookability)** | `successes / (successes + bookability_failures)` where **bookability failures** are contestant failures whose `bconta.error` is **not** in the non-bookability error list (see SKILL.md). NULL/empty error counts as bookability-side unknown until classified. **Non-bookability failures are excluded from numerator and denominator.** **`loss_limit_fare_increase` is a bookability failure** (included in the rate). |
| **Customer recovery rate after the content source failed** | Among **distinct `customer_attempt_id`** with **at least one** failing contestant row on the content source under analysis (`bconta.status = 0`), the fraction where **`bcusta.status = 1`** (customer ultimately booked — typically another contestant). Formula: `COUNT(DISTINCT CASE WHEN contestant_failed AND customer_ok THEN ca_id END) / COUNT(DISTINCT CASE WHEN contestant_failed THEN ca_id END)`. |

Report the recovery rate as a **percentage** and **counts** (e.g. "72 / 153 = 47%").

For **multiple calendar days** (e.g. today vs yesterday), either run the same template **once per
day** (`WHERE bcusta.date_created >= … AND < …`) or add `DATE(bcusta.date_created) AS report_day`
to the `base` CTE and `GROUP BY report_day` for each metric (use `COUNT(DISTINCT …)` forms where
needed). One row per day in the findings table; do not concatenate days into one cell.

### § 2 — Definitions for the failure-facing rows

| Metric | Definition |
|--------|------------|
| **Unique clients (`surfer_id`)** | `COUNT(DISTINCT surfer_id)` **excluding NULL**; report **Unknown / NULL `surfer_id` rows** separately (count of failing rows and distinct `customer_attempt_id` if useful). |
| **Repetitive attempts** | Among failing rows: `surfer_id IS NOT NULL` and **≥ 2 distinct `customer_attempt_id`** in the window for that `surfer_id` on this content source (same base filters). List or count those surfers; optionally show `surfer_id` + attempt counts. |
| **Was it finally booked?** | For **distinct `customer_attempt_id`** that have a failure on this content source: split **`bcusta.status = 1`** vs **`bcusta.status = 0`** (booked vs not). This pairs with **partial** vs **complete** failure language. |

### § 3 — Failure signatures (ClickHouse primary, rendered in the top-failure-causes table)

**Primary source:** `jupiter.jupiter_booking_errors_v2`. Carries the real supplier text (`error_message`), the step it failed at (`booking_step`), and a classification (`classification_category` / `classification_subcategory`, `main_group_error` / `sub_group_error`).

Use the same `gds` value as in MySQL (`bconta.gds == jupiter_booking_errors_v2.gds`). Narrow the time window with `timestamp`, not `date_created`.

Translate the supplier text into a business-voice `Cause` label ("Supplier said the seats are gone on the booking step" instead of `failed: There are no seats left` or `bookFlightOperation()`); the verbatim supplier message goes in the `Supplier verbatim` cell of the top-failure-causes table, not in `Cause`. Pull the verbatim from Mongo per the workflow in § *Pulling Mongo evidence for the failure-causes table* below — never write the report from CH's `error_message` alone, because CH frequently truncates or wraps the supplier body (`Failed to reprice` is the canonical example: CH stores the wrapper, Mongo carries the underlying NDC code).

The category roll-up (`classification_category` → count) belongs in the **classification-mismatch findings row**, not in a separate roll-up section. A one-line framing in the header paragraph ("two flight-availability signatures account for ~50 % of bookability failures") is fine and encouraged.

#### Primary SQL — raw signatures

```sql
-- ClickHouse: failure signatures for {content_source} in [start_datetime, end_datetime)
SELECT
  classification_category,
  classification_subcategory,
  booking_step,
  main_group_error,
  sub_group_error,
  error_message,
  count() AS c,
  uniqExact(search_id) AS distinct_search_ids,
  arrayStringConcat(groupArray(5)(search_id), ', ') AS sample_search_ids
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= '{start_datetime}'
  AND timestamp <  '{end_datetime}'
  AND gds = '{content_source}'
  /* AND validating_carrier = 'XX' */
  /* AND affiliate = 123 */
GROUP BY classification_category, classification_subcategory, booking_step,
         main_group_error, sub_group_error, error_message
ORDER BY c DESC
```

#### Optional sidecar — category roll-up

Only when you want a one-line framing on top of the signature table. Never a replacement.

```sql
SELECT classification_category, count() AS c, uniqExact(search_id) AS distinct_search_ids
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= '{start_datetime}'
  AND timestamp <  '{end_datetime}'
  AND gds = '{content_source}'
GROUP BY classification_category
ORDER BY c DESC
```

Report according to the **bookability-rate lens** by default (see `SKILL.md` § *Error
classification mapping*): all categories count as bookability failures except `PAYMENT_ERRORS`.
If the user is asking for an integration-health read instead, switch to that lens and say so.

**Fallback — MySQL only:** use the `bconta.error` histogram below **only** when CH returns no
rows for the window (suggests an ingestion lag or an unclassified path). The MySQL codes are
coarse (e.g. `flight_not_available_other`) and often hide the real supplier message.

**MySQL fallback (coarse):**

```sql
SELECT IFNULL(NULLIF(TRIM(contestant_error),''),'(empty)') AS err, COUNT(*) AS c
FROM base
WHERE contestant_status = 0
GROUP BY err
ORDER BY c DESC;
```

## SQL: standard metrics (template)

Replace date range, `gds` (`{content_source}`), and optional `validating_carrier` / `office_id`
filters.

```sql
-- Standard bookability report — summary + failure breakdown (MySQL ota)
-- Adjust: dates, bconta.gds = '{content_source}', optional carrier / office

WITH base AS (
  SELECT
    bcusta.id AS customer_attempt_id,
    bcusta.surfer_id,
    bcusta.status AS customer_status,
    bconta.status AS contestant_status,
    bconta.error AS contestant_error,
    bconta.booking_id,
    bconta.search_hash
  FROM ota.bookability_customer_attempts bcusta
  JOIN ota.bookability_contestant_attempts bconta
    ON bconta.customer_attempt_id = bcusta.id
  JOIN ota.bookability_built_contestant bbc
    ON bbc.customer_attempt_id = bcusta.id
    AND bbc.id = bconta.built_contestant_id
  LEFT JOIN ota.bookings b ON b.id = bconta.booking_id
  WHERE bcusta.date_created >= '{start_datetime}'
    AND bcusta.date_created < '{end_datetime}'
    AND bconta.gds = '{content_source}'
    /* AND bcusta.validating_carrier = 'XX' */
    /* AND bcusta.office_id = '...' */
    AND (b.is_test = 0 OR b.is_test IS NULL)
),
summary AS (
  SELECT
    COUNT(*) AS total_attempts,
    SUM(contestant_status = 0) AS total_failures,
    SUM(contestant_status = 1) AS contestant_successes,
    SUM(contestant_status = 0 AND IFNULL(contestant_error,'') <> 'payment_error') AS bookability_failures,
    SUM(contestant_status = 0 AND contestant_error = 'payment_error') AS non_bookability_failures,
    SUM(contestant_status = 1) / NULLIF(SUM(contestant_status = 1)
      + SUM(contestant_status = 0 AND IFNULL(contestant_error,'') <> 'payment_error'), 0
    ) AS contestant_bookability_success_rate
  FROM base
),
recovery AS (
  SELECT
    COUNT(DISTINCT CASE WHEN contestant_status = 0 AND customer_status = 1 THEN customer_attempt_id END)
      AS dtt_failed_customer_booked,
    COUNT(DISTINCT CASE WHEN contestant_status = 0 THEN customer_attempt_id END)
      AS dtt_failed_customer_attempts,
    COUNT(DISTINCT CASE WHEN contestant_status = 0 AND customer_status = 1 THEN customer_attempt_id END)
      / NULLIF(COUNT(DISTINCT CASE WHEN contestant_status = 0 THEN customer_attempt_id END), 0)
      AS customer_recovery_rate_after_dtt_fail
  FROM base
)
SELECT s.*, r.* FROM summary s CROSS JOIN recovery r;
```

**Error bucket (MySQL fallback — use CH as primary, see § 3):**

```sql
SELECT IFNULL(NULLIF(TRIM(contestant_error),''),'(empty)') AS err, COUNT(*) AS c
FROM base
WHERE contestant_status = 0
GROUP BY err
ORDER BY c DESC;
```

(`base` must be the same CTE as above, or repeat the `FROM … WHERE` in a single script.)

**Unique clients & NULL surfer (failures only):**

```sql
SELECT
  COUNT(DISTINCT CASE WHEN surfer_id IS NOT NULL AND surfer_id <> '' THEN surfer_id END) AS unique_surfers,
  SUM(surfer_id IS NULL OR surfer_id = '') AS failing_rows_unknown_surfer
FROM base
WHERE contestant_status = 0;
```

**Repetitive `surfer_id` (failures; ≥ 2 distinct customer attempts):**

```sql
SELECT surfer_id, COUNT(DISTINCT customer_attempt_id) AS customer_attempts
FROM base
WHERE contestant_status = 0 AND surfer_id IS NOT NULL AND surfer_id <> ''
GROUP BY surfer_id
HAVING customer_attempts >= 2
ORDER BY customer_attempts DESC;
```

**Was it finally booked?** (distinct `customer_attempt_id` with at least one contestant failure on
this content source):

```sql
SELECT
  SUM(customer_status = 1) AS finally_booked_distinct_attempts,
  SUM(customer_status = 0) AS not_booked_distinct_attempts
FROM (
  SELECT customer_attempt_id, MAX(customer_status) AS customer_status
  FROM base
  WHERE contestant_status = 0
  GROUP BY customer_attempt_id
) t;
```

`MAX(customer_status)` is correct when `customer_status` is only `0`/`1` per attempt; all rows for
one `customer_attempt_id` should share the same `bcusta.status`.

## Specific-combination spot check

When the user wants rows for a specific content source + carrier + office combination:

```sql
SELECT
    bconta.booking_id AS booking_id,
    bconta.search_hash,
    bconta.package_hash,
    bcusta.surfer_id,
    bbc.multiticket_part,          -- master(outbound) or slave(inbound)
    bc.is_original AS is_from_search,
    bconta.status AS contestant_attempt_status,
    bcusta.status AS customer_attempt_status,
    bconta.error AS contestant_error,
    bconta.exception,
    bconta.validating_carrier,
    bconta.office_id AS contestant_attempt_office_id,
    bconta.gds AS contestant_attempt_gds,
    bcusta.office_id AS customer_attempt_office_id,
    bcusta.gds AS customer_attempt_gds,
    bconta.source AS source,
    b.is_test AS is_test
FROM ota.bookability_customer_attempts bcusta
JOIN ota.bookability_contestant_attempts bconta
    ON bconta.customer_attempt_id = bcusta.id
JOIN ota.bookability_built_contestant bbc
    ON bbc.customer_attempt_id = bcusta.id
    AND bbc.id = bconta.built_contestant_id
JOIN ota.booking_contestants bc
    ON bc.id = bbc.booking_contestant_id
LEFT JOIN ota.bookings b
    ON b.id = bconta.booking_id
WHERE bcusta.date_created > NOW() - INTERVAL 1 DAY
    AND bconta.gds = '{content_source}'
    AND bcusta.validating_carrier = '{carrier}'
    AND bcusta.office_id = '{office}'
ORDER BY bcusta.date_created DESC
LIMIT 1000;
```

## Pulling Mongo evidence for the failure-causes table

The top-failure-causes table needs **verbatim supplier text plus a sample-session permalink that lands on the exact log entry** — pull both before writing the report. Canonical link shape: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>`. ResPro is shared across brands and `voyagesalacarte.ca` is the canonical ResPro host — pin this host, do **not** swap to `flighthub.com` / `justfly.com` even when the booking is on those brands. The `_id` is the Mongo document `_id` of the specific log entry containing the supplier error; without `#<_id>` the link goes to the log-group root and is not a sample session.

### Step 1 — Pull verbatim and `_id` for one anchor session per cluster

For each cluster, pick one sample `search_id` from the ClickHouse signature, then query `debug_logs` filtered to the supplier-error context for that integration. For Downtowntravel the supplier-error contexts are `Downtowntravel::BookFlight::Error` (book step), `Downtowntravel::VerifyPrice::Error` (verify step), and `loss-limit-fare-increase` (post-Sale fare-increase reversal). For other suppliers see § *Supplier-error context cheat-sheet* below.

```bash
set -a && source .env && set +a && python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id":"<sample_search_id>","context":"<SupplierError context>"}' \
  --sort '{"date_added":1}' --limit 5 --json
```

The `--json` output exposes the `_id` field as `{"$oid":"<24-char hex>"}`. Copy:
- The `Error-Data` (or `Response`) body verbatim — that's the `Supplier verbatim` column.
- The `$oid` value — that becomes the `#<_id>` fragment of the permalink.

When the cluster doesn't have a clean `*::Error` context (e.g. virtual-card cluster, where the failure is a `loss-limit-fare-increase` event firing post-Sale rather than an explicit error), pick the entry whose timing matches the failure. For the virtual-card cluster the anchor is the **second** `loss-limit-fare-increase` firing — the one immediately after the successful Payhub `Sale` and before `DeferredRefundPaidStatementItemsAction::run`. A timestamp filter or a manual scan of the `loss-limit-fare-increase` rows for that `transaction_id` gets you to the right entry.

### Step 2 — Build the permalink

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>
```

The host is fixed: ResPro is shared across brands and `voyagesalacarte.ca` is the canonical ResPro host — use it for every booking regardless of which brand the booking was made on. Same shape is documented in [`harvest_permalinks.md`](harvest_permalinks.md#permalink-url-shape).

### Mandatory: Mongo evidence for payment-side clusters

For any cluster whose CH `classification_category = 'PAYMENT_ERRORS'`, pull Mongo before deciding whether the cluster is really a payment failure. CH frequently misclassifies post-Sale fare-increase reversals (`loss-limit-fare-increase` → `DeferredRefundPaidStatementItemsAction::run` → `CancelVirtualCardPipe`) as `payment_error` because the wrapper message looks payment-shaped. The canonical example is the Downtowntravel `Virtual card merchant fare statement items failed` cluster, but the same shape can appear under `Credit Card payment declined` and other payment-shaped wrappers. When the Mongo trace shows a successful Payhub `Sale` followed by `loss-limit-fare-increase`, ship the cluster as a `CRITICAL` row in the failure-causes table with the reclassification consequence ("drops the bookability rate from X to Y") in `Supplier verbatim`.

### Supplier-error context cheat-sheet

| Supplier / step | Mongo `context` for the supplier-error entry |
|---|---|
| Downtowntravel — booking step | `Downtowntravel::BookFlight::Error` |
| Downtowntravel — price-verification step | `Downtowntravel::VerifyPrice::Error` |
| Downtowntravel — post-Sale loss-limit reversal (virtual card / fare increase) | `loss-limit-fare-increase` (pick the firing immediately after the successful Payhub `Sale`) |
| Payhub — gateway-side card decline | `payhub_api_response_Momentum\Payhub\Request\Sale` (read the `Response` body for the decline payload) |
| Amadeus | exact context lives in `db-docs/mongodb/debug_logs.md` content hints — typically `amadeus-redux-api[<carrier>]<operation>`-shaped |

When in doubt, run a single broad `find` for the anchor `transaction_id` (no context filter, `--limit 200 --sort date_added:1 --json`), grep the JSON for `Error` / `failed` / `decline` in `context`, and pick the matching entry.

For raw query mechanics (collection choice, `transaction_id` / `context` filtering, escaping literal periods in `$regex`), see [`debug_logs_query_patterns.md`](debug_logs_query_patterns.md). For permalink harvest pipelines when you need every example for a Trello card, see [`harvest_permalinks.md`](harvest_permalinks.md). For deeper correlation across a window or multiple suppliers, switch to [`deep_bookability_analysis.md`](deep_bookability_analysis.md).

Always use `ota.debug_logs` — `optimizer_logs` is repricing-only and not a bookability source.

## Header paragraph and recommended next steps

The header paragraph is one short paragraph stating the supplier, the window, and the **headline finding** — the one or two sentences that change the reader's next action. Translate internal tokens to business language (`customer_status = 1` → "customer recovered on a different supplier", `multiticket_part = 'master'` → "outbound leg"). Do **not** restate per-section outcomes — anything that would belong in a per-section bullet belongs as a row in one of the two tables.

Recommended next steps are a short numbered list of concrete follow-ups (reclassify a misclassified cluster, open / update a Trello card, escalate to a supplier liaison, establish a missing baseline). Skip the section entirely when no action is genuinely needed.

Internal "partial failure" / "complete failure" framing stays out of both the header and the tables — keep that vocabulary for the scenario notes / dump files.

## Known content-source notes

### Downtowntravel — `Similar order already exists`

The supplier message appears in `jupiter_booking_errors_v2.error_message` as `failed: Similar
order already exists` under `booking_step = 'Mv_Ota_Air_Booker_DowntownTravel->bookFlightOperation()'`
(classification: `FLIGHT_AVAILABILITY_ERRORS`). The **same** text is also in `debug_logs` on
`Downtowntravel::BookFlight` (`Response`) or `Downtowntravel::BookFlight::Error` (`Error-Data`);
pull Mongo only if you need the full payload. MySQL typically stores `flight_not_available_other`
for the same rows — that coarse code by itself is not a bookability verdict.

**Two observed patterns:**

1. **Rebooking** — customer had a **cancelled** prior DTT booking (e.g. `customer_request` /
   `aborted`) and **retries**, then hits this error.
2. **First-attempt** cases for some **`surfer_id`**s with no prior successful contestant in the
   slice — do not assume a single cause.

Correlate with **`surfer_id`** and booking timeline across **`search_hash`** values. The
`surfer_id` / retry pattern must come from MySQL — CH does not carry `surfer_id`.

**Remediation / ownership:** team treats this as **supplier-side / void–cancel semantics** until
DTT responds; follow the **Content Integration** Trello card for queries, example bookings, and
log permalinks.
