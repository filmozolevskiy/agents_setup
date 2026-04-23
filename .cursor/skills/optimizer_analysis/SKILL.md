---
name: optimizer-analysis
description: >-
  Use when auditing the Optimizer's matching correctness — the primary job is
  finding cases where the supplier returned what we needed but we still failed
  to form a contestant (or formed a wrong one). Covers contestant-forming leak
  audits (leg-by-leg supplier-vs-our-side classification across a content
  source + window), per-attempt / per-search / per-booking drill-downs, and
  broad matching-error scans. Joins MySQL `optimizer_candidates` +
  `optimizer_attempts` + `optimizer_candidate_tags` with MongoDB
  `ota.optimizer_logs` context-specific supplier evidence, and uses the
  attempt's anchor (original) candidate as the reconciliation ground truth for
  reprice variants. Multi-ticket aware (iterates every `Reprice[master_N]` /
  `Reprice[slave_N]` operand per attempt). Ignores routine
  `Blocked by Supplier Rules%` policy exceptions and `reprice_and_drop`
  shadow-reprice candidates by default. Trigger phrases: "contestant-forming
  leak", "where did we fail to match", "where is unififi missing contestants",
  "fareBasisCode leak", "LCC fare basis gate", "analyze optimizer",
  "optimizer contestants", "why did we miss fare X", "optimizer matching
  error", "contestants for attempt N", "optimizer audit", "matching audit",
  "did we build the right contestants", "reprice analysis", "fare basis
  mismatch", "master_N candidate".
---

# Optimizer Analysis

Audit the Optimizer — the service that turns a content source's raw fare payload into ranked, tagged contestants (rows in `ota.optimizer_candidates`).

**Primary job: find matching-correctness leaks — cases where the supplier returned what we needed but the Optimizer still failed to form the right contestant.** Real leak shapes seen in traffic:

- Supplier returned the anchor's exact flight with `fareBasisCode=[]` for an LCC — our package-assembly gate dropped the candidate before the matcher ran.
- Supplier returned a fare whose itinerary matches the anchor, but `fare_bases` differ — we tagged the candidate `Unmatchable` / `No matching fares found` instead of ranking it.
- Multi-ticket attempt: supplier priced the `master` operand cleanly but left out the `slave` operand — attribute to the right leg, do not average across the attempt.

Investigations follow the two-stage shape used in `bookability_analysis`: MySQL overview first, then MongoDB deep-dive against context-specific supplier evidence in `optimizer_logs`.

**Before digging:** read [`db-docs/mysql/optimizer_candidates.md`](../../../db-docs/mysql/optimizer_candidates.md), [`db-docs/mysql/optimizer_attempts.md`](../../../db-docs/mysql/optimizer_attempts.md), [`db-docs/mysql/optimizer_candidate_tags.md`](../../../db-docs/mysql/optimizer_candidate_tags.md), [`db-docs/mysql/optimizer_tags.md`](../../../db-docs/mysql/optimizer_tags.md), [`db-docs/mongodb/optimizer_logs.md`](../../../db-docs/mongodb/optimizer_logs.md). For Mongo query mechanics, load [`.cursor/rules/mongodb.md`](../../rules/mongodb.md). Update `db-docs/mongodb/optimizer_logs.md` and `db-docs/mysql/optimizer_attempt_bookings.md` when you confirm durable facts (see **Post-run learning**).

## Glossary

