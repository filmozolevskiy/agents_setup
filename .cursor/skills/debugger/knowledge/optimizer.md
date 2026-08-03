# Optimizer

How the optimizer / repricer turns a content source's raw fare payload into ranked, tagged contestants, and how it can change which supplier a booking lands on. Behavior only — full matching-correctness audits belong to the `optimizer` skill.

_Schemas: `../../db_access/db-docs/mysql/optimizer_*.md`, `../../db_access/db-docs/mongodb/optimizer_logs.md`. Seeded 2026-07-30 from the optimizer skill; extend via the maintenance loop._

## What it does

- Takes supplier fare payloads and forms **candidates** (schema term) a.k.a. **contestants** (user term) — rows in `ota.optimizer_candidates`. One **attempt** (`ota.optimizer_attempts`) is one optimizer run for a search, package, or checkout.
- Ranks and tags candidates, picks a winner, and can **reroute a booking to a different content source** during `pre-air-booker` optimization (see [`booking-flow.md`](booking-flow.md)).
- Reprices: the **anchor** candidate is `reprice_type='original'` / `reprice_index='master_0'`; `master_1..N` are reprice variants. The anchor is ground truth when the supplier payload is not directly readable.

## Normal vs abnormal

- **Normal:** supplier returns a fare, a candidate is formed, ranked, and the intended supplier books.
- **Abnormal signals:** a supplier-eligible fare ends up `Unbookable` / `Unsalable`; a fare matching the anchor itinerary is tagged `Unmatchable` / `No matching fares found`; the booked `gds` differs from what the user picked (reroute); a multi-ticket attempt priced one leg (`master`) but dropped the other (`slave`).

## Known behaviors that look like bugs but are not

- **`reprice_and_drop` is intentional.** These are shadow repricings: the pipeline runs against an existing candidate to benchmark what the source would have charged, then drops the result by design (genesis `NewOptimizerRepricer.php`). They end up `Unsalable` with `UnsalableRepricerException("Reprice and Drop")` even on a clean itinerary. Not a matching failure. Exclude from leak audits unless the user asks.
- **`Blocked by Supplier Rules: %`** — affiliate-tier policy filtering (business policy, not a matching mistake). Excluded from matching audits by default.
- **Optimizer reroute is by design** — it maximizes margin / bookability. It is only a bug when a content-source pin was supposed to hold (QA pins flip "Disable Optimizer/Repricer = Yes"; a booking that ignored the pin is the defect).

## Where to look (evidence map)

- **MySQL `ota`:** `optimizer_candidates` (~45M rows — always bound on `attempt_id` or a tight `created_at` window), `optimizer_attempts`, `optimizer_candidate_tags` + `optimizer_tags`, `optimizer_attempt_bookings` (candidate → booking link).
- **MongoDB `ota.optimizer_logs`:** context-specific supplier evidence (`{Source}::Reprice-*`). Join key `transaction_id` = `optimizer_attempts.search_id`. `meta.*` leaves are usually placeholders — confirm content via permalink.
- Full evidence map: [`observability.md`](observability.md).

## Hand off

Any matching-correctness audit (leak scan, per-attempt drill-down, mistagged fare) → run [`../../optimizer/SKILL.md`](../../optimizer/SKILL.md). It owns the query discipline (CTE shape, anchor-as-ground-truth), the multi-ticket per-leg classification, and the report format. This file only orients.
