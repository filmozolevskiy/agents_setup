# Scan Workflow

Full step-by-step instructions for the automated content integration issue scan.

## Phase 1 — Scope

Ask the user (or infer from context):
- **Date window** — default: last 7 days (`NOW() - INTERVAL 7 DAY` to `NOW()`). Accept natural language ("last 3 days", "this week", specific dates).
- **Source filter** — default: all active sources. Accept a single GDS name to narrow scope.
- **Failure threshold** — default: ≥ 5 failures per error bucket. Adjust if the user asks.

Confirm scope in one sentence before running queries, e.g.:
> "Scanning all content sources for bookability failures in the last 7 days (threshold: ≥ 5 failures per error bucket). Running now…"

---

## Phase 2 — ClickHouse scan (all sources, error buckets)

Load credentials once: `set -a && source .env && set +a`

Use **`jupiter.jupiter_booking_errors_v2`** (ClickHouse). This table has pre-classified errors and
the raw `error_message` from the supplier/integration, which is richer than MySQL error codes and
avoids duplicating the MySQL bookability join complexity.

**Excluded categories** (availability/pricing noise — not integration issues):
- `FLIGHT_AVAILABILITY_ERRORS` — flight/seats no longer available
- `FARE_INCREASES` — fare price changes
- `PRICING_DISCREPANCY_ERRORS` — cannot price, fare unavailable
- `PAYMENT_ERRORS` — card declines, payment path

**Included categories** (actual integration errors):
- `CONTENT_SOURCE_ERRORS` — supplier errors, GDS errors
- `TECHNICAL_ERRORS` — internal code errors
- `CUSTOMER_INPUT_ERRORS` — input validation failures (may indicate our-side mapping issues)
- `OTHER` — anything unclassified

```sql
SELECT
  gds,
  classification_category,
  classification_subcategory,
  error_message,
  COUNT(*) AS c,
  groupArray(10)(search_id) AS sample_search_ids
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= '{start_datetime}'
  AND timestamp < '{end_datetime}'
  AND classification_category NOT IN (
    'FLIGHT_AVAILABILITY_ERRORS',
    'FARE_INCREASES',
    'PRICING_DISCREPANCY_ERRORS',
    'PAYMENT_ERRORS'
  )
  AND search_id != ''
GROUP BY gds, classification_category, classification_subcategory, error_message
HAVING c >= 5
ORDER BY gds, c DESC
```

Use `scripts/clickhouse_query.py`:
```bash
python3 scripts/clickhouse_query.py query "SELECT ..."
```

**Key fields:**
- `gds` — content source identifier
- `error_message` — the actual error text (already the raw supplier message, much richer than MySQL `contestant_error`)
- `classification_category` / `classification_subcategory` — pre-classification from our pipeline
- `search_id` — the Mongo `transaction_id` join key (same value as MySQL `search_hash`)
- `booking_step` — which step in the booking flow failed

**After running:**
- Parse into `(gds, category, subcategory, error_message, count, [sample_search_ids])` tuples.
- The `error_message` field already contains the supplier's actual text — use it directly as the signature in Phase 3 to narrow the Mongo query (no need to discover the error from logs first).
- If a single source was specified, add `AND gds = '{source}'` to the WHERE clause.

---

## Phase 3 — Mongo auto deep-dive

**Run this for every bucket from Phase 2 — do not skip, do not ask permission.**

For each `(source, error)` bucket, take up to 25 `search_hash` values from `sample_hashes` and
query `debug_logs`. Use the known `context` string for the content source when documented in
`db-docs/mongodb/debug_logs.md`; otherwise use a case-insensitive `$regex` on the integration name.

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id": {"$in": ["HASH1","HASH2","HASH3"]}, "context": {"$regex": "SupplierName", "$options": "i"}}' \
  --sort '{"date_added": -1}' \
  --limit 500 \
  --json
