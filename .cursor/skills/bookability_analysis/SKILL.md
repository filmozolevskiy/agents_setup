---
name: bookability-analysis
description: >-
  Use when analyzing bookability, investigating why a fare or booking is not bookable, 
  checking failure rates for a carrier, or addressing availability issues 
  and price changes for a specific content source, carrier, or office.
---

# Bookability Analysis

You help the Flighthub team diagnose why specific fares or bookings cannot be finalized. The investigation follows a two-stage process: first, a mandatory SQL-based overview, and then an optional MongoDB deep dive based on SQL findings.

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
Analyze the SQL results and provide initial feedback to the user **BEFORE** suggesting or performing any MongoDB deep dive.

1.  **Attempts**:
    -   What is the **Total** count of attempts?
    -   How many were **Successful** vs **Failed**?
2.  **Failure Classification**:
    -   **Non-Bookability Failures**: Identify failures due to **CC decline** or **fare increase**. These are not bookability issues.
    -   **Bookability Failures**: Categorize remaining errors (GDS errors, internal exceptions).
3.  **Success Proportion**: What is the success rate for this combination?
4.  **Customer Behavior**: Identify **repetitive attempts** from the same `surfer_id`.
5.  **Failure Nature**:
    -   **Complete Failure**: The customer failed all attempts.
    -   **Partial Failure**: The customer failed one contestant but was able to book with another contestant.
    -   **Unfulfilled customer**: The customer failed to book with different attempts.
6.  **Detailed Error Breakdown**:
    -   Group errors by type and provide counts.
    -   Include specific `booking_id`s and `search_id`s for each group.

**Note:** "flight not available" is a generic error.

### 3. Offer Deep Dive (Mandatory Feedback Step)
After presenting the SQL analysis, **OFFER** to perform a MongoDB deep dive for specific cases (e.g., "flight not available" errors or unknown exceptions).

Deep dives use the **`debug_logs`** collection first: it is the main OTA debug log for **all** processes (search through booking/ticketing and related steps). Do not assume or suggest `optimizer_logs` here—that collection is repricing-only and belongs to optimizer-specific investigations outside this skill.

**Example Output:**
> Based on the SQL analysis, we see 15 failures with "flight not available" for carrier XX. Would you like me to pull **`debug_logs`** for the matching transaction IDs / `search_hash` values to see exactly why they failed (e.g., price mismatches or availability loss)?

### 4. MongoDB Deep Dive (Only If Requested)
For specific transactions identified and requested in Step 3, query **`debug_logs`** in MongoDB. Filter by `transaction_id` using the identifier that ties the MySQL row to the OTA transaction (the same value as `search_hash` from the SQL joins).

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' \
  --sort '{"date_added": -1}' \
  --limit 1000 \
  --json
```

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
   - the **same error match** (e.g. message text, reason code, exception class—whatever uniquely identifies this failure);
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

**Querying:** Prefer an **aggregation** with `$match` on `date_added` + signature (then `$count` or `$group`). Plain `scripts/mongo_query.py` takes JSON without BSON constructors—if you cannot express `ISODate` in the pipeline from the shell, use **mongosh**, **MongoDB Compass**, or another client for the time-bounded count, *or* match on highly selective string fields (`source`, exact message path) and enforce the time window by inspecting `date_added` on the returned documents when counts must be approximate.

#### Reporting MongoDB findings
For **each** claim you make from MongoDB, **include a permalink** so others can open the exact document:

- **URL pattern:** `https://reservations.voyagesalacarte.ca/debug-logs/log-group/{search_hash}#{object_id}`
- **`search_hash`:** same value you used as `transaction_id` for that investigation when it aligns with the storefront/search transaction (as in MySQL).
- **`object_id`:** the document’s `_id` as a **24-character hex string** (from `--json` output, without `$oid` wrappers in the final link).

**Lead with supplier evidence:** when you assert what the content source did (rejection reason, error code, policy), **link first** to the **request/response** (or raw traffic) document. Link **local exception** documents **additionally** when they clarify where in our stack the failure surfaced.

**Examples**

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877
```

- `95769b38d7b00fc0522d49494fbe94cc` — `search_hash` / transaction key  
- `69d55ccec06bf5c3bd021877` — MongoDB `ObjectId` for the **supplier-side** log (preferred anchor for conclusions)  

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021878
```

- `69d55ccec06bf5c3bd021878` — MongoDB `ObjectId` for a **local exception** log (supporting; use for patterns and stack context)

Refer to Step 3 and 4 in the base workflow for detailed log analysis (price mismatches, availability loss, etc.).
