---
name: bookability-analysis
description: >-
  Use when analyzing bookability, investigating why a fare or booking is not bookable,
  checking failure rates for a carrier, or addressing availability issues
  and price changes for a specific content source, carrier, or office.
  Use for deep bookability analysis: MySQL search_hash → MongoDB debug_logs, payment vs supplier
  attribution, and similar-errors reports.
  Use for single-booking investigation: trace the full flow (checkout, availability, booking, ticketing)
  for a given booking_id or search_hash to understand what went wrong.
---

# Bookability Analysis

You help the Flighthub team diagnose why specific fares or bookings cannot be finalized. The investigation follows a two-stage process: first, a mandatory SQL-based overview, and then an optional MongoDB deep dive based on SQL findings.

**System context:** Before heavy log or cross-service digging, read **`db-docs/mongodb/debug_logs.md`** (investigation sections + glossary + content-source hints; see **MongoDB rule** for query filters). Update that doc when you confirm durable observability facts.

### Single-booking flow investigation (explicit request)

When the user provides a **`booking_id`** or **`search_hash`** and asks to "understand the flow" or "what went wrong for this booking", perform a comprehensive trace across MongoDB `debug_logs`.

**Goal:** Provide a chronological narrative of the booking's lifecycle, identifying the exact point and reason for failure.

**Workflow**

1. **Resolve IDs:** If only `booking_id` is provided, query MySQL to find the corresponding `search_hash` (used as `transaction_id` in Mongo).
   ```sql
   SELECT search_hash FROM ota.bookability_contestant_attempts WHERE booking_id = 'YOUR_BOOKING_ID' LIMIT 1;
   -- OR if not found there, check bookings table
   SELECT debug_transaction_id FROM ota.bookings WHERE id = 'YOUR_BOOKING_ID';
   ```
2. **Fetch Full Timeline:** Query `ota.debug_logs` for the `transaction_id`. Do **not** filter by `context` initially to see the full picture.
   ```bash
   python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id": "YOUR_HASH"}' --sort '{"date_added": 1}' --limit 2000 --json
   ```
3. **Identify Key Stages:** Use the markers in `db-docs/mongodb/debug_logs.md` to segment the logs:
   - **Checkout**: `checkout-deeplink`, `pre-checkout`.
   - **Availability**: `Check Availability` scope.
   - **Optimization**: `Optimization` scope.
   - **Payment**: `payhub_api_request_...`, `Verify`, `ThreeDs`, `Sale`.
   - **Booking**: `Booking flow` scope, `pre-air-booker`, `post-air-booker`.
   - **Ticketing**: `Ticketer` scope, `AirTicketRQ`.
   - **Failure/Cleanup**: `CancelProcessor` scope, `CancelCard`.
4. **Analyze Failures:**
   - Look for `level: "error"` or `level: "critical"`.
   - Inspect `Response` payloads from suppliers/GDS for raw error messages.
   - Check Payhub responses for payment declines or 3DS issues.
5. **Report Findings:**
   - **Summary**: One-sentence verdict (e.g., "Failed at booking stage due to GDS price increase").
   - **Timeline**: Bulleted list of key events with timestamps and `context`.
   - **Root Cause**: Detailed explanation of the failure, including the raw supplier/processor message and a permalink to the log document.

### Deep bookability analysis (explicit request)

When the user asks for a **deep bookability analysis** (or equivalent: “correlate logs”, “why did we really fail”, “supplier truth for failures”), go beyond MySQL `contestant_error` alone. **Goal:** attribute failures correctly to **(A) non-bookability** (payment path: card decline, `payment_error`, Payhub/charge failures) vs **(B) bookability / supplier-side** (availability, sold-out, fare change, GDS/supplier codes, policy)—and produce a **similar-errors report** (grouped signatures with counts and examples).

**Principles**