- **Contestant** (user term) = **candidate** (schema term) = a row in `ota.optimizer_candidates`. Interchangeable; prefer "candidate" in report output to match the schema.
- **Attempt** — one row in `ota.optimizer_attempts` (one Optimizer run for a search, package, or checkout).
- **Anchor** (a.k.a. master) — the attempt's candidate with `reprice_type = 'original'` and `reprice_index = 'master_0'`. All other candidates are reprice variants (`master_1`, `master_2`, …). The anchor is the primary ground truth when the supplier Mongo payload is not directly readable.
- **Supplier payload** — context-specific `meta.*` fields on `optimizer_logs` documents (e.g. `Downtowntravel::Reprice-matching-packages`). Authoritative when readable, but leaves are usually placeholders pointing at an out-of-band payload store — confirm via permalink when content-level comparison is required. See [`db-docs/mongodb/optimizer_logs.md`](../../../db-docs/mongodb/optimizer_logs.md#meta-payloads-are-placeholders).

## Pick a workflow

| Trigger | Workflow | Reference |
|---------|----------|-----------|
| Contestant-forming leak audit on a content source + window ("where is unififi failing to match", "find LCC fare-basis leaks on pkfare last 24h", "scan <gds> for matching correctness") | **Contestant-forming leak audit** — leg-by-leg classification of `Incalculable` / `Unsalable` (non-drop) attempts into supplier-side vs our-side failures, attempt-level verdict, rescue-able count. | [`references/contestant_forming_audit.md`](references/contestant_forming_audit.md) |
| User supplies one of `attempt_id`, `search_id`, `package_id`, `checkout_id`, `booking_id` and asks "what did we build / what did we miss / why was fare X tagged X" | **Single-attempt investigation** — per-fare verdict report. | [`references/single_attempt_investigation.md`](references/single_attempt_investigation.md) |
| Broad anomaly scan ("matching audit on Amadeus last 24h", "where is Optimizer dropping fares") — user wants the distribution of mistake signatures across an unscoped anomaly subset | **Matching-error anomaly scan** — grouped similar-errors report with log permalinks. | [`references/matching_audit_scan.md`](references/matching_audit_scan.md) |

**Default:** use the contestant-forming leak audit when the user asks about matching correctness on a specific GDS. It is the skill's primary purpose and produces actionable per-carrier / per-bucket rescue counts. Fall back to the broad anomaly scan only when the user is explicitly surveying unknown territory.

If the user gives a single ID but also asks "and then see if this is widespread", run the single-attempt workflow first, then offer the leak audit with the root-cause bucket as the starting filter.

## Cross-cutting references

- **SQL templates** (parameterized by `attempt_id` / `search_id` / `booking_id` / `gds`+window): [`references/optimizer_sql_templates.md`](references/optimizer_sql_templates.md).
- **Mongo query patterns for `optimizer_logs`** (`transaction_id` ↔ `search_id`, `fares[]` extraction, permalinks): [`references/optimizer_logs_patterns.md`](references/optimizer_logs_patterns.md).
- **Mistake classification** (missed / wrong-tag / price-rank-candidacy mismatch, tolerances, SQL-vs-Mongo flag): [`references/mistake_classification.md`](references/mistake_classification.md).
- **Mongo safety / `scripts/mongo_query.py` rules:** [`../../rules/mongodb.md`](../../rules/mongodb.md).
- **Exploring undocumented tables / collections:** [`../explore_tables/SKILL.md`](../explore_tables/SKILL.md).
- **Documenting a newly understood table or collection:** [`../document_table/SKILL.md`](../document_table/SKILL.md).
- **Trello card formatting for follow-up tickets:** [`../trello_content_integration/SKILL.md`](../trello_content_integration/SKILL.md).

## Key data points (MySQL `ota`)

- `optimizer_candidates.id` — candidate primary key.
- `optimizer_candidates.attempt_id` — FK to `optimizer_attempts.id`. **Every query must bound on this or `created_at`** (table is ~45M rows).
- `optimizer_candidates.candidacy` — eligibility (`Eligible`, `Saver`, `Unbookable`, etc.). A supplier-eligible fare ending up `Unbookable` is a classic mistake signal.
- `optimizer_candidates.rank` — per-attempt ordering.
- `optimizer_candidates.reprice_type` / `reprice_index` — repricing strategy that produced the row. `reprice_index` is a **string** (`master_0` = anchor with `reprice_type='original'`; `master_1` … `master_N` = reprice variants). Separates "original" from "repriced" candidates when reconciling against supplier fares; anchors the `FARE_BASIS_MISMATCH` check in [`references/mistake_classification.md`](references/mistake_classification.md#bucket-2a--fare-basis-mismatch-anchor-relative).
- `optimizer_candidates.flight_numbers` / `fare_bases` / `booking_classes` / `cabin_codes` / `validating_carrier` — **default match key** to reconcile candidates against `optimizer_logs.fares`.
- `optimizer_candidates.total` / `base` / `tax` / `markup` / `merchant_fee` / `supplier_fee` / `commission` — price breakdown for mismatch detection.
- `optimizer_candidate_tags` + `optimizer_tags` — stable tag names: `Exception`, `Demoted`, `Promoted`, `Risky`, `Downgrade`, `MixedFareType`, `AlternativeMarketingCarrier`, `MultiTicketPart`. Extend the list in `db-docs/mysql/optimizer_tags.md` when new stable names appear.
- `optimizer_attempt_bookings.candidate_id` / `booking_id` — link from a candidate to the booking it produced (when any).

## Key data points (MongoDB `ota.optimizer_logs`)

- `transaction_id` — **join key**. Equals `optimizer_attempts.search_id` (confirmed 2026-04-21 on DTT reprice traffic — see [`db-docs/mongodb/optimizer_logs.md`](../../../db-docs/mongodb/optimizer_logs.md#join-key)).
- `context` — **primary anchor** for each step of the Optimizer pass. Supplier-side evidence lives in context-specific `meta.*` placeholders (e.g. `Downtowntravel::Reprice-matching-packages` with `meta.results`). There is no flat top-level `fares[]` field. See [`references/optimizer_logs_patterns.md`](references/optimizer_logs_patterns.md) and the per-content-source context table in [`db-docs/mongodb/optimizer_logs.md`](../../../db-docs/mongodb/optimizer_logs.md#per-content-source-context-hints).
- `meta.*` — usually placeholders (`{"type": "string.json"}` / `{"type": "composite"}`). Use the permalink to read actual payload content. Structural presence of a context is enough to say which step fired and when.
- `level` / `source` — narrow to the optimizer pass you care about. Never include other contestants' evidence in a given candidate's verdict.
- `date_added` — always bound when aggregating.

## Supplier-evidence rule (copied from `bookability_analysis`)

When the MySQL state and the supplier payload disagree, **the supplier payload wins** for root-cause narrative. Flag the divergence explicitly as "SQL vs Mongo mismatch" in the report. Never silently reclassify. When the payload is not readable, fall back to the attempt's anchor candidate as the ground truth (see Glossary). Detail: [`references/mistake_classification.md`](references/mistake_classification.md).

## Multi-ticket awareness (mandatory)

An attempt can emit multiple operand logs — one per leg of a multi-ticket (SMT) bundle. Each `Unififi::Reprice-original-operands` / equivalent `{Source}::Reprice-original-operands` document is tagged with `_scopes`:

- `Reprice[master_N]` — outbound / first-ticket leg.
- `Reprice[slave_N]` — inbound / second-ticket leg.

Each operand has its own `{source}-api[...]` search call and its own `Reprice <type>+<ACCOUNT>+<visibility>` wrapper with its own exception. For multi-ticket attempts, classify every leg independently and then aggregate to an attempt-level verdict. An attempt counts as a "pure our-side leak" only if every operand showed the our-side pattern. If any leg's supplier response was missing the anchor flight, the attempt is dominated by a supplier gap and our own gate is secondary.

Per-leg classifier and attempt-level aggregation rules: [`references/contestant_forming_audit.md`](references/contestant_forming_audit.md).

## `reprice_and_drop` is intentional — exclude from leak audits

Candidates with `reprice_type = 'reprice_and_drop'` are shadow repricings by design: the full reprice pipeline runs against an existing candidate to benchmark what the content source would have charged, then the result is intentionally dropped at [`NewOptimizerRepricer.php:78`](../../../src/Optimizer/Repricer/NewOptimizerRepricer.php) (genesis path). They end up `Unsalable` with `UnsalableRepricerException("Reprice and Drop")` even when price is positive-revenue and the supplier returned the exact itinerary. This is **not** a matching failure. Exclude `reprice_type='reprice_and_drop'` from leak audits by default. Include only when the user asks ("include reprice-and-drop", "include shadow repricings").

## Default scope — routine policy exclusions

To keep reports focused on matching / pricing mistakes, exclude these `Exception` tag values by default from all anomaly heuristics, verdict counts, and signatures:

- `Blocked by Supplier Rules: %` — affiliate-tier policy filtering (low-risk / meta / phone / high-risk / medium-risk / bundles affiliate blocks for published / private fulfill). Business policy, not matching mistakes.

Re-include only when the user asks ("include supplier rules", "include policy exceptions", "show all exceptions"). Record the scope choice in the report header.

SQL templates take this default via a `{include_supplier_rules}` sentinel — see [`references/optimizer_sql_templates.md`](references/optimizer_sql_templates.md#template-by_gds_window). Extend this list when another routine policy-only Exception family is confirmed. Keep the list here as the single source of truth referenced by the other skill files.

## Read-only

This skill never writes to production data. All MySQL statements are `SELECT`. All Mongo operations are `find` / `aggregate`. Trello follow-up goes through [`../trello_content_integration/SKILL.md`](../trello_content_integration/SKILL.md).

## Post-run learning (mandatory)

At the end of every run, before presenting the report, update durable docs.

**`db-docs/mongodb/optimizer_logs.md`** — extend the per-content-source context table when you confirm:

- A new `context` string that anchors the optimizer pass on a content source (e.g. a new `{Source}::{Step}` pattern).
- A `meta.*` field whose leaf is actually readable (not a placeholder) in real traffic — a genuine new affordance.
- A field name that differs from what the doc lists.
- A change to the stable permalink URL shape for optimizer logs.

**`db-docs/mysql/optimizer_tags.md`** — add rows for tag `name` values newly confirmed stable (Optimizer code emits them consistently).

**`db-docs/mysql/optimizer_candidates.md`** / **`optimizer_attempt_bookings.md`** — extend column tables when you validate a column's business meaning during an investigation.

Do not add rows for one-off observations or anything duplicating existing docs. After updating `db-docs/`, commit with a short message referencing the run date and what was learned (no editor attribution trailer — see `CLAUDE.md`).
