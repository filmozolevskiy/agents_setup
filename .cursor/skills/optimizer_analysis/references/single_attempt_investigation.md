# Single-attempt investigation (Workflow A)

Use when the user supplies one concrete identifier (`attempt_id`, `search_id`,
`package_id`, `checkout_id`, or `booking_id`) and asks why a fare was missed,
mistagged, or mispriced — or simply "what did the Optimizer do on this
attempt".

Goal: produce a **per-fare verdict table** that reconciles every supplier
fare in `optimizer_logs.fares` against the candidates in
`optimizer_candidates`.

## Checklist

Copy this into your working notes and tick off as you go:

```
- [ ] 1. Resolve input -> attempt_id (+ date window)
- [ ] 2. Pull candidates with tags (optimizer_sql_templates.by_attempt)
- [ ] 3. Pull optimizer_logs by transaction_id = search_id
- [ ] 4. Confirm fares[] shape on first use of a content source
- [ ] 5. Reconcile each supplier fare -> verdict
- [ ] 6. Emit report (summary + per-classification table + permalinks)
- [ ] 7. Post-run learning (update db-docs)
- [ ] 8. Offer follow-up (Trello / deeper scan)
```

## Step 1 — Resolve input to `attempt_id`

Use the resolver queries in
[`optimizer_sql_templates.md`](optimizer_sql_templates.md#resolving-inputs-to-attempt_id).
If the resolver returns several rows, investigate the most recent one first
and note in the report how many other attempts share the same
`search_id` / `package_id` (reprice retries are common).

Pick a date window: if the user did not supply one, default to **72h** around
the row's `created_at` (or the booking's `date_created` when starting from
`booking_id`).

## Step 2 — Pull candidates with tags

Run the `by_attempt` template
([`optimizer_sql_templates.md`](optimizer_sql_templates.md#template-by_attempt)).
Save the result set in your working notes; the report references
`contestant_id`s directly.

Quick sanity checks on the result:

- Are there unexpectedly **few rows**? Possible signs of pre-filter dropping
  fares before tag assignment.
- Are **all rows** tagged `Exception` / `Unbookable`? Possible sign of a
  mismatch in the tag logic rather than supplier rejection.
- Is there an `optimizer_attempt_bookings.booking_id` on at least one row?
  When yes, cite it in the report — it tells you which candidate the user
  actually booked.

## Step 3 — Pull the optimizer log

Run the single-transaction find from
[`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#single-transaction-confirm-shape-spot-check)
using `transaction_id = <search_id from Step 2>`. Keep `--json` so `_id`
values are preserved for permalinks.

If multiple documents come back, identify which one corresponds to the
attempt you are investigating by matching `context`, `date_added`, and
any `reprice_index` / `package_id` signals. Record the chosen `_id`(s).

## Step 4 — Confirm `fares[]` shape

If this is the first investigation in this session for the content source,
sample one `fares[0]` document fully and confirm the paths listed in
[`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#fares-extraction).
If the real paths differ from the defaults, document the mapping in your
working notes **and** queue a post-run update to
`db-docs/mongodb/optimizer_logs.md`.

## Step 5 — Reconcile fares against candidates

For every `fares[i]`:

1. Build the **match key** (validating carrier + flight numbers + fare bases
   + booking classes + cabin codes — normalized per
   [`optimizer_logs_patterns.md`](optimizer_logs_patterns.md#default-match-key)).
2. Look for a candidate with the same key in the Step 2 result set.
3. Apply the classification rules from
   [`mistake_classification.md`](mistake_classification.md) and assign one of:
   - `MATCHED` — key and price align.
   - `MISSED` — no candidate carries the key.
   - `WRONG_TAG:<tag>` — candidate exists but tagged in a way the supplier
     payload contradicts.
   - `PRICE_MISMATCH:<field>` — candidate exists but price fields disagree
     beyond tolerance.
   - `RANK_MISMATCH` / `CANDIDACY_MISMATCH` — rank or candidacy contradicts
     supplier evidence (e.g. supplier-cheapest fare ranked near the bottom
     with no supporting tag; eligible fare marked `Unbookable`).

Then the inverse pass: for every candidate **not** matched to any fare,
flag `ORPHAN_CANDIDATE` — it was built without a supplier fare to back it.
Common for reprice passes, but worth calling out.

## Step 6 — Report template

Produce a self-contained markdown block. Keep it concise; move raw evidence
into the evidence section.

```markdown
# Optimizer investigation — attempt {attempt_id}

- **Attempt:** {attempt_id}  (`search_id={search_id}`, `package_id={package_id}`, `checkout_id={checkout_id}`)
- **GDS / content source:** {gds}
- **Created:** {created_at}  (window: {start_datetime} .. {end_datetime})
- **Optimizer log(s):** {permalinks}
- **Booking produced:** {booking_id or "none"}

## Summary

| Bucket                | Count |
|-----------------------|-------|
| Supplier fares        | {N}   |
| MATCHED               | {n_matched} |
| MISSED                | {n_missed}  |
| WRONG_TAG             | {n_wrong_tag} |
| PRICE_MISMATCH        | {n_price}   |
| RANK/CANDIDACY_MISMATCH | {n_rank}  |
| ORPHAN_CANDIDATE      | {n_orphan}  |
| **SQL vs Mongo mismatches** (flagged separately) | {n_divergent} |

## Per-fare verdict

| # | Verdict | Match key (carrier / flights / fare_basis / class / cabin) | Candidate | Supplier total | Candidate total | Notes / permalink |
|---|---------|------------------------------------------------------------|-----------|----------------|-----------------|-------------------|
| 1 | MISSED  | AC / 123,456 / Y / Y / M                                   | -         | 742.10 CAD     | -               | [supplier fare log](...) |
| 2 | WRONG_TAG:Exception | AF / ... | 425122742 | 612.00 EUR | 612.00 EUR | Exception="no_availability" but supplier returned the fare [log](...) |
| ...

## Root-cause narrative

One or two paragraphs linking the per-fare verdicts to a likely cause
(matcher bug, pre-filter rule, reprice step, currency conversion, tag
logic). Cite the **supplier-side log permalink first**, then any local
exception as supporting evidence. Call out any **SQL vs Mongo mismatch**
explicitly.

## Follow-up

- [ ] File Trello card on Content Integration board (hand off to
  `trello_assistant` skill)
- [ ] Run Workflow B scan for {gds} over last 7d to check prevalence
- [ ] Update `db-docs/` with any new stable facts (see SKILL.md post-run)
```

## Step 7 — Post-run learning

Per the SKILL.md rule, update `db-docs/mongodb/optimizer_logs.md` and any
MySQL `db-docs/` entries you had to clarify during the investigation.
Commit the change with a short message (no editor attribution trailer).

## Step 8 — Follow-ups

If the verdicts reveal a pattern worth a ticket, hand off to
[`../../trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md)
with the `⊙ Summary` / `⊙ Numbers/ quantity/ Examples:` format. Include the
per-fare verdict table and at least one supplier-side permalink per
signature.

If the user wants to see how widespread the pattern is, switch to
[`matching_audit_scan.md`](matching_audit_scan.md) with `{gds}` and a
reasonable window (default 7d).