1. **Do not treat MySQL `contestant_error` as final truth** for deep analysis. Generic codes (e.g. `flight_not_available_other`) often hide the real supplier message; **confirm in `debug_logs`**.
2. **Scope “bookability” vs “non-bookability”** consistently with [Non-bookability errors](#non-bookability-errors-contestant-error-field): payment/CC-side outcomes are **non-bookability**; availability and supplier rejection of the itinerary/fare are **bookability**. After Mongo review, **reclassify** a row if logs show payment failure while SQL showed a generic code (or the reverse).
3. **`search_hash` is the join key:** MySQL `bookability_contestant_attempts.search_hash` → Mongo **`debug_logs.transaction_id`**. Rows with **NULL or empty `search_hash`** cannot be correlated; list them separately and do not pretend they were log-verified.

**Workflow (always in this order)**

1. **MySQL — same base filters as the standard report** (date window, `gds`, production, multiticket rule). Select **contestant failures only** (`bconta.status = 0`) and output at least: `search_hash`, `contestant_error`, `customer_attempt_id`, `booking_id`, `surfer_id`, `bcusta.date_created`. Use **`DISTINCT` or one row per failing contestant attempt** as appropriate so each failure is traceable.
2. **Drop unusable keys:** exclude `search_hash` IS NULL or `''` from the Mongo pass; report how many failures had no hash.
3. **MongoDB — `ota.debug_logs`:** For the content source under investigation, query by **`transaction_id`** using the hashes from step 1. Prefer **batches** with `$in` on `transaction_id` (keep each batch modest, e.g. 25–100 hashes, to stay under `--limit` and readable). **Always** narrow by that supplier’s **`context`** (exact string when known, else case-insensitive `$regex` on the integration name—see `.cursor/rules/mongodb.md`). Sort by `date_added` for timeline; use `--json` for permalinks.
4. **Read supplier evidence first:** For each `transaction_id`, identify log lines with **raw request/response** (e.g. `Response`, wire payload) for the book path; use local exceptions only as supporting context.
5. **Similar-errors report (mandatory output for deep analysis):** Group failures by a **stable signature**:
   - **Primary:** normalized supplier message or code from **`Response`** / payload (or structured field), **not** only MySQL `contestant_error`.
   - **Secondary:** MySQL `contestant_error` when it aligns with Mongo (or flag **“SQL vs Mongo mismatch”** when they diverge).
   - For **each group:** **count**, **1–3 example `search_hash`**, and **at least one permalink** to the **supplier-side** log document where possible (pattern from [Reporting MongoDB findings](#reporting-mongodb-findings)).
   - Call out groups that are **purely payment/CC** vs **availability / GDS / fare** so the narrative does not mix causes.

**SQL: failure rows with `search_hash` for Mongo correlation**

Use the same `base` CTE as [SQL: standard metrics](#sql-standard-metrics-template). Then:

```sql
SELECT
  bconta.search_hash,
  bconta.error AS contestant_error,
  bcusta.id AS customer_attempt_id,
  bconta.booking_id,
  bcusta.surfer_id,
  bcusta.date_created
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
  AND (b.is_test = 0 OR b.is_test IS NULL)
  AND (bbc.multiticket_part = 'master' OR bbc.multiticket_part IS NULL)
  AND bconta.status = 0
  AND bconta.search_hash IS NOT NULL
  AND bconta.search_hash <> ''
ORDER BY bcusta.date_created DESC;
```

**MongoDB: batch `transaction_id` (`$in`)**

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": {"$in": ["HASH1", "HASH2"]}, "context": {"$regex": "SupplierName", "$options": "i"}}' \
  --sort '{"date_added": -1}' \
  --limit 500 \
  --json
```

Replace `SupplierName` with the integration substring for `{content_source}`; use **exact `context`** when documented in `db-docs/mongodb/debug_logs.md` (content hints) or prior art.

Single-transaction spot-check (same as before):

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": "YOUR_SEARCH_HASH"}' \
  --sort '{"date_added": -1}' \
  --limit 1000 \
  --json
```

**Optional:** If the user cares only about **supplier bookability** failures for the similar-errors report, still pull Mongo for **all** contestant failures in scope first, then **exclude** groups that are clearly payment-only when building the “bookability” summary table—do not exclude them silently; state what was excluded and why.

## Workflow

### 1. MySQL Analysis (Mandatory Initial Investigation)
When asked to analyze bookability for a **content source**, **carrier**, or **office**, **ALWAYS** start by querying the MySQL `ota` database. Do NOT dive into MongoDB logs immediately.

**Key Data Points:**
- `surfer_id`: Unique user identifier.
- `multiticket_part`: `master` (outbound), `slave` (inbound), or `NULL`.
- `is_from_search`: `1` (from search), `0` (optimized).
- `contestant_attempt_status`: Success/failure of specific content source attempt.
* `customer_attempt_status`: Final result for the user's booking request.
- `contestant_error`: GDS error code or message.
- `exception`: Internal side exception.
- `is_test`: `1` = test booking (either `source` like '%staging%' or `is_test = 1`).
- `search_hash` & `package_hash`: Identifying hashes for the search result.

**Note:** Contestant attempts represent our tries with different content sources, while customer attempts represent what the customer ends up with.

## Standard bookability report (mandatory output shape)

When reporting bookability for a **content source** (e.g. `bconta.gds`), **carrier**, or **office**, structure the MySQL findings **in this order**. Use the **same base row set** everywhere:

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` → `bookability_built_contestant` as in the template query below.
- `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- **Production only:** `(b.is_test = 0 OR b.is_test IS NULL)` unless the user asks for tests.
- **Avoid multiticket double-count:** `(bbc.multiticket_part = 'master' OR bbc.multiticket_part IS NULL)` unless the question is explicitly about slave legs.
- **Time window:** bound `bcusta.date_created` (indexed); never scan the full table.
- **Contestant outcome:** `bconta.status = 1` ⇒ contestant success, `bconta.status = 0` ⇒ contestant failure (confirm in your environment if new values appear).
- **Customer outcome:** `bcusta.status = 1` ⇒ customer booking succeeded for that attempt, `bcusta.status = 0` ⇒ did not.

### 1. Summary block

| Metric | Definition |
|--------|------------|
| **Total attempts** | Row count of the base set (one row per DTT/contestant attempt after multiticket filter). |
| **Total failures** | Rows where `bconta.status = 0`. |
| **Contestant bookability success rate (excl. non-bookability)** | `successes / (successes + bookability_failures)` where **bookability failures** are contestant failures whose `bconta.error` is **not** in the [non-bookability error list](#non-bookability-errors-contestant-error-field) (NULL/empty error counts as bookability-side unknown until classified). **Non-bookability failures are excluded from numerator and denominator.** **`loss_limit_fare_increase` is a bookability failure** (included in the rate). |
| **Customer recovery rate after DTT failed** | Among **distinct `customer_attempt_id`** with **at least one** failing DTT contestant row (`bconta.status = 0`), the fraction where **`bcusta.status = 1`** (customer ultimately booked—typically another contestant). Formula: `COUNT(DISTINCT CASE WHEN contestant_failed AND customer_ok THEN ca_id END) / COUNT(DISTINCT CASE WHEN contestant_failed THEN ca_id END)`. |

Report the recovery rate as a **percentage** and **counts** (e.g. “72 / 153 = 47%”).

For **multiple calendar days** (e.g. today vs yesterday), either run the same template **once per day** (`WHERE bcusta.date_created >= … AND < …`) or add `DATE(bcusta.date_created) AS report_day` to the `base` CTE and `GROUP BY report_day` for each metric (use `COUNT(DISTINCT …)` forms where needed).

### 2. Failure-facing details (contestant `status = 0` only)

| Metric | Definition |
|--------|------------|
| **Unique clients (`surfer_id`)** | `COUNT(DISTINCT surfer_id)` **excluding NULL**; report **Unknown / NULL `surfer_id` rows** separately (count of failing rows and distinct `customer_attempt_id` if useful). |
| **Repetitive attempts** | Among failing rows: `surfer_id IS NOT NULL` and **≥ 2 distinct `customer_attempt_id`** in the window for that `surfer_id` on this content source (same base filters). List or count those surfers; optionally show `surfer_id` + attempt counts. |
| **Was it finally booked?** | For **distinct `customer_attempt_id`** that have a DTT failure: split **`bcusta.status = 1`** vs **`bcusta.status = 0`** (booked vs not). This pairs with **partial** vs **complete** failure language. |

### 3. Error bucket

- Table (or bullets) of **`bconta.error`** × **count** for **contestant failures** (`status = 0`), sorted descending.
- Call out **`flight_not_available_other`** and other generics: supplier truth may live in **`debug_logs`** (see Downtowntravel note below).

### Non-bookability errors (`contestant` error field)

Use this list for the **contestant bookability success rate** denominator adjustment: these codes are **excluded** from both numerator and denominator (they are not “supplier said no” bookability). **Extend** as you learn stable codes:

- `payment_error` — payment / card path (card decline, charge failures, Payhub-side outcomes surfaced here).

**Bookability side:** all other contestant failures count toward bookability, including **`loss_limit_fare_increase`** (fare / limit / repricing during book).

**Deep bookability analysis:** After Mongo review, if logs show **payment/CC** but SQL did not use `payment_error`, note the **reclassification** in the similar-errors report. If SQL shows `payment_error` but logs show a **supplier rejection**, flag **SQL vs Mongo mismatch** and prioritize **supplier evidence** for the root-cause narrative.

If the user cares about a different split, state the list used in the report.

### SQL: standard metrics (template)

Replace date range, `gds` (`{content_source}`), and optional `validating_carrier` / `office_id` filters.

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

**Was it finally booked?** (distinct `customer_attempt_id` with at least one contestant failure on this content source):

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

`MAX(customer_status)` is correct when `customer_status` is only `0`/`1` per attempt; all rows for one `customer_attempt_id` should share the same `bcusta.status`.

**Query Guidance:**
- **Always** filter by a recent `date_created` range in `bookability_customer_attempts` to avoid full scans.
- Filter out test bookings (`is_test = 0`) unless requested.
- If analyzing a specific combination:

```sql
SELECT
    bconta.booking_id as booking_id,
    bconta.search_hash,
    bconta.package_hash,
    bcusta.surfer_id, -- unique key for each customer
    bbc.multiticket_part, -- master(outbound) or slave(inbound)
    bc.is_original as is_from_search,
    bconta.status as contestant_attempt_status, -- did contestant attempt succeed
    bcusta.status as customer_attempt_status, -- did customer attempt succeed
    bconta.error as contestant_error,
    bconta.exception,
    bconta.validating_carrier,

    /*
        contestant attempt - our tries with different content sources
        customer attempt - what customer ends up with
    */
    bconta.office_id as contestant_attempt_office_id,
    bconta.gds as contestant_attempt_gds,
    bcusta.office_id as customer_attempt_office_id,
    bcusta.gds as customer_attempt_gds,

    /*  source like '%staging%' or is_test = 1 means test booking*/
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
WHERE 
    bcusta.date_created > NOW() - INTERVAL 1 DAY
    AND bconta.gds  = '{content_source}'
    AND bcusta.validating_carrier = '{carrier}'
    AND bcusta.office_id = '{office}'
ORDER BY bcusta.date_created DESC
LIMIT 1000;
```

### 2. Analysis & SQL Feedback (Mandatory)
Present findings using the **[Standard bookability report](#standard-bookability-report-mandatory-output-shape)** layout (summary, failure details, error bucket) **BEFORE** suggesting or performing any MongoDB deep dive.

Additional narrative (as needed):

- **Partial failure:** DTT contestant failed but **`customer_status = 1`** (recovered elsewhere on the same customer attempt).
- **Complete failure (customer):** DTT failed and **`customer_status = 0`**.
- For deep dives, include example **`booking_id`** / **`search_hash`** per major error bucket.

**Note:** "flight not available" is a generic error.

**Downtowntravel — `Similar order already exists` (aligned with CI board investigation):** The supplier message appears in **`debug_logs`** on **`Downtowntravel::BookFlight`** (e.g. **`Response`**) or **`Downtowntravel::BookFlight::Error`** (**`Error-Data`**: `failed: Similar order already exists`). **MySQL** often stores **`flight_not_available_other`** for the same attempts—always **confirm the real text in Mongo** before classifying. **Two observed patterns:** (1) **Rebooking**—customer had a **cancelled** prior DTT booking (e.g. `customer_request`/`aborted`) and **retries** then hit this error; (2) **First-attempt** cases for some **`surfer_id`**s with no prior successful contestant in the slice—do not assume a single cause. Correlate with **`surfer_id`** and booking timeline across **`search_hash`** values. **Remediation / ownership:** team treats this as **supplier-side / void–cancel semantics** until DTT responds; follow the **Content Integration** Trello card for queries, example bookings, and log permalinks.

### 3. Offer Deep Dive (Mandatory Feedback Step)
After presenting the SQL analysis, **OFFER** to perform a MongoDB deep dive for specific cases (e.g., "flight not available" errors or unknown exceptions). If the user already asked for a **[deep bookability analysis](#deep-bookability-analysis-explicit-request)**, **skip the offer** and execute that workflow (MySQL `search_hash` list → `debug_logs` by `transaction_id` → **similar-errors report**).

Deep dives use the **`debug_logs`** collection first: it is the main OTA debug log for **all** processes (search through booking/ticketing and related steps). Do not assume or suggest `optimizer_logs` here—that collection is repricing-only and belongs to optimizer-specific investigations outside this skill.

**Example Output:**
> Based on the SQL analysis, we see 15 failures with "flight not available" for carrier XX. Would you like me to pull **`debug_logs`** for the matching transaction IDs / `search_hash` values to see exactly why they failed (e.g., price mismatches or availability loss)?

### 4. MongoDB Deep Dive (Only If Requested)
For specific transactions identified and requested in Step 3, query **`debug_logs`** in MongoDB. Filter by `transaction_id` using the identifier that ties the MySQL row to the OTA transaction (the same value as `search_hash` from the SQL joins).

For **many failures** (deep bookability analysis), use **`$in`** on `transaction_id` with content-source **`context`** narrowing—see [Deep bookability analysis](#deep-bookability-analysis-explicit-request).

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' \
  --sort '{"date_added": -1}' \
  --limit 1000 \
  --json
```

#### Effective queries on debug_logs
Use patterns that stay **index-friendly** and match **where the text actually lives**:

1. **Time first:** always bound **`date_added`** (`$gte` / `$lte` or `$lt`) for prevalence and ad hoc pulls on large collections.
2. **Exact `context` when known:** use **equality** (e.g. `"context": "Downtowntravel::BookFlight"`). **Do not use `$regex` on `context`** if you have the full string—regex on `context` is slower and can mask typos.
3. **Supplier text field:** for DTT book flows, the supplier-visible body is often in top-level **`Response`**. Prefer **`$match` on `Response` + `$regex`** (or substring match) together with exact `context` over **`$expr` / `$concat` / stringified `meta`** for first-pass counts—the latter is slower, can **error** if any stitched field is non-string, and misses text that only appears in `Response`.
4. **Regex hygiene:** when the phrase includes literal periods (e.g. `unique. Please`), **escape** `.` in the pattern (`unique\.`) unless you intentionally want “any character.”
5. **Counts:** reuse the same filter as a single `$match` (or `countDocuments`) and add `{ "$count": "n" }` in aggregation.
6. **Tools:** `scripts/mongo_query.py` takes **JSON only**—no `ISODate(...)` in the pipeline string. For date-bounded aggregations, use **mongosh**, **MongoDB Compass**, or a **small Python** script with `pymongo` + `datetime` after `source .env` (same env vars as the CLI).

**Example shape (Downtowntravel book response message — adjust dates and regex):**

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: {
        $regex: "Passenger names must be unique\\. Please add middle names or titles\\.",
        $options: "i"
      },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  { $count: "n" }
]
```

Use the same `$match` for `find`/`aggregate` pipelines that **`$project`** permalinks (`transaction_id`, `$toString` of `_id`) for sharing.

#### Aggregation: harvest debug log permalinks (mongosh / Compass)

For **prevalence + shareable links** in one shot, use an aggregation on **`ota.debug_logs`** with:

1. **`$match`:** exact **`context`** where possible, **`date_added`** bounds (`$gte` / `$lte` or `$lt`), and supplier text on **`Response`** via **`$regex`** (not on `context`).
2. **`$project`:** `transaction_id`, `log_id` = `$toString` of `$_id`, and **`link`** = `https://reservations.voyagesalacarte.ca/debug-logs/log-group/` + `transaction_id` + `#` + `$toString` of `$_id`.

Run in **mongosh**, **Compass**, or **Python + pymongo** with real `datetime` values. `scripts/mongo_query.py aggregate` does **not** accept `ISODate(...)` inside JSON pipelines—use those tools for date-bounded harvests.

**When pasting into Trello (Content Integration) or similar tickets:** use the same layout as **`trello_content_integration`** — for **each** distinct error signature, a block with: title line `**CODE — label — example: debug log**`, then **`some examples`** and **one permalink per line**, then **`mongo_query:`** and a **full** copy of the harvest pipeline below (swap only **`$match`**). Reference: [#2677 DTT: VerifyPrice errors](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors). Single-signature investigations still use **`some examples`** + **`mongo_query:`** after optional **Scale**. Put measured prevalence in **Scale** only; **do not** add post-query runbook lines after **`mongo_query:`** (e.g. how to `$count` or dedupe by `transaction_id`)—that is disallowed on CI cards per **`trello_content_integration`**.

**Full harvest (all matching log lines → one array of links)** — adjust the **`$match`** regex and calendar window:

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: {
        $regex: "INVALID_AGE_FOR_PAX_TYPE",
        $options: "i"
      },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  {
    $project: {
      _id: 0,
      transaction_id: 1,
      date_added: 1,
      log_id: { $toString: "$_id" },
      link: {
        $concat: [
          "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
          "$transaction_id",
          "#",
          { $toString: "$_id" }
        ]
      }
    }
  },
  { $sort: { date_added: -1 } },
  {
    $group: {
      _id: null,
      links: { $push: "$link" }
    }
  },
  { $project: { _id: 0, links: 1 } }
]
```

**Tighter supplier signature** (e.g. NDC-1348 + age/PTC): set `Response.$regex` to something like `NDC-1348.*INVALID_AGE_FOR_PAX_TYPE` (escape dots in literal phrases when needed).

**One row per `transaction_id`** (better for Trello / email when retries inflate line count): reuse the same `$match`, then sort, project `link`, group:

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  { $sort: { date_added: -1 } },
  {
    $project: {
      transaction_id: 1,
      date_added: 1,
      link: {
        $concat: [
          "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
          "$transaction_id",
          "#",
          { $toString: "$_id" }
        ]
      }
    }
  },
  {
    $group: {
      _id: "$transaction_id",
      link: { $first: "$link" },
      last_seen: { $max: "$date_added" }
    }
  },
  { $sort: { last_seen: -1 } }
]
```

**Counts only:** same initial `$match`, then `{ $count: "n" }` instead of `$project` / `$group`.

#### Source of truth: supplier traffic vs local exceptions
Documents are not equal. **Prioritize entries that store raw request/response (or equivalent wire payload) with the external content source**—that is what the GDS or supplier actually saw and returned.

- **Prefer for final conclusions:** logs that contain **outbound requests and inbound responses** (or parsed mirror fields) for the path under investigation. Base **root-cause statements** and **customer-facing explanations** on that supplier-visible evidence.
- **Use exceptions and errors as a map, not the verdict:** local application logs (exceptions, stack traces, generic wrappers, internal `"reason": "failed"` handlers) are excellent for **spotting failures** and **building patterns**, **chronological correlation**, and **clustering**—but they are **not** the source of truth about supplier behavior if a nearby document holds the real response body.
- **Reading order:** once you pick a `transaction_id` and content source, follow the timeline; when both exist, **read the supplier request/response document first**, then the local exception that may wrap or summarize it.

**Examples (same `search_hash`, different `_id`):**

| Role | Permalink |
|------|-----------|
| **External content source** (raw traffic—prefer for conclusions) | [log `…#69d55ccec06bf5c3bd021877`](https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877) |
| **Local exception** (patterns / context—supporting) | [log `…#69d55ccec06bf5c3bd021878`](https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021878) |

#### How to read `debug_logs` for bookability
- **One transaction, many content sources:** `debug_logs` interleaves activity for **multiple** content sources / contestants under the same `transaction_id`. Match the **content source under investigation** (the same GDS or integration you filtered on in MySQL, e.g. `bconta.gds`). Use `source`, `context`, `meta`, and message or stack-trace text to **keep only lines that belong to that path**; **ignore** log lines from other suppliers or contestants so conclusions are not polluted by unrelated failures.
- **Many `search_hash` values:** Treat each deep dive as building a **hypothesis** (e.g. generic “flight not available” is actually `Downtowntravel::BookFlight` throwing X). After you identify that signature on one transaction, **spot-check additional `search_hash`s** from the same failure bucket to see whether the **same pattern** repeats. Prefer confirming with a small, representative sample rather than assuming one log explains every row.

#### Frequency / prevalence (after a clear root cause)
When a log exposes a **specific, repeatable failure** (structured payload, stable message, distinct class or supplier code), **do not treat a single permalink as sufficient**. Estimate how often that signature appears in production.

1. **Anchor the signature** from the document you already inspected (field paths may be under `meta`, top-level, or nested—copy the exact shape you matched on disk). Prefer fields visible in **supplier request/response** payloads for prevalence; use **exception-only** text when raw traffic is missing from the window or collection.
2. **Query `debug_logs` over longer windows**, typically **the past 7 days** and **the past 30 days** (adjust if the question is seasonal or incident-scoped). Combine:
   - a **time bound** on `date_added` (`$gte` / `$lte`) so the scan stays purposeful and index-friendly;
   - the **same error match** on the **field that holds supplier text** when applicable (e.g. **`Response`** for DTT `BookFlight`), otherwise `message`, `stack_trace`, or nested paths—see [Effective queries on debug_logs](#effective-queries-on-debug_logs);
   - **exact `context`** (and other equality filters) where possible—do not regex `context` when the full value is known;
   - the **same content source** when fields like `source` or related `meta` allow—do not lump other GDS paths into the count.
3. **Report counts** (exact `$count` / grouped counts by day or by source if useful) and a **small set of extra permalinks** if you need to prove the pattern is widespread—not only the first hit.
4. **`debug_logs` is a capped collection.** Very old events may already have been rotated out; say so if the window returns thin data despite a large expected volume.

**Illustrative example:** one log might show a payload equivalent to:

```json
{
  "message": "Similar order already exists",
  "reason": "failed"
}
```

Map those fields to the real document paths in Mongo, then search for sibling documents with the same values over 7d / 30d. The concrete row that surfaced it might be:

[https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877](https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877)

**Querying:** Prefer an **aggregation** with `$match` on **`date_added`** + **exact `context`** (when known) + **signature field** (e.g. `Response` regex)—then `$count` or `$group`. See [Effective queries on debug_logs](#effective-queries-on-debug_logs). Plain `scripts/mongo_query.py` takes JSON without BSON dates; use **mongosh**, **Compass**, or **Python + pymongo** for `ISODate`-bounded pipelines.

#### Reporting MongoDB findings
For **each** claim you make from MongoDB, **include a permalink** so others can open the exact document:

- **URL pattern:** `https://reservations.voyagesalacarte.ca/debug-logs/log-group/{search_hash}#{object_id}`
- **`search_hash`:** same value you used as `transaction_id` for that investigation when it aligns with the storefront/search transaction (as in MySQL).
- **`object_id`:** the document’s `_id` as a **24-character hex string** (from `--json` output, without `$oid` wrappers in the final link).

**Lead with supplier evidence:** when you assert what the content source did (rejection reason, error code, policy), **link first** to the **request/response** (or raw traffic) document. Link **local exception** documents **additionally** when they clarify where in our stack the failure surfaced.

**Example layout (chat, docs, or Trello `Numbers/ Examples`):** mirror the CI board style — **`some examples`** on its own line, then **full permalinks** (one per line), then **`mongo_query:`** and the [permalink-harvest aggregation](#aggregation-harvest-debug-log-permalinks-mongosh--compass) with the right **`$match`**. For **multiple** `Response` patterns, repeat the block per signature (see [#2677](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors)).

**some examples**

https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877

- `95769b38d7b00fc0522d49494fbe94cc` — `search_hash` / transaction key  
- `69d55ccec06bf5c3bd021877` — MongoDB `ObjectId` for the **supplier-side** log (preferred anchor for conclusions)  

https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021878

- `69d55ccec06bf5c3bd021878` — MongoDB `ObjectId` for a **local exception** log (supporting; use for patterns and stack context)

Refer to Step 3 and 4 in the base workflow for detailed log analysis (price mismatches, availability loss, etc.).
