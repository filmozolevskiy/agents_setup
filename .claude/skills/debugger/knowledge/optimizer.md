# Optimizer

How the optimizer / repricer turns a content source's raw fare payload into ranked, tagged contestants, how it can change which supplier a booking lands on, and how to judge whether a contestant is right or wrong.

_Schemas: `../../db_access/db-docs/mysql/optimizer_*.md`, `../../db_access/db-docs/mongodb/optimizer_logs.md`. Join shape: [`optimizer_join_pattern.md`](../../db_access/db-docs/mysql/optimizer_join_pattern.md). Seeded 2026-07-30 from the former optimizer skill; 2026-11-04 merged the durable parts of the former optimizer notes._

## Glossary

- **Contestant** (user term) = **candidate** (schema term) = a row in `ota.optimizer_candidates`. Same thing. Prefer "candidate" next to schema names.
- **Attempt** = one row in `ota.optimizer_attempts` = one optimizer run for a search, package, or checkout.
- **Anchor** (also "master") = the attempt's candidate with `reprice_type='original'` and `reprice_index='master_0'`. `master_1..N` are reprice variants. `reprice_index` is a **string**, never an integer.
- **Supplier payload** = the content source's raw response, read from `optimizer_logs` (see "Reading `optimizer_logs`").

## What it does

- Takes supplier fare payloads and forms candidates. Ranks and tags them, picks a winner.
- Can **reroute a booking to a different content source** during `pre-air-booker` optimization (see [`booking-flow.md`](booking-flow.md)).
- Reprices from the anchor. The anchor is ground truth when the supplier payload is not readable.

## Normal vs abnormal

