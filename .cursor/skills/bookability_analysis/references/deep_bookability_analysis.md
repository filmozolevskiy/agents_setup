# Deep bookability analysis

Use when the user asks for a **deep bookability analysis** or equivalent ("correlate logs", "why
did we really fail", "supplier truth for failures", "similar-errors report").

**Goal:** attribute failures correctly to:

- **(A) Non-bookability** — payment path: card decline, `payment_error` / `PAYMENT_ERRORS`,
  Payhub / charge failures.
- **(B) Bookability / supplier-side** — availability, sold-out, fare change, GDS / supplier
  codes, policy.

Then produce a **similar-errors report** — grouped signatures with counts and examples.

## Principles

1. **CH `jupiter_booking_errors_v2` is the primary signature source.** It already carries the
   raw `error_message`, `booking_step`, `main_group_error` / `sub_group_error`, and a
   classification. Use it to group failures and generate the `search_id` list; use MySQL
   `bconta.error` only when CH is empty for the window or when a particular row is missing from
   CH (ingestion lag).
2. **Use Mongo `debug_logs` when CH is not enough:** generic wrappers (`Unknown error`, `failed
   to reprice`), truncated payloads, chronological correlation across a single `transaction_id`,
   or fields CH does not capture (full NDC response body, 3DS flow, Payhub request JSON).
3. **Scope "bookability" vs "non-bookability"** consistently with `SKILL.md` § *Error
   classification mapping* (bookability-rate lens). Only `PAYMENT_ERRORS` / `payment_error` is
   excluded. Reclassify a row if CH and MySQL disagree — supplier evidence wins.
4. **One join key in three shapes:** `jupiter_booking_errors_v2.search_id` =
   `bookability_contestant_attempts.search_hash` = `debug_logs.transaction_id`. Rows with
   **NULL or empty `search_hash`** cannot be correlated; list them separately (see step 2).
5. **MySQL is still required** for: the success / failure denominators, `surfer_id` retry
   patterns, multi-ticket `master` / `slave` attribution, and `booking_id`-based resolution.

## Workflow (always in this order)

1. **ClickHouse — failure signatures and `search_id` list.** Pull failing rows for the window +
   `gds` from `jupiter.jupiter_booking_errors_v2` with their signature fields. This is the
   primary step; the `search_id` array this produces is what you feed to Mongo in step 4.
2. **MySQL cross-check + enrichment.** Run the standard MySQL base query (same window + `gds` +
   base filters, `bconta.status = 0`, master + slave both counted). Confirm the failure count
   agrees with CH within ingestion-lag noise; investigate only if the gap is large (`is_test`
   flag, window clock skew, `search_hash IS NULL` rows, ingestion lag). Pull MySQL-only fields
   you need: `customer_attempt_id`, `booking_id`, `surfer_id`, `bcusta.date_created`,
   `multiticket_part`.
3. **Drop unusable keys:** exclude `search_id IS NULL` / `''` (CH side) or `search_hash IS NULL`
   / `''` (MySQL side) from the Mongo pass; report how many failures had no hash.
4. **MongoDB — `ota.debug_logs`:** when CH's `error_message` is too coarse, query by
   **`transaction_id`** using the hashes from step 1. Prefer **batches** with `$in` on
   `transaction_id` (25–100 hashes per batch to stay under `--limit` and readable). **Always**
   narrow by that supplier's **`context`** (exact string when known, else case-insensitive
   `$regex` on the integration name — see `.cursor/rules/mongodb.md`). Sort by `date_added` for
   timeline; use `--json` for permalinks.