```

**For each batch of results:**

1. Scan for log entries that contain a supplier `Response` field (or equivalent raw supplier
   payload). These are the source of truth — see
   [`../bookability_analysis/references/debug_logs_query_patterns.md`](../bookability_analysis/references/debug_logs_query_patterns.md).

   > **Amadeus note:** Amadeus debug_logs store the SOAP response in a lowercase `response` field,
   > not `Response`. Always check both when querying Amadeus transactions.

2. **Use `error_message` from ClickHouse as the starting signature.** Because the ClickHouse table
   already contains the actual error text, use it directly to narrow the Mongo `$regex` filter on
   `Response` — no need to discover the message from scratch. Confirm in Mongo that the text is
   consistent across multiple `transaction_id`s.

3. **Spot-check at least 2–3 different `transaction_id`s** from the same bucket to confirm the
   signature repeats — one log is not enough.

4. Note if a bucket has **no Mongo match** (no `debug_logs` entries for those `transaction_id`s) —
   this is a "Needs investigation" classification trigger.

5. Watch for **ClickHouse vs Mongo mismatch**: the `error_message` in ClickHouse does not match
   what the supplier response actually contains in Mongo. Flag these explicitly.

**Batching guidance:** query 25 hashes at a time with `$in` to stay under readable limits. If a
bucket has many failures, 25 representative samples is sufficient — you do not need to query all.

---

## Phase 4 — Prevalence

For each confirmed signature from Phase 3, measure how widespread it is over 7 days and 30 days.

Use **Variant C** (counts only) from
[`../bookability_analysis/references/harvest_permalinks.md`](../bookability_analysis/references/harvest_permalinks.md):

```javascript
// Run in mongosh or Compass (ISODate not supported in scripts/mongo_query.py)

// Total log lines matching signature
[ { $match: { context: "...", Response: { $regex: "...", $options: "i" }, date_added: { $gte: ISODate("..."), $lte: ISODate("...") } } }, { $count: "n" } ]

// Distinct transaction_ids
[ { $match: { /* same */ } }, { $group: { _id: "$transaction_id" } }, { $count: "n" } ]
```

Then use **Variant B** (one permalink per `transaction_id`) to harvest 3–5 example links per
signature for the report.

If `scripts/mongo_query.py` is the only tool available (no mongosh/Compass), use the JSON-safe
`aggregate` subcommand for relative date ranges:

```bash
python3 scripts/mongo_query.py aggregate debug_logs \
  '[{"$match": {"context": "...", "Response": {"$regex": "..."}}}, {"$group": {"_id": "$transaction_id"}}, {"$count": "n"}]' ota
```

Note: without `ISODate` bounds this scans a wider window — state the caveat in the report.

---

## Phase 5 — Report

Output the full report following the format in
[`report_format.md`](report_format.md).

Rules:
- Every signature must have a classification tag before it appears in the report.
- Apply [`classification_guide.md`](classification_guide.md) to each signature.
- Sort signatures within a source by count descending (most frequent first).
- Include the summary table at the top so the user can see the overall picture at a glance.
- Always attach at least one example permalink per signature when available.

---

## Phase 6 — Follow-ups (offer after report)

After the report, append the follow-up options block (see `report_format.md`). Then wait for the
user to choose.

**If the user asks to draft a message to a content source:**
- Write a concise plain-text/Slack message.
- Include: what the issue is (in plain language), how often it occurs (Scale), 2–3 example log
  links, and a request for the provider to investigate or confirm.
- Do not include internal stack traces or our-side configuration details.
- Keep it professional and to the point — one short paragraph + examples.

Example shape:
```
Hi [Source] team,

We've been seeing [short description of error] in [flow name] over the past [window].
This has affected [N] bookings / [M] transactions.

Example logs:
- [permalink_1]
- [permalink_2]

Could you investigate and let us know what's causing this?

Thanks
```

**If the user asks to create a Trello card:**
- Read `.cursor/skills/trello_content_integration/SKILL.md` and follow it.
- Pre-fill: title from the source + error label, `⊙ Summary` from the report's evidence line,
  `⊙ Numbers/Examples` with Scale + example permalinks + `mongo_query:` block from Phase 4.
