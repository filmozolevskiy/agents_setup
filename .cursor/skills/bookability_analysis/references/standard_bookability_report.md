# Standard bookability report

Default output when the user asks for bookability on a **content source** (`bconta.gds`),
**carrier**, or **office**. Always SQL-first — do NOT jump to MongoDB immediately.

The report pulls from two stores in parallel (see `SKILL.md` § *Data sources and join key*):

- **MySQL `ota.bookability_*`** — summary (§ 1), failure-facing detail (§ 2). Needs successes
  and customer-attempt grain, so CH cannot substitute here.
- **ClickHouse `jupiter.jupiter_booking_errors_v2`** — error bucket (§ 3). Primary source for the
  failure signatures (real supplier text, `booking_step`, classification); MySQL
  `bconta.error` is a coarse fallback only.

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

### 1. Summary block

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
needed).

### 2. Failure-facing details (contestant `status = 0` only)

| Metric | Definition |
|--------|------------|
| **Unique clients (`surfer_id`)** | `COUNT(DISTINCT surfer_id)` **excluding NULL**; report **Unknown / NULL `surfer_id` rows** separately (count of failing rows and distinct `customer_attempt_id` if useful). |
| **Repetitive attempts** | Among failing rows: `surfer_id IS NOT NULL` and **≥ 2 distinct `customer_attempt_id`** in the window for that `surfer_id` on this content source (same base filters). List or count those surfers; optionally show `surfer_id` + attempt counts. |
| **Was it finally booked?** | For **distinct `customer_attempt_id`** that have a failure on this content source: split **`bcusta.status = 1`** vs **`bcusta.status = 0`** (booked vs not). This pairs with **partial** vs **complete** failure language. |

### 3. Error bucket — ClickHouse primary

**Primary source:** `jupiter.jupiter_booking_errors_v2`. Carries the real supplier text
(`error_message`), the step it failed at (`booking_step`), and a classification
(`classification_category` / `classification_subcategory`, `main_group_error` /
`sub_group_error`).

Use the same `gds` value as in MySQL (`bconta.gds == jupiter_booking_errors_v2.gds`). Narrow the
time window with `timestamp`, not `date_created`.

#### § 3 output contract (mandatory)

The report body **must** contain the raw-signature table below. Presenting only the category
roll-up collapses the whole point of § 3 and is not acceptable. The raw signatures are what turn
"260 failures" into an actionable read.

Render exactly one markdown table with (at minimum) these columns, ordered by row count desc:

| # | `error_message` | `booking_step` | Category | rows | distinct `search_id` | sample `search_id` |

- `error_message` is the raw supplier / integration text — quote it verbatim, do not rewrite.
- `booking_step` pinpoints where it broke (verify vs book vs guard).
- `Category` is `classification_category` — keep it as the last / small column, never the only
  one.
- `sample search_id` is 1 value per row; pull 3 from the array when the user might want to spot
  check.

Collapse `main_group_error` / `sub_group_error` into the table only when they disagree with
`classification_category` — otherwise they are duplicates and add noise.

The category roll-up is an **optional** one-line sidecar ("FARE_INCREASES dominates, then
FLIGHT_AVAILABILITY_ERRORS…"), not a replacement for the signatures.

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

**Row-count reconciliation:** MySQL failure count (§ 1) and CH row count for the same window
should match within ingestion-lag noise — both count master and slave legs. State the two
counts side-by-side and move on unless the gap is large (then check for `is_test`, window
clock skew, or ingestion lag).

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

## Analysis narrative (after the report)

Use these framings when interpreting the numbers:

- **Partial failure:** contestant (this content source) failed but **`customer_status = 1`** —
  customer recovered on the same customer attempt (another contestant booked).
- **Complete failure (customer):** contestant failed and **`customer_status = 0`** — customer
  did not book.
- For deep dives, include example **`booking_id`** / **`search_hash`** per major error bucket.

### Offer Mongo deep dive

After the SQL + CH report, **OFFER** a MongoDB deep dive when CH's `error_message` is not enough
— e.g. the message is a generic wrapper (`Unknown error`, `failed to reprice`), you need the
raw request / response body, or you want the chronological flow for one `transaction_id`. If the
user already asked for deep analysis, skip the offer and run
[`deep_bookability_analysis.md`](deep_bookability_analysis.md) directly.

Deep dives use **`debug_logs`** (main OTA debug log for all processes). **Do not** reach for
`optimizer_logs` — that's repricing-only.

**Example offer:**

> CH shows 8 `verifyPriceOperation()` availability failures on DTT with `Failed to reprice`
> messages, two of them an `NDC-1454 SHOPPING_OFFER_NOT_SUITABLE` on TK. Want me to pull
> `debug_logs` for those `search_id`s to see the full NDC response body?

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
