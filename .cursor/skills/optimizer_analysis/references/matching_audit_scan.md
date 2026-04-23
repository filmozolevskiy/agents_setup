# Matching-error audit scan (Workflow B)

Use when the user asks for a broad matching audit over a content source and
time window ("audit Amadeus last 24h", "where is the Optimizer dropping
fares this week"). Produces a **grouped similar-errors report** — signatures
with counts, representative `attempt_id`s, and `optimizer_logs` permalinks.

Unlike Workflow A, this does not reconcile every fare on every attempt; it
relies on cheap MySQL anomaly signals to pick attempts worth a deeper pass.

## Checklist

```
- [ ] 1. Confirm scope (gds, window, anomaly thresholds)
- [ ] 2. Run by_gds_window SQL; get attempt roll-up
- [ ] 3. Pick the anomaly subset (heuristics) and cap it (default 100)
- [ ] 4. Batch-pull optimizer_logs for those attempts
- [ ] 5. Reconcile each attempt (reuse Workflow A reconcile step)
- [ ] 6. Group verdicts into signatures
- [ ] 7. Harvest counts + permalinks per signature
- [ ] 8. Emit grouped similar-errors report
- [ ] 9. Post-run learning
- [ ] 10. Offer Trello follow-ups
```

## Step 1 — Confirm scope

Ask the user (or state explicitly in the report):

- `gds` / content source — required. "all" means iterate over distinct `gds`
  values in the window; treat each as its own scan.
- Time window — default **last 24h**. Widen to 7d only when daily volume is
  low or the user wants prevalence.
- Anomaly thresholds — default to the heuristic set in the SQL template:
  `candidate_count <= 1`, `exception_count = candidate_count`,
  `unbookable_count = candidate_count`, `demoted_count >= candidate_count/2`.
  Tune in the report if signal-to-noise is off.
- **Policy-exception scope** — `Blocked by Supplier Rules%` and the other
  exclusions listed in
  [`SKILL.md` → Default scope](../SKILL.md#default-scope--routine-policy-exclusions)
  are ignored by default. Include them only if the user explicitly asks
  to see policy filtering (e.g. "include supplier rules"). Record the
  choice in the report header.

## Step 2 — Run `by_gds_window`

Run the template in
[`optimizer_sql_templates.md`](optimizer_sql_templates.md#template-by_gds_window).
The output is one row per `attempt_id` with aggregates (`candidate_count`,
`exception_count`, etc.) and a baked-in anomaly filter. Set the template's
`{include_supplier_rules}` sentinel to `FALSE` by default (matches the
default scope); only flip it to `TRUE` if the user asked to include
policy filtering.

Sanity-check the counts against the content source's expected volume. If the
scan returns an implausibly small number of attempts, widen the window or
drop thresholds before proceeding — silent under-sampling is worse than a
few false positives.

## Step 3 — Pick the anomaly subset

Cap the deep-dive list at **100 attempts by default** to keep Mongo scanning
bounded. If the anomaly set is larger, **sample representatively**:

- Stratify by `trip_type` (oneway / roundtrip / multi) when volumes differ.
- Stratify by `reprice_type` when one type dominates (e.g. repricing vs
  originals).
- Record in the report that the scan was capped and how sampling was done.

## Step 4 — Batch-pull `optimizer_logs`

Use the `$in` pattern from
[`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#batch-many-transactions-workflow-b).
Batch 25–100 `search_id`s per call.

If `context` narrowing is known for the content source (from a previous run
or from `db-docs/mongodb/optimizer_logs.md`), apply it — otherwise run wide
on the first batch and inspect distinct `context` values before narrowing.

## Step 5 — Reconcile each attempt

For each `attempt_id` in the subset, run the reconcile step from
[`single_attempt_investigation.md`](single_attempt_investigation.md#step-5--reconcile-fares-against-candidates).

Store a compact record per attempt:

```json
{
  "attempt_id": 5406862,
  "gds": "amadeus",
  "search_id": "abc...",
  "mistakes": [
    {"bucket": "MISSED", "match_key_hash": "AC|123,456|Y|Y|M"},
    {"bucket": "WRONG_TAG:Exception", "candidate_id": 425122742, "exception_value": "no_availability"}
  ],
  "log_permalink": "https://.../log-group/abc...#6a0f..."
}
```

## Step 6 — Group into signatures

A **signature** is the stable fingerprint of a mistake pattern. Default
fingerprint:

```
(gds, bucket, exception_value_or_NULL, reprice_type, candidacy)
```

For `PRICE_MISMATCH`, append the field name (`total` / `base` / `tax`) and
the sign of the delta (positive vs negative) — a systematic positive delta
often points to a missing markup step; a symmetric delta points to a rounding
issue.

For `FARE_BASIS_MISMATCH` (see
[`mistake_classification.md` → bucket 2a](mistake_classification.md#bucket-2a--fare-basis-mismatch-anchor-relative)),
append the `gds_account_id` (the reprice pass's account — e.g.
`DOWNTOWNTRAVELUSD`) and a compact segment-wise fare-basis diff; those
are what identify which GDS-account-level configuration emits the
mismatched basis.

Merge records with the same signature and accumulate:

- `count` (attempts affected).
- `example_attempts` — up to 3 `attempt_id`s.
- `example_permalinks` — one supplier-side permalink per example attempt.
- `earliest_seen` / `latest_seen` — `date_added` bookends within the window.

## Step 7 — Harvest counts + permalinks

For each signature, also produce a 7d + 30d prevalence count to put
"how widespread" on the report. Use the Variant C aggregation from
[`../../bookability_analysis/references/harvest_permalinks.md`](../../bookability_analysis/references/harvest_permalinks.md),
swapping `debug_logs` → `optimizer_logs` and the signature-bearing field to
whatever path `fares[]` exposes for the bucket (see
[`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#fares-extraction)).

Date-bounded aggregations need mongosh / Compass / `pymongo` (see the
snippet in [`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#date-bounded-aggregations)).

## Step 8 — Report template

```markdown
# Optimizer matching audit — {gds}

- **Window:** {start_datetime} .. {end_datetime}  ({hours} hours)
- **Attempts scanned (MySQL):** {total_attempts}  (anomaly subset: {subset} / capped at {cap})
- **Attempts deep-dived (Mongo):** {deep_dived}
- **Anomaly heuristics:** {heuristics_used}
- **Policy exceptions:** excluded by default (`Blocked by Supplier Rules%` et al.); set to **included** only when the user asks.

## Summary

| Signature | Bucket | Count | 7d prevalence | 30d prevalence | Example attempt | Example permalink |
|-----------|--------|-------|---------------|----------------|-----------------|-------------------|
| FARE_BASIS_MISMATCH · gds_account=DOWNTOWNTRAVELUSD | Fare-basis mismatch | 1 | 12 | 48 | 6881962 | [log](...) |
| MISSED · reprice_type=original · candidacy=Eligible | Missed fare | 37 | 412 | 1,683 | 5406862 | [log](...) |
| WRONG_TAG:Exception="no_availability" | Wrong tagging | 21 | 198 | 780 | 5406901 | [log](...) |
| PRICE_MISMATCH:total (+delta) · currency=EUR | Price mismatch | 8 | 44 | 190 | 5406920 | [log](...) |
| ... | ... | ... | ... | ... | ... | ... |

## Per-signature detail

### MISSED · reprice_type=original · candidacy=Eligible  (37)

- **Hypothesis:** pre-filter is dropping fares before tag assignment on
  original (non-repriced) passes for {gds}.
- **Examples:** attempt_id=5406862 ([log](...)), 5406881 ([log](...)), 5406901 ([log](...)).
- **Supplier evidence:** fares for match keys X/Y/Z present in
  `optimizer_logs.fares[]` with no candidate carrying the same key.
- **SQL vs Mongo mismatches:** {n or "none"}.
- **Suggested next step:** verify pre-filter stage for `{gds}` covers these
  carriers; open Trello card (see Follow-up below).

### WRONG_TAG:Exception="no_availability"  (21)

... (same structure) ...

## Caveats

- Anomaly subset was capped at {cap}; remaining {remainder} attempts with
  anomaly signals were not deep-dived in this run.
- `optimizer_logs` is capped; oldest entries in the 30d window may have
  rotated out, so 30d prevalence is a lower bound.

## Follow-up

- [ ] Trello cards (one per signature worth a ticket) — hand off to
  `trello_assistant`.
- [ ] Re-run on {gds} in 7d to check regression.
- [ ] Update `db-docs/mongodb/optimizer_logs.md` with newly confirmed
  `context` strings and `fares[]` paths (post-run learning).
```

## Step 9 — Post-run learning

Same rule as Workflow A: append confirmed facts to
`db-docs/mongodb/optimizer_logs.md` (new `context` strings, confirmed
`fares[]` paths, stable permalink URL shape) and to `db-docs/mysql/` when
tag or column meaning becomes clearer. Commit with a short message (no
editor attribution trailer).

## Step 10 — Follow-ups

Offer Trello card creation (one per signature worth a ticket) via
[`../../trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md).
Include supplier-side permalinks and 7d / 30d counts in each card so the
integration team can act without re-running the scan.
