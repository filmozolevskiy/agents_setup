# Deep bookability analysis

Use when the user asks for a **deep bookability analysis** or equivalent ("correlate logs", "why
did we really fail", "supplier truth for failures", "similar-errors report").

**Goal:** attribute failures correctly to:

- **(A) Non-bookability** — payment path: card decline, `payment_error`, Payhub / charge failures.
- **(B) Bookability / supplier-side** — availability, sold-out, fare change, GDS / supplier codes,
  policy.

Then produce a **similar-errors report** — grouped signatures with counts and examples.

## Principles

1. **Do not treat MySQL `contestant_error` as final truth** for deep analysis. Generic codes (e.g.
   `flight_not_available_other`) often hide the real supplier message; **confirm in `debug_logs`**.
2. **Scope "bookability" vs "non-bookability"** consistently with the non-bookability list in
   `SKILL.md`. Payment / CC-side outcomes are **non-bookability**; availability and supplier
   rejection of the itinerary or fare are **bookability**. After Mongo review, **reclassify** a
   row if logs show payment failure while SQL showed a generic code (or the reverse).
3. **`search_hash` is the join key:** MySQL `bookability_contestant_attempts.search_hash` → Mongo
   **`debug_logs.transaction_id`**. Rows with **NULL or empty `search_hash`** cannot be
   correlated; list them separately and do not pretend they were log-verified.

## Workflow (always in this order)

1. **MySQL — same base filters as the standard report** (date window, `gds`, production,
   multiticket rule; see [`standard_bookability_report.md`](standard_bookability_report.md)).
   Select **contestant failures only** (`bconta.status = 0`) and output at least: `search_hash`,
   `contestant_error`, `customer_attempt_id`, `booking_id`, `surfer_id`, `bcusta.date_created`.
2. **Drop unusable keys:** exclude `search_hash IS NULL` or `''` from the Mongo pass; report how
   many failures had no hash.
3. **MongoDB — `ota.debug_logs`:** for the content source under investigation, query by
   **`transaction_id`** using the hashes from step 1. Prefer **batches** with `$in` on
   `transaction_id` (25–100 hashes per batch to stay under `--limit` and readable). **Always**
   narrow by that supplier's **`context`** (exact string when known, else case-insensitive
   `$regex` on the integration name — see `.cursor/rules/mongodb.md`). Sort by `date_added` for
   timeline; use `--json` for permalinks.
4. **Read supplier evidence first:** for each `transaction_id`, identify log lines with raw
   request/response for the book path; use local exceptions only as supporting context. Details:
   [`debug_logs_query_patterns.md`](debug_logs_query_patterns.md#source-of-truth-supplier-traffic-vs-local-exceptions).
5. **Similar-errors report (mandatory output):** Group failures by a **stable signature**:
   - **Primary:** normalized supplier message or code from **`Response`** / payload (or a
     structured field) — **not** only MySQL `contestant_error`.
   - **Secondary:** MySQL `contestant_error` when it aligns with Mongo (or flag **"SQL vs Mongo
     mismatch"** when they diverge).
   - For **each group:** count, **1–3 example `search_hash`**, and **at least one permalink** to
     the **supplier-side** log document where possible.
   - Call out groups that are **purely payment / CC** vs **availability / GDS / fare** so the
     narrative does not mix causes.

### Reclassification notes

After Mongo review:

- If logs show **payment / CC** but SQL did not use `payment_error`, **reclassify** the row in the
  similar-errors report.
- If SQL shows `payment_error` but logs show a **supplier rejection**, flag **SQL vs Mongo
  mismatch** and prioritize supplier evidence for the root-cause narrative.

## SQL: failure rows with `search_hash` for Mongo correlation

Uses the same base filters as the standard report (date window, `gds`, production, multiticket):

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

If the user cares only about **supplier bookability** failures, still pull Mongo for **all**
contestant failures in scope first, then **exclude** groups that are clearly payment-only when
building the "bookability" summary table — do not exclude silently; state what was excluded and
why.

## Prevalence + permalinks

For sharable counts and permalink arrays per signature, use the harvest aggregations in
[`harvest_permalinks.md`](harvest_permalinks.md) (Variants A/B/C).

## Formatting the output for Trello

If the similar-errors report is going on a Content Integration card, follow
[`trello_content_integration/SKILL.md`](../../trello_content_integration/SKILL.md) — `⊙ Summary` +
`⊙ Numbers/ quantity/ Examples:` with `some examples` permalink lines and `mongo_query:` fenced
blocks per signature. Do not restate those conventions here.
