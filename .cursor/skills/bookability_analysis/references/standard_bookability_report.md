# Standard bookability report

Default output when the user asks for bookability on a **content source** (`bconta.gds`),
**carrier**, or **office**. Always SQL-first — do NOT jump to MongoDB immediately.

After presenting this report, **offer** a Mongo deep dive (see
[`deep_bookability_analysis.md`](deep_bookability_analysis.md)) for cases where a supplier truth
is likely hiding under a generic code like `flight_not_available_other`.

## Shared base filters (use these everywhere)

Every metric in the report must come from the same row set:

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` → `bookability_built_contestant`
  (see template below).
- `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- **Production only:** `(b.is_test = 0 OR b.is_test IS NULL)` unless the user asks for tests.
- **Avoid multiticket double-count:** `(bbc.multiticket_part = 'master' OR bbc.multiticket_part IS NULL)`
  unless the question is explicitly about slave legs.
- **Time window:** bound `bcusta.date_created` (indexed) — never scan the full table.
- **Contestant outcome:** `bconta.status = 1` success, `bconta.status = 0` failure.
- **Customer outcome:** `bcusta.status = 1` customer booked, `bcusta.status = 0` did not.

## Report shape (mandatory)

### 1. Summary block

| Metric | Definition |
|--------|------------|
| **Total attempts** | Row count of the base set (one row per DTT/contestant attempt after multiticket filter). |
| **Total failures** | Rows where `bconta.status = 0`. |
| **Contestant bookability success rate (excl. non-bookability)** | `successes / (successes + bookability_failures)` where **bookability failures** are contestant failures whose `bconta.error` is **not** in the non-bookability error list (see SKILL.md). NULL/empty error counts as bookability-side unknown until classified. **Non-bookability failures are excluded from numerator and denominator.** **`loss_limit_fare_increase` is a bookability failure** (included in the rate). |
| **Customer recovery rate after DTT failed** | Among **distinct `customer_attempt_id`** with **at least one** failing DTT contestant row (`bconta.status = 0`), the fraction where **`bcusta.status = 1`** (customer ultimately booked—typically another contestant). Formula: `COUNT(DISTINCT CASE WHEN contestant_failed AND customer_ok THEN ca_id END) / COUNT(DISTINCT CASE WHEN contestant_failed THEN ca_id END)`. |

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
| **Was it finally booked?** | For **distinct `customer_attempt_id`** that have a DTT failure: split **`bcusta.status = 1`** vs **`bcusta.status = 0`** (booked vs not). This pairs with **partial** vs **complete** failure language. |

### 3. Error bucket

- Table (or bullets) of **`bconta.error`** × **count** for **contestant failures** (`status = 0`),
  sorted descending.
- Call out **`flight_not_available_other`** and other generics: supplier truth may live in
  **`debug_logs`** (see the Downtowntravel note at the end of this file).

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
    AND (bbc.multiticket_part = 'master' OR bbc.multiticket_part IS NULL)
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

**Error bucket** (failures only):

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

- **Partial failure:** DTT contestant failed but **`customer_status = 1`** — customer recovered on
  the same customer attempt (another contestant booked).
- **Complete failure (customer):** DTT failed and **`customer_status = 0`** — customer did not book.
- For deep dives, include example **`booking_id`** / **`search_hash`** per major error bucket.

### Offer Mongo deep dive

After the SQL report, **OFFER** a MongoDB deep dive for specific cases (e.g. "flight not available"
errors, unknown exceptions). If the user already asked for deep analysis, skip the offer and run
[`deep_bookability_analysis.md`](deep_bookability_analysis.md) directly.

Deep dives use **`debug_logs`** (main OTA debug log for all processes). **Do not** reach for
`optimizer_logs` — that's repricing-only.

**Example offer:**

> Based on the SQL analysis, we see 15 failures with "flight not available" for carrier XX. Would
> you like me to pull **`debug_logs`** for the matching transaction IDs / `search_hash` values to
> see exactly why they failed (e.g. price mismatches or availability loss)?

## Known content-source notes

### Downtowntravel — `Similar order already exists`

The supplier message appears in **`debug_logs`** on **`Downtowntravel::BookFlight`** (e.g.
**`Response`**) or **`Downtowntravel::BookFlight::Error`** (**`Error-Data`**: `failed: Similar
order already exists`). **MySQL** often stores **`flight_not_available_other`** for the same
attempts — always **confirm the real text in Mongo** before classifying.

**Two observed patterns:**

1. **Rebooking** — customer had a **cancelled** prior DTT booking (e.g. `customer_request` /
   `aborted`) and **retries**, then hits this error.
2. **First-attempt** cases for some **`surfer_id`**s with no prior successful contestant in the
   slice — do not assume a single cause.

Correlate with **`surfer_id`** and booking timeline across **`search_hash`** values.

**Remediation / ownership:** team treats this as **supplier-side / void–cancel semantics** until
DTT responds; follow the **Content Integration** Trello card for queries, example bookings, and
log permalinks.
