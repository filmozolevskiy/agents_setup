# Deep bookability analysis

Use when the user asks for a **deep bookability analysis** or equivalent ("correlate logs", "why
did we really fail", "supplier truth for failures", "similar-errors report").

**Goal:** attribute failures correctly to:

- **(A) Non-bookability** — payment path: card decline, `payment_error` / `PAYMENT_ERRORS`,
  Payhub / charge failures.
- **(B) Bookability / supplier-side** — availability, sold-out, fare change, GDS / supplier
  codes, policy.

Then produce a **similar-errors report** rendered as the two-table canonical layout from [`report_format.md`](report_format.md): a small **findings table** for total-failure / coverage / classification-mismatch / uncorrelated rows, and a separate **top-failure-causes table** with one row per signature cluster carrying the verbatim supplier `Response` from `debug_logs` next to the ClickHouse SQL and a sample-session permalink. The full signature × `search_id` × `Response` cross product belongs in `reports/_stdio/deep-<source>-<UTC>-{ch,mongo}.json`, not in the report body.

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
   base filters, `bconta.status = 0`, master + slave both counted) to pull the MySQL-only
   fields you need: `customer_attempt_id`, `booking_id`, `surfer_id`, `bcusta.date_created`,
   `multiticket_part`. Investigate the MySQL-vs-CH gap only when it's large enough to change a
   verdict (a few percent is normal ingestion-lag noise and is not worth a row in the report).
   When the gap **is** worth surfacing, ship it as the `MySQL ↔ ClickHouse classification
   mismatch` findings row, naming the disagreeing buckets — not as a routine reconciliation row.
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
6. **Similar-errors report (mandatory output)** — rendered as two markdown tables.

   **Findings table** (rate / volume / coverage rows). One row each, all `Proof` cells inline-runnable:
   - **Total bookability failures** — `INFO`. Count + share-of-total. Inline MySQL SQL. Flag uncorrelated rows in `Explanation` ("1,098 / 1,157 matched a ClickHouse signature; the remaining 59 had no `search_hash` and stayed in the uncorrelated bucket") rather than as a separate row.
   - **ClickHouse signature coverage** — `INFO`. How many bookability failures matched a CH signature (`X / Y = Z %`).
   - **Mongo deep-dive coverage** — `INFO`. How many sessions out of the bucket were pulled (e.g. "Mongo pulled for 902 / 1,098 correlated sessions in batches of 100"). Inline `mongo_query.py find ... --filter '{"transaction_id":{"$in":[...]}}'` template as the proof.

   Rows we deliberately do **not** include (same as the standard report — these were noise that rarely changed what anyone did): ~~MySQL ↔ ClickHouse classification mismatch~~, ~~uncorrelated rows~~, ~~MySQL vs ClickHouse row-count reconciliation~~. When a real classification mismatch shifts a verdict, surface it in the failure-causes table as a `CRITICAL` cluster row with the reclassification consequence in `Supplier verbatim` (e.g. "Reclassifying drops the bookability rate from X to Y"). When uncorrelated rows are large enough to matter, surface them as their own row in the failure-causes table with verdict `AMBIGUOUS` and the count in `Sessions over the window`.

   **Top-failure-causes table** (one row per signature cluster, with the columns `Cause | Verdict | Sessions over the window | Supplier verbatim | ClickHouse SQL | Sample session`):
   - **One row per cluster.** Group by CH `(classification_category, classification_subcategory, booking_step, main_group_error, sub_group_error, error_message)` tuple (or the subset that yields a readable grouping); normalize `error_message` if it embeds offer IDs / prices.
   - **`Cause`** is the business translation ("Supplier rejected as duplicate booking", "Fare increased past loss-limit between search and book", "NDC offer not suitable on price-verification (TK NDC)"). No supplier strings in `Cause`.
   - **`Verdict`** by share of the bookability-failure bucket: `> 50 %` → `CRITICAL`, `15–50 %` → `DEGRADED`, `< 15 %` → `INFO`. Misclassification clusters that meaningfully shift the headline rate ship `CRITICAL` regardless of share. Payment-only clusters that survived the (B)-only filter ship as `INFO` with the `Supplier verbatim` cell explaining "excluded from bookability rate" and stating which payment cluster they originally came from.
   - **`Sessions over the window`** = one number, with the per-day split when relevant ("624 sessions — 54 % of bookability failures").
   - **`Supplier verbatim`** = the actual `Response` / `Error-Data` body from `debug_logs` for one anchor session per cluster. Quote it. CH alone is not sufficient — wrappers like `Failed to reprice` hide `NDC-1454 SHOPPING_OFFER_NOT_SUITABLE`, and `Virtual card merchant fare statement items failed` hides a post-Sale fare-increase reversal. Always pull Mongo for at least one session per cluster.
   - **`ClickHouse SQL`** = inline-backticked grouping query that produces the count.
   - **`Sample session`** = `debug_logs` permalink that lands on the exact log entry whose verbatim text appears in `Supplier verbatim`. Canonical shape — pin this host, do not swap to `flighthub.com` / `justfly.com`: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>`. ResPro is shared across brands and `voyagesalacarte.ca` is the canonical ResPro host. To get the `_id`, query Mongo for the cluster's anchor session filtered to the supplier-error context (`Downtowntravel::BookFlight::Error`, `loss-limit-fare-increase`, etc. — full cheat-sheet in [`standard_bookability_report.md`](standard_bookability_report.md#supplier-error-context-cheat-sheet)) and copy the `$oid` of the returned document. The log-group root alone (no `#<_id>`) is **not** a sample session.

A worked report matching this two-table shape (Downtowntravel, three clusters, classification-mismatch row, uncorrelated row) lives in [`report_format.md`](report_format.md) § *Worked example 3 — Deep bookability / similar-errors report*. Match its row mix.

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

The findings table from [`report_format.md`](report_format.md) is the **source**. When the same findings post on a Content Integration card, the formatter in [`../../trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md) reshapes the table into `⊙ Summary` + `⊙ Numbers/quantity/Examples` with `some examples` permalink lines and `mongo_query:` fenced blocks per signature. Build the canonical table first; reshape from it. Do not skip the table and write Trello-shaped output directly — the table is the audit trail and the Trello card is the redistribution.
