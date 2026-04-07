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
    AND bcusta.source = '{content_source}'
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

**Example Output:**
> Based on the SQL analysis, we see 15 failures with "flight not available" for carrier XX. Would you like me to dive into MongoDB logs for some of these `search_hash`es to see exactly why they failed (e.g., price mismatches or availability loss)?

### 4. MongoDB Deep Dive (Only If Requested)
For specific `search_hash`s identified and requested in Step 3, fetch the detailed `debug_logs` from MongoDB.

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find optimizer_logs ota --filter '{"transaction_id": "YOUR_SEARCH_HASH"}' --json
```

Refer to Step 3 and 4 in the base workflow for detailed log analysis (price mismatches, availability loss, etc.).
