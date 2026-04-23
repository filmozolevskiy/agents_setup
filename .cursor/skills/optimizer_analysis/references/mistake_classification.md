# Mistake classification

Decision rules for turning a fare-vs-candidate pair into a verdict. Used by
the single-attempt investigation (per-fare verdict), the contestant-forming
leak audit (per-leg classification), and the broad anomaly scan (signature
grouping).

Two complementary families of buckets live here:

- **Pre-matcher buckets** — apply when the attempt never produced a
  candidate for a match key at all (candidacy `Incalculable` / non-drop
  `Unsalable`). Used by the contestant-forming leak audit. See
  [*Pre-matcher contestant-forming buckets*](#pre-matcher-contestant-forming-buckets)
  below — this is the primary taxonomy for the skill's headline job.
- **Post-matcher buckets** — apply when a candidate exists but something
  about it is wrong (missed fare from payload, wrong tag, wrong price,
  wrong rank, wrong candidacy). Documented further down in the classic
  pipeline section.

**Supplier evidence wins.** When MySQL tag state and the supplier payload
disagree, the payload is the root-cause source. Flag the divergence
explicitly as **"SQL vs Mongo mismatch"** in the report; never silently
reclassify.

**When the Mongo payload is not readable** (the common case — `meta.*`
fields are placeholders; see
[`../../../../db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#meta-payloads-are-placeholders)),
fall back to the **attempt's anchor candidate** as the ground truth for
"what the Optimizer was matching to" (see *Anchor candidate* below).

## Pre-matcher contestant-forming buckets

Use these when the attempt produced **no contestant** for one or more
operand legs (candidacy `Incalculable`, or `Unsalable` with
`reprice_type <> 'reprice_and_drop'`). The unit of classification is one
**operand leg** — see
[`optimizer_logs_patterns.md` → *Multi-ticket operand iteration*](optimizer_logs_patterns.md#multi-ticket-operand-iteration-mandatory-for-leak-audits).

### Per-leg bucket definitions

| Bucket | Rule | Responsible side |
|---|---|---|
| `supplier_0_routings` | Supplier returned 0 routings for this leg. | Supplier |
| `supplier_gap` | Supplier returned routings, but **none** contain the operand's anchor flight(s). Substitutes only. | Supplier |
| `supplier_returned_with_fb` | Supplier returned the anchor's flight **with** a populated `fareBasisCode`, yet the wrapper still threw `IncalculableRepricerException` / `AdmissibleRepricerException`. Usually a predicate mismatch (`fare_bases` / `booking_classes` / `cabin_codes` differ from the anchor) in package assembly. | Our-side (predicate mismatch) |
| `pure_our_side_leak_fb_empty` | Supplier returned **all** of the operand's anchor flights, but every occurrence has `fareBasisCode=[]` (or null/empty). Our package-assembly gate rejects the candidate before the matcher. Strongly correlated with LCC operating carriers (F8, F9, VB, VZ, TR, G4, XY, A1, …) which legitimately don't emit fare basis. | Our-side (rescue-able by relaxing the fb gate) |

Edge-bucket names used only in tooling diagnostics (not headline counts):

- `no_operand_log` — `{Source}::Reprice-original-operands` document absent
  for the attempt. Suggests the logger or the reprice stage didn't fire —
  separate investigation.
- `no_api_for_op` — operand log exists but no corresponding
  `{source}-api[...] search` call. Suggests a short-circuit before the
  supplier call.
- `op_no_fn` — operand has no `flightNumbers` field. Anchor fingerprint is
  empty; see [`SKILL.md`](../SKILL.md) note on "empty anchor metadata".

### Attempt-level verdict

Aggregate per-leg buckets into one verdict per attempt:

| Attempt verdict | Rule | Rescue-able? |
|---|---|---|
| `supplier_dominated` | Any leg is `supplier_gap` or `supplier_0_routings`. | No — fixing our-side wouldn't rescue this attempt. |
| `pure_our_side_leak` | **Every** leg is `pure_our_side_leak_fb_empty`. | Yes — relaxing the fb gate would fully rescue. |
| `our_side_mixed` | Every leg is our-side (empty-fb or with-fb), but at least one of each. | Partial — two-pronged fix required. |
| `other` | Edge cases (missing logs, op with no flight numbers, etc.). | Inspect individually, exclude from headline counts. |

Only `pure_our_side_leak` (plus the `fb_empty` portion of `our_side_mixed`)
counts as rescue-able for a fb-gate-relaxation ticket. Do not inflate
headline numbers by single-leg classification across multi-leg attempts
that are supplier-dominated on another leg.

### `reprice_and_drop` — not a failure

Candidates with `reprice_type = 'reprice_and_drop'` end up `Unsalable` with
`UnsalableRepricerException("Reprice and Drop")` even when the supplier
returned the exact itinerary at a positive-revenue price. This is an
**intentional shadow repricing** used for benchmarking, thrown at
[`NewOptimizerRepricer.php:78`](../../../../src/Optimizer/Repricer/NewOptimizerRepricer.php)
via `shouldRepriceAndDrop()`. These attempts:

- **Do** have full supplier data and a built package.
- **Do** reach `self::guardAgainstIneligible($package)` successfully.
- **Are** then deliberately thrown away before any matcher event would
  fire.

Exclude from the contestant-forming leak audit by default. Do not classify
them as `supplier_returned_with_fb` — that would miscount a benchmark as a
matching error.

### Reporting shape

Report per-leg bucket counts, per-attempt verdict counts, and a per-carrier
breakdown of pure-leak legs. See
[`contestant_forming_audit.md`](contestant_forming_audit.md#step-7--report-template)
for the full template.

## Anchor candidate (per attempt)

The row in `optimizer_candidates` with `reprice_type = 'original'` is the
**anchor** (a.k.a. master) for its attempt. Its `reprice_index` is
`master_0`; other reprice variants carry `master_1`, `master_2`, …,
`master_N` (strings — not integers). All reprice variants were produced by
the Optimizer from this anchor.

When reconciling a non-original candidate without a readable supplier
payload, compare the candidate to its attempt's anchor on the default
match key (`validating_carrier`, `flight_numbers`, `booking_classes`,
`cabin_codes`) plus `total` within tolerance. Differences on `fare_bases`
or `fare_families` alone are the `FARE_BASIS_MISMATCH` signature below
(confirmed 2026-04-21 on DTT `DOWNTOWNTRAVELUSD` reprice traffic —
`attempt_id=6881962`, `master_64`).

## Pipeline (per candidate)

```
candidate in optimizer_candidates
   │
   ├── reprice_type = 'original'           ─▶  anchor  (ground truth)
   │
   ▼  (non-original candidate)
compare to attempt anchor on match key
   │
   ├── identical key + total               ─▶  MATCHED
   │
   ├── same itinerary (flight_numbers + booking_classes + cabin_codes +
   │   validating_carrier) and total within tolerance,
   │   but fare_bases / fare_families differ
   │                                       ─▶  FARE_BASIS_MISMATCH   (bucket 2a)
   │
   ├── itinerary differs but anchor's supplier payload includes a fare
   │   with the candidate's key                                      
   │                                       ─▶  MATCHED-BY-PAYLOAD
   │
   ├── no candidate key matches anchor and no supporting payload
   │                                       ─▶  MISSED                (bucket 1)
   │
   ├── candidate has tag contradicting supplier / anchor evidence
   │                                       ─▶  WRONG_TAG:<tag>       (bucket 2)
   │
   ├── price disagrees beyond tolerance    ─▶  PRICE_MISMATCH:<field>(bucket 3)
   │
   ├── rank / candidacy contradicts evidence
   │                                       ─▶  RANK_MISMATCH or CANDIDACY_MISMATCH
   │
   └── otherwise                           ─▶  MATCHED
```

After the pass, candidates with no supporting evidence (anchor or
payload): `ORPHAN_CANDIDATE`. Common for reprice passes where the supplier
returned nothing usable — not always a mistake, but worth flagging.

## Bucket 1 — Missed fare

**Rule.** A fare the supplier returned has no corresponding candidate in
the attempt. Two ways to detect:

1. **Payload-level** (preferred when available) — a match key K present
   in the supplier payload has no `optimizer_candidates` row carrying the
   same key. Requires the payload to be readable (rare — see
   [`optimizer_logs_patterns.md`](optimizer_logs_patterns.md)).
2. **Structural** (fallback) — only an anchor exists for the attempt and
   every reprice pass produced `Incalculable` / `NULL`-itinerary
   candidates tagged `No fares found` or `Failed to build combination`.
   This is usually legitimate supplier attrition on reprice, not a
   matcher bug; flag as `MISSED:<exception_value>` and note it needs
   prevalence context before escalation.

**Hypotheses to document** (pick the one evidence best supports):

- **Matcher bug** — supplier payload differs cosmetically from what the
  matcher expects (e.g. fare-basis case, segment order, stringified vs
  numeric flight numbers). For fare-basis-only divergence, prefer
  **bucket 2a** — it is a distinct, more specific signature.
- **Pre-filter dropped it** — an Optimizer rule excluded the fare before
  tag assignment (cabin mismatch, policy, incompatible with anchor).
- **Attempt truncated** — Optimizer hit a row cap or timeout; supplier
  returned more fares than we processed.
- **Supplier returned nothing** — legitimate attrition. Validate by
  checking whether any reprice pass for that GDS account produced
  non-NULL itinerary fields.
- **Wrong reprice pass** — fare was part of an original-pass payload but
  the attempt we audited is a reprice-only pass. Verify the `reprice_type`
  of the log document before concluding.

**Report element.** Cite the supplier-side log permalink; include the
normalized match key in the verdict row.

## Bucket 2a — Fare-basis mismatch (anchor-relative)

**Rule.** Non-original candidate (`reprice_type <> 'original'`) that:

- shares its attempt's anchor's `validating_carrier`, **exactly ordered**
  `flight_numbers`, `booking_classes`, and `cabin_codes`,
- has `total` within the price-mismatch tolerance (default ±0.02 in the
  candidate currency),

but whose `fare_bases` (or `fare_families`) differ from the anchor.

**Typical tag state.** `candidacy = Unmatchable` with
`Exception:No matching fares found` (observed on DTT reprice), **or**
`candidacy = Unsalable` with a downstream policy exception and
`Demoted:Unmatchable`. Either outcome indicates the reprice matching
stage rejected (or flagged) a fare that the supplier in fact returned for
the correct itinerary.

**Why it's a mistake.** The Optimizer's reprice match key includes
`fare_bases` with strict equality, but the supplier legitimately returns
different fare-basis codes for the same physical itinerary when the
reprice pass hits a different GDS account / product / visibility
(published vs private, promotional fare families, etc.). The rest of the
match key already pins the itinerary; treating fare-basis divergence as
an outright rejection drops fares that belong in the ranking.

**Report element.** Include both the anchor's fare_bases and the
reprice's fare_bases, a single-line segment-by-segment diff, and a
permalink to the reprice pass's supplier context (e.g. DTT's
`Downtowntravel::Reprice-matching-packages`). The SQL anchor-diff
template in
[`optimizer_sql_templates.md`](optimizer_sql_templates.md#template-anchor_diff)
produces a ready-to-paste table.

**When NOT to flag.** Skip when the itinerary actually differs —
`flight_numbers`, `booking_classes`, or `cabin_codes` disagreement means
the supplier returned a different flight, not the same one under a new
basis. That is `MISSED` or legitimate attrition, not `FARE_BASIS_MISMATCH`.

## Bucket 2 — Wrong tagging

**Rule.** Candidate exists for key K but a tag is set (or missing) in a way
the supplier payload contradicts.

Tag-specific sub-rules:

| Tag | `WRONG_TAG:<tag>` when… |
|-----|-------------------------|
| `Exception` | Supplier returned the fare cleanly (no error / rejection field on it), yet we attached an `Exception` value. The `Exception` value itself is then the hypothesis seed. |
| `Demoted` | Supplier marked the fare eligible / preferred (or it matches the cheapest / anchor rule) but we demoted it. |
| `Promoted` | Supplier payload gives no promotion signal (same family, price, policy) yet we promoted it. |
| `Risky` | Supplier response is clean; no risk signal in the payload. |
| `Unbookable` (`candidacy`) | Supplier response is eligible; our candidate ended up `candidacy = 'Unbookable'`. Treat as both `WRONG_TAG:Unbookable` and `CANDIDACY_MISMATCH` — report once, note both facets. |
| `Downgrade` | Supplier payload shows the same cabin / class as requested; no downgrade. |
| `MixedFareType` | Supplier payload is a single coherent fare type. |
| `AlternativeMarketingCarrier` | Supplier payload validating carrier matches the anchor. |
| `MultiTicketPart` | Value (`master` / `slave`) disagrees with segment layout in the supplier payload. |

**Report element.** Include both the tag name and the offending
`value` (from `optimizer_candidate_tags.value`) in the verdict. The value
is what a fix would target.

## Bucket 3 — Price / rank / candidacy mismatch

### Price mismatch

**Rule.** Candidate exists for key K but price field F differs from the
supplier payload beyond tolerance.

Reconciliation helper:

```
candidate.total ≈ candidate.base + candidate.tax + candidate.markup
                  + candidate.merchant_fee + candidate.supplier_fee
                  − candidate.commission   (business-specific; verify
                                             against a known clean case)
```

Tolerances:

| Field | Default tolerance | Rationale |
|-------|-------------------|-----------|
| `total` | ±0.02 in the candidate currency | rounding / FX |
| `base` | ±0.02 in the candidate currency | rounding |
| `tax`  | ±0.02 in the candidate currency | rounding |

Outside tolerance:

- **Systematic positive delta** across many candidates → missing markup
  step or double-applied fee.
- **Systematic negative delta** → dropped fee / leaked discount.
- **Symmetric small deltas** → rounding or currency conversion precision.
- **Per-attempt random deltas** → data corruption or wrong reprice pass
  attribution.

If the candidate currency differs from the supplier currency, verify the
conversion step before flagging — record the rate used (or its absence) in
the notes column.

### Rank mismatch

**Rule.** Candidate exists for key K but `rank` contradicts the supplier
ordering with no supporting tag explanation.

Examples:

- Supplier-cheapest fare ranked near the bottom without `Demoted` set.
- Supplier-preferred / anchor fare ranked below an obviously less-eligible
  one.

Flag only when a tag explanation is **absent**; a `Demoted` or `Risky` with
a plausible value downgrades this from `RANK_MISMATCH` to `WRONG_TAG` only
if the tag value is wrong per Bucket 2.

### Candidacy mismatch

**Rule.** `optimizer_candidates.candidacy` disagrees with the supplier
payload. Most common case: payload says "eligible" (clean fare, no
error/rejection) but candidacy is `Unbookable`.

Report `CANDIDACY_MISMATCH` **and** the corresponding `WRONG_TAG:Unbookable`
as one line in the verdict table (do not double-count).

## SQL vs Mongo mismatch

Whenever the MySQL tag state and the `optimizer_logs` payload tell different
stories, tag the verdict row **"SQL vs Mongo mismatch"** in the Notes
column. Report these as a separate count in the summary so they are visible
to the reader — they are signal that the tag pipeline is drifting from the
supplier truth.

Two common shapes:

- MySQL has `Exception` with value `no_availability` but the supplier
  payload cleanly returned the fare. The tag was likely set by a
  downstream step that misread the response.
- MySQL has the fare as `Eligible` but `optimizer_logs` shows the supplier
  explicitly rejected it. The tag pipeline missed the rejection signal.

In both cases, the **supplier evidence is the basis for the root-cause
narrative**. Reference the exact log field and permalink that informs the
verdict.

## Default scope — ignore routine policy filtering

`Exception` values beginning with **`Blocked by Supplier Rules:`** are
business-policy filtering (affiliate tier / visibility rules) applied
before matching. They are not matching mistakes and are **excluded by
default** from all verdicts, signatures, and anomaly heuristics. See
[`SKILL.md` → Default scope](../SKILL.md#default-scope--routine-policy-exclusions)
for the full list and the override phrase.

## Edge cases

- **Multiple candidates share a key.** Pick the one whose `reprice_type` /
  `reprice_index` matches the log document's pass. Note the choice.
- **Fare appears in payload twice (supplier dedupe issue).** Report as a
  single supplier fare and note the duplicate; do not double-count.
- **`parent_id` chains.** A repriced candidate may point to its original
  via `parent_id` when the column is populated; in practice on DTT
  reprice traffic `parent_id` is often NULL and the anchor link is
  established via `reprice_index='master_0'` within the same
  `attempt_id`. Use `parent_id` when non-NULL; otherwise fall back to the
  anchor-by-attempt rule.
- **Currency noise.** If the supplier payload is in the candidate's base
  currency before markup, compare on `base`, not `total`.
- **Anchor absent.** An attempt with no `reprice_type='original'` row is
  itself an anomaly — record it as `NO_ANCHOR` under MISSED rather than
  trying to reconcile reprice variants in isolation.

## When to escalate to `table_analysis`

If the supplier payload (when readable) exposes a field whose semantics
are unclear (e.g. a supplier-specific score), stop the reconciliation and
hand off to [`../../table_analysis/SKILL.md`](../../table_analysis/SKILL.md) —
do not invent a mapping.