- **Normal:** supplier returns a fare, a candidate is formed, ranked, and the intended supplier books.
- **Abnormal signals:** a supplier-eligible fare ends up `Unbookable` / `Unsalable`; a fare matching the anchor itinerary is tagged `Unmatchable` / `No matching fares found`; the booked `gds` differs from what the user picked (reroute); a multi-ticket attempt priced one leg but dropped the other.
- NDCONE `Incalculable` + `Exception:No fares found` after a readable `shopping/flight` with offers is often our matcher, not Condor empty. Open the shopping log before treating the tag as supplier truth (see [`content-sources.md`](content-sources.md), [Trello #3199](https://trello.com/c/abmelgzt)).

## Known behaviors that look like bugs but are not

- **`reprice_and_drop` is intentional.** Shadow repricing: the pipeline runs against an existing candidate to benchmark what the source would have charged, then drops the result by design (genesis `NewOptimizerRepricer.php`). It ends `Unsalable` with `UnsalableRepricerException("Reprice and Drop")` even on a clean itinerary. Not a matching failure. Exclude from leak analysis unless the user asks.
- **`Blocked by Supplier Rules: %`** is affiliate-tier policy filtering (business policy, not a matching mistake). Excluded from matching analysis by default. Re-include only when the user asks for policy exceptions.
- **Optimizer reroute is by design.** It maximizes margin / bookability. It is a bug only when a content-source pin was supposed to hold (QA pins flip "Disable Optimizer/Repricer = Yes"; a booking that ignored the pin is the defect).
- **NDCONE Condor-only one-ways can still match** when Condor puts a carrier code (`DE`) in `marketingCarrierRBDCode`. That is the old payload shape (last seen 2026-07-30), not a different parser. Interline (e.g. B6+DE) fails once that field is a booking class letter.
- **Porter (PD) Navitaire-ndc can legally show one office.** Same-currency `NAVPDCAD` / `NAVPDUSD` is added only when `canOptimizeToNavitaireNdc()` is true. A fare-family `Upgrade` attempt-tag turns that gate off for PD. Multi-currency still adds the other office. Result: one Navitaire-ndc contestant (usually `NAVPDUSD` for a CAD user). Confirmed 2026-08-20 on https://reservations.voyagesalacarte.ca/optimizer/attempt/15854471/306590741.
- **LCC carriers send no fare basis.** F8, F9, VB, VZ, TR, G4, XY, A1 and similar return `fareBasisCode=[]`. The supplier is correct. If our package assembly rejects the fare for an empty fare basis, the defect is ours.
- **Codeshare flight numbers differ.** The anchor may carry marketing `UA9929` while the supplier returns operating `SN501`. Compare on operating carrier + operating flight number before declaring a supplier gap.

## Key columns and tags (MySQL `ota`)

Column meaning lives in the db-docs. Only the debugging-relevant points are here.

- `optimizer_candidates.attempt_id` links to `optimizer_attempts.id`. `parent_id` is often NULL on reprice traffic; use the anchor-by-attempt rule (`master_0`) when it is.
- `candidacy` is eligibility (`Eligible`, `Saver`, `Unbookable`, `Unmatchable`, `Incalculable`, `Unsalable`, ...). A supplier-eligible fare ending `Unbookable` is a classic mistake signal.
- **Default match key** to compare a candidate with a fare or with the anchor: `validating_carrier`, ordered `flight_numbers`, `booking_classes`, `cabin_codes`, plus `fare_bases`. Segment arrays align by position. Uppercase and trim before comparing. Check `total` last.
- Price columns: `base`, `tax`, `markup`, `merchant_fee`, `supplier_fee`, `commission`, `total`. If the supplier currency differs from the candidate currency, compare on `base` and verify the conversion first.
- Stable tag names (`optimizer_tags`): `Exception` (error text in `value`), `Demoted`, `Promoted` (reason in `value`), `Risky`, `Downgrade`, `MixedFareType`, `AlternativeMarketingCarrier` (flags), `MultiTicketPart` (`master` / `slave`). Always join tags by name, not by id. Add new stable names to `optimizer_tags.md`.
- `optimizer_attempt_tags` holds attempt-level tags (`VccRequired`, `Seats`, `Upgrade`).
- `optimizer_attempt_bookings` links a winning candidate to its booking. Only winners have a row (LEFT JOIN).
- Resolve inputs to `attempt_id`: `search_id` and `package_id` / `checkout_id` are columns on `optimizer_attempts`; `booking_id` goes through `optimizer_attempt_bookings` -> candidate -> attempt. Several attempts can share one `search_id` (reprice retries). Start with the newest. Default window 72 hours when the user gives none.
- Do not select `optimizer_attempts.package`. It is a large JSON blob.

### Boundedness (mandatory)

- `optimizer_candidates` has ~45M rows and `optimizer_candidate_tags` ~42M. Always bound on `attempt_id` or a `created_at` window of a few hours before any join.
- Name the slice once in a leading CTE (attempt set or time window). Join tags in a second CTE driven from that slice. Never join `optimizer_candidate_tags` in the outer SELECT.
- Reuse the canonical CTE in [`optimizer_join_pattern.md`](../../db_access/db-docs/mysql/optimizer_join_pattern.md) (attempt -> candidates -> booking link -> tag roll-up). Do not rewrite it.
- Never run `find {}` on `optimizer_logs`. Anchor on `transaction_id` plus a `context` filter. Mongo mechanics: `../../db_access/references/mongodb_query_mechanics.md`.
- Do not redefine the anchor between queries inside one investigation.

## Mistake classes

Judge each candidate against evidence in this order: supplier payload, else the anchor.

**Evidence rule.** The supplier payload beats SQL state. When MySQL tags and the payload disagree, flag it as **"SQL vs Mongo mismatch"** and base the root cause on the payload. Never reclassify silently. Typical shapes: tag `no_availability` but the supplier returned the fare cleanly; candidate `Eligible` but the supplier rejected it. When the payload is not readable (the usual case), the anchor is ground truth.

| Class | Meaning |
|-------|---------|
| **Missed** | The supplier returned a fare (match key K) and no candidate carries K. Anchor-only attempts where every reprice pass is `Incalculable` / `No fares found` are usually normal supplier attrition; flag, and check prevalence before escalating. An attempt with no anchor row is itself an anomaly (`NO_ANCHOR`). |
| **Fare-basis mismatch (anchor-relative)** | Non-original candidate has the same carrier, ordered flight numbers, booking classes, cabin codes and `total` (within 0.02) as the anchor, but different `fare_bases` / `fare_families`. Often `Unmatchable` + `No matching fares found`. The supplier returns different fare-basis codes for the same itinerary across accounts, products, or visibility (published vs private). Strict fare-basis equality in the reprice match key drops fares that belong in the ranking. If the itinerary differs, it is Missed, not this class. |
| **Wrong tag** | A tag contradicts the evidence. Report the tag name and its `value`; the value is what a fix targets. Examples: `Exception` on a clean fare; `Demoted` on an eligible or cheapest fare; `Promoted` with no promotion signal; `Risky` with a clean response; `Downgrade` when cabin / class match the request; `MultiTicketPart` value that disagrees with the segment layout. |
| **Price / rank / candidacy mismatch** | `total`, `base`, `tax` differ from the payload by more than 0.02 in candidate currency. Systematic positive delta suggests a missing markup step or double fee; negative suggests a dropped fee or leaked discount; small symmetric deltas are rounding or FX. Rank is wrong only when no tag explains it. Candidacy `Unbookable` on an eligible supplier fare counts as one finding (wrong tag and candidacy mismatch together). |

Edge cases: several candidates sharing a key, pick the one whose `reprice_type` / `reprice_index` matches the log pass. Duplicate supplier fares count once.

## Multi-ticket attempts (per-leg rules)

- A multi-ticket (SMT) attempt has one operand per leg: `Reprice[master_N]` (outbound, first ticket) and `Reprice[slave_N]` (inbound, second ticket). Each leg has its own supplier search call and its own `Reprice <type>+<ACCOUNT>+<visibility>` wrapper with its own exception.
- Classify every leg on its own. Never pick one operand per attempt (for example `find_one` sorted by date). That hides the other leg and gives the wrong cause.
- An attempt is a **pure our-side leak** only if every leg shows the our-side pattern. If any leg's supplier response lacks the anchor flight, the attempt is supplier-dominated and our gate is secondary.

### Per-leg buckets for no-contestant attempts

Apply to attempts with candidacy `Incalculable`, or `Unsalable` that is not `reprice_and_drop`.

| Bucket | Meaning | Side |
|--------|---------|------|
| `supplier_0_routings` | Supplier returned zero routings for the leg. | Supplier |
| `supplier_gap` | Supplier returned routings, but none contains the anchor flight(s). Substitutes only. | Supplier |
| `supplier_returned_with_fb` | Supplier returned the anchor flight with a populated fare basis, yet the wrapper threw `IncalculableRepricerException` / `AdmissibleRepricerException`. Usually a predicate mismatch (fare basis, booking class, cabin) in package assembly. | Our side |
| `pure_our_side_leak_fb_empty` | Supplier returned all anchor flights, but every one has an empty fare basis. Our package assembly rejects it before the matcher. Typical for LCCs. Fixable by relaxing the fare-basis gate. | Our side |

Attempt verdict: `supplier_dominated` (any supplier-side leg), `pure_our_side_leak` (every leg `pure_our_side_leak_fb_empty`), `our_side_mixed` (all legs our-side, both kinds present), `other` (missing logs, operand without flight numbers).

Diagnostic-only edge states: no operand log (the reprice stage or logger did not fire), operand log but no supplier call (short-circuit before the supplier), operand without `flightNumbers` (empty anchor fingerprint).

## Reading `optimizer_logs`

- **Join key:** `optimizer_logs.transaction_id` = `optimizer_attempts.search_id` (confirmed 2026-04-21 on DTT reprice traffic). Same convention as `debug_logs.transaction_id` = `search_hash`. If a source uses another mapping, update `optimizer_logs.md` first.
- **`context` is the anchor for each step.** Use equality when the string is known. Per-source strings are in `optimizer_logs.md` (per-content-source context hints). There is no flat top-level `fares[]`.
- **Two payload shapes.** (1) Top-level content: the body sits in top-level fields (`Request`, `Response`, `0`, `1`, `exception`, `post`, `get`, `packages`). These are often JSON strings; use `json.loads`. Seen on unififi and pkfare. (2) `meta.*` placeholders (`{"type":"string.json"}` / `{"type":"composite"}`): the body is out of band and visible only through the permalink. The context's presence still shows which step fired and when. If unsure, dump one document's top-level keys first.
- **Per-leg context families** (names follow the source): `{Source}::Reprice-original-operands` (operand JSON in field `1`, `_scopes` gives `master_N` / `slave_N`), `{source}-api[{ACCOUNT}] search` (supplier request / response), `Reprice <type>+{ACCOUNT}+{visibility}` (wrapper with the thrown exception). Pair them by chronological index within the attempt.
- **Scope hygiene.** One `search_id` can hold several passes (original vs reprice); cite the log that matches the candidate's `reprice_type` / `reprice_index`. Keep only the audited content source's evidence. The collection is capped, so old events may be gone.
- **Date-bounded aggregations** cannot use `ISODate(...)` in the CLI JSON. Use mongosh or a short `pymongo` script.
- **Permalink shape:** `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>` (`_id` as 24-char hex; same path as `debug_logs`).
- **NDCONE.** Condor `shopping/flight` returns one-way offers; the Builder builds outbound x inbound pairs. An itinerary mismatch in `matchingPackage()` becomes an empty collection and `IncalculableRepricerException("No fares found")`, not `Unmatchable`. Case booking `306373201` (2026-08-18): `buildSegment()` copied `marketingCarrierRBDCode` (`Y`) into the marketing carrier, so the built flight was `Y552` instead of `B6552`.
- Some matching-event payloads stringify inner arrays (`packages`). Guard with `json.loads(raw or "[]")` and a dict check.

## Where to look (evidence map)

- **MySQL `ota`:** `optimizer_candidates`, `optimizer_attempts`, `optimizer_candidate_tags` + `optimizer_tags`, `optimizer_attempt_tags`, `optimizer_attempt_bookings`.
- **MongoDB `ota.optimizer_logs`:** supplier evidence per `context` (see above).
- Full evidence map: [`observability.md`](observability.md).