5. **Read supplier evidence first:** for each `transaction_id`, identify log lines with raw
   request / response for the book path; use local exceptions only as supporting context.
   Details: [`debug_logs_query_patterns.md`](debug_logs_query_patterns.md#source-of-truth-supplier-traffic-vs-local-exceptions).
6. **Similar-errors report (mandatory output):** Group failures by a **stable signature**:
   - **Primary:** CH `(classification_category, classification_subcategory, booking_step,
     main_group_error, sub_group_error, error_message)` tuple (or the subset that yields a
     readable grouping). Normalize `error_message` if it embeds IDs / prices.
   - **Secondary:** MySQL `bconta.error` when it aligns with CH (or flag **"MySQL vs CH
     mismatch"** when they diverge — rare but real).
   - **Escalation evidence:** if Mongo was pulled, attach the raw `Response` body or the
     supplier-side permalink under the group.
   - For **each group:** count, **1–3 example `search_id` / `search_hash`**, and **at least one
     permalink** to the supplier-side log document when Mongo was pulled.
   - Call out groups that are **purely payment / CC** vs **availability / GDS / fare** so the
     narrative does not mix causes.

### Reclassification notes

- **CH vs MySQL disagreement:** rare. If CH says `PAYMENT_ERRORS` but MySQL says
  `flight_not_available_other`, trust CH (closer to the raw error path) and flag
  **"MySQL vs CH mismatch"** in the report.
- **CH vs Mongo disagreement:** if Mongo shows a supplier rejection but CH classified as
  `TECHNICAL_ERRORS`, prioritize supplier evidence for the root-cause narrative and note that
  the classifier mislabelled the row.
- **NULL / empty keys:** rows without a `search_id` / `search_hash` stay in the "uncorrelated"
  bucket — do not pretend they were log-verified.

## ClickHouse: failure signatures + `search_id` list

Primary step-1 query. Groups by signature tuple so each row already carries a shareable
`search_id` sample and a count; feed the full array to Mongo if needed.

```sql
-- ClickHouse — failing rows for {content_source} in [start_datetime, end_datetime)
SELECT
  classification_category,
  classification_subcategory,
  booking_step,
  main_group_error,
  sub_group_error,
  error_message,
  count() AS c,
  uniqExact(search_id) AS distinct_search_ids,
  groupArray(search_id)  AS all_search_ids,       -- feed to Mongo $in
  groupArray(5)(search_id) AS sample_search_ids   -- for the report
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= '{start_datetime}'
  AND timestamp <  '{end_datetime}'
  AND gds = '{content_source}'
  AND search_id != ''
  /* AND validating_carrier = 'XX' */
GROUP BY classification_category, classification_subcategory, booking_step,
         main_group_error, sub_group_error, error_message
ORDER BY c DESC
```

## MySQL: failure rows with `search_hash` (for the rate cross-check + MySQL-only fields)

Same base filters as the standard report (date window, `gds`, production). Keep both MT legs
(`master` + `slave`) — `multiticket_part` is surfaced in the select so you can still split per
leg downstream. Use this when you need `surfer_id`, `customer_attempt_id`, `booking_id`, or to
reconcile totals.

```sql
SELECT
  bconta.search_hash,
  bconta.error AS contestant_error,
  bcusta.id AS customer_attempt_id,
  bconta.booking_id,
  bcusta.surfer_id,
  bbc.multiticket_part,
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
  AND bconta.status = 0
  AND bconta.search_hash IS NOT NULL
  AND bconta.search_hash <> ''
ORDER BY bcusta.date_created DESC;
```

## MongoDB: batch `transaction_id` (`$in`)

Load `.env` once per session (`set -a && source .env && set +a`, see
`.cursor/rules/global_setup.md`), then:

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": {"$in": ["HASH1", "HASH2"]}, "context": {"$regex": "SupplierName", "$options": "i"}}' \
  --sort '{"date_added": -1}' \
  --limit 500 \
  --json
```

Replace `SupplierName` with the integration substring for `{content_source}`; use **exact
`context`** when documented in `db-docs/mongodb/debug_logs.md` (content hints) or established from
prior art.

Single-transaction spot-check:

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": "YOUR_SEARCH_HASH"}' \
  --sort '{"date_added": -1}' \
  --limit 1000 \
  --json
```

## Scope caveats for the similar-errors summary

If the user cares only about **supplier bookability** failures, still pull CH signatures for
**all** contestant failures in scope first, then **exclude** groups that are clearly payment-only
(`classification_category = 'PAYMENT_ERRORS'` / MySQL `payment_error`) when building the
"bookability" summary table — do not exclude silently; state what was excluded and why. Mongo is
only pulled for the subset of groups whose CH signature was too coarse or whose supplier-side
payload is needed for the narrative.

## Prevalence + permalinks

For sharable counts and permalink arrays per signature, use the harvest aggregations in
[`harvest_permalinks.md`](harvest_permalinks.md) (Variants A/B/C).

## Formatting the output for Trello

If the similar-errors report is going on a Content Integration card, follow
[`trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md) — `⊙ Summary` +
`⊙ Numbers/ quantity/ Examples:` with `some examples` permalink lines and `mongo_query:` fenced
blocks per signature. Do not restate those conventions here.
