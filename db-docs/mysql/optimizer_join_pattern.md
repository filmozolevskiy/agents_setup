## Optimizer join pattern (5-table canonical query)

Cross-reference for the five tables that together describe one Optimizer run: **`optimizer_attempts`**, **`optimizer_candidates`**, **`optimizer_attempt_bookings`**, **`optimizer_candidate_tags`**, **`optimizer_tags`**. This is the read-side shape; it is used by the `optimizer_analysis` skill and ad-hoc audits.

All tables live in `ota`. Per-table detail is in the individual docs in this folder.

### How the five tables fit together

```
                     optimizer_attempts  (1 row per Optimizer execution — search/package/checkout context,
                     id ◄───────────┐    anchor fare: currency, carrier, totals, fare_bases, …)
                                    │
                                    │ attempt_id
                                    │
                     optimizer_candidates  (1 row per fare option the Optimizer built — reprice variants,
                     id ◄────┬──────┘      multi-ticket operands, pricing breakdown, candidacy, rank)
                             │     └─ parent_id ─► optimizer_candidates.id   (anchor/original; self-join)
                             │
               candidate_id  │     ┌──────────────── attempt_id ───────────► optimizer_attempts.id
                             │     │                                         (denormalised shortcut)
                             ▼     ▼
                     optimizer_attempt_bookings  (winning candidate → booking; zero or one per attempt)
                     booking_id ──► bookings.id

                             ▲
               candidate_id  │
                             │
                     optimizer_candidate_tags  (many key-value tags per candidate)
                     tag_id ──► optimizer_tags.id  (15-row catalog: Exception, Demoted, Promoted, …)
```

### Join keys — cheat sheet

| From | To | Join |
|------|----|------|
| `optimizer_candidates oc` | `optimizer_attempts oa` | `oc.attempt_id = oa.id` |
| `optimizer_candidates oc` | `optimizer_candidates parent` | `parent.id = oc.parent_id` (self-join to the anchor/original) |
| `optimizer_candidates oc` | `optimizer_attempt_bookings oab` | `oab.candidate_id = oc.id` (**LEFT JOIN** — only winners have a row) |
| `optimizer_attempts oa`   | `optimizer_attempt_bookings oab` | `oab.attempt_id = oa.id` (shortcut: attempt → booking without candidates) |
| `optimizer_candidates oc` | `optimizer_candidate_tags oct` | `oct.candidate_id = oc.id` |
| `optimizer_candidate_tags oct` | `optimizer_tags ot` | `ot.id = oct.tag_id` |

### Canonical query — all candidates for a window, with booking link + tag roll-up

This is the working template. Scope is driven by `optimizer_candidates.created_at` (or a single `attempt_id`) — **always** narrow here first; `optimizer_candidates` and `optimizer_candidate_tags` are large.

```sql
WITH base AS (
    SELECT
        oc.created_at,
        oc.attempt_id,
        oc.id          AS contestant_id,
        oc.parent_id,
        oc.reprice_type,
        oc.reprice_index,
        oc.rank,
        oc.candidacy,
        oc.gds,
        oc.gds_account_id,
        oc.currency,
        oc.fare_type,
        oc.validating_carrier,
        oc.pricing_options,
        oc.flight_numbers,
        oc.commission_trip_id,
        oc.base, oc.tax, oc.markup, oc.total,
        oc.commission, oc.merchant_fee, oc.supplier_fee,
        oc.revenue, oc.dropnet_revenue, oc.segment_revenue,
        oc.booking_classes, oc.cabin_codes,
        oc.fare_bases, oc.fare_families,
        oa.search_id, oa.package_id, oa.checkout_id,
        oa.trip_type, oa.affiliate_id, oa.target_id,
        oab.booking_id
    FROM ota.optimizer_candidates  oc
    JOIN ota.optimizer_attempts    oa  ON oa.id  = oc.attempt_id
    LEFT JOIN ota.optimizer_attempt_bookings oab ON oab.candidate_id = oc.id
    WHERE oc.created_at > NOW() - INTERVAL 2 HOUR
    --   AND oc.attempt_id = :attempt_id
),
tags_agg AS (
    SELECT
        oct.candidate_id,

        /* Keep this mapping in sync with db-docs/mysql/optimizer_tags.md */
        GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Exception'       THEN oct.value END
                     ORDER BY oct.value SEPARATOR ', ') AS exception_values,
        GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Demoted'         THEN oct.value END
                     ORDER BY oct.value SEPARATOR ', ') AS is_demoted,
        GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Promoted'        THEN oct.value END
                     ORDER BY oct.value SEPARATOR ', ') AS is_promoted,
        GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'MultiTicketPart' THEN oct.value END
                     ORDER BY oct.value SEPARATOR ', ') AS multiticket_part_values,
        MAX(CASE WHEN ot.name = 'Downgrade'                   THEN 1 ELSE 0 END) AS is_downgrade,
        MAX(CASE WHEN ot.name = 'MixedFareType'               THEN 1 ELSE 0 END) AS is_mixed_fare_type,
        MAX(CASE WHEN ot.name = 'AlternativeMarketingCarrier' THEN 1 ELSE 0 END) AS is_alternative_marketing_carrier,
        MAX(CASE WHEN ot.name = 'Risky'                       THEN 1 ELSE 0 END) AS is_risky,

        /* Debug aid: flat list of every tag:value on the candidate */
        GROUP_CONCAT(DISTINCT CONCAT(ot.name, ':', COALESCE(oct.value, ''))
                     ORDER BY ot.name, oct.value SEPARATOR ', ') AS tag_pairs
    FROM base b
    JOIN ota.optimizer_candidate_tags oct ON oct.candidate_id = b.contestant_id
    JOIN ota.optimizer_tags           ot  ON ot.id            = oct.tag_id
    GROUP BY b.contestant_id
)
SELECT b.*, tags.*
FROM base b
LEFT JOIN tags_agg tags ON tags.candidate_id = b.contestant_id;
```

### Why it is shaped this way

1. **Narrow first, join second.** The `base` CTE collapses the attempt context (`oa.*`) and the winning-booking link (`oab.booking_id`) next to each candidate and is the only place where the candidate row-count is bounded. Every other join piggybacks on `b.contestant_id`.
2. **`LEFT JOIN optimizer_attempt_bookings`.** Most candidates never win; inner-joining here would drop everything except the single booked candidate per attempt.
3. **Tag roll-up in its own CTE.** `optimizer_candidate_tags` is many-to-many per candidate — the same candidate can carry multiple `Exception` rows. Aggregating in a second CTE keeps `base` flat and lets each tag become a single column on the final row (`GROUP_CONCAT DISTINCT … SEPARATOR ', '` for string-valued tags, `MAX(CASE …)` for flag-style tags).
4. **Join tag catalog by name, not id.** `optimizer_tags.id` values are non-sequential and new tags get added. Always resolve via `ot.name = 'Exception'` etc. Keep the mapping in sync with `optimizer_tags.md`.
5. **Anchor recovery uses `parent_id`.** When you need the original fare a reprice variant was built from, self-join `optimizer_candidates` on `parent.id = oc.parent_id`. This is the reconciliation ground truth for reprice audits.
6. **Multi-ticket awareness.** One attempt emits one candidate per `Reprice[master_N]` / `Reprice[slave_N]` operand; iterate all operands via `MultiTicketPart` tag values rather than collapsing on `attempt_id`.

### Scoping rules (performance)

- `optimizer_candidates` (~45M rows, ~7 GB) — must be narrowed by `attempt_id` **or** a recent `created_at` window before any other join.
- `optimizer_candidate_tags` (~42M rows, ~3.9 GB) — always driven from a pre-filtered candidate set. Never scan standalone.
- `optimizer_attempts` (~534K) and `optimizer_attempt_bookings` (~573K) are small; join order doesn't matter.
- `optimizer_tags` is 15 rows — free.

### Related

- Skills: `.cursor/skills/optimizer_analysis/SKILL.md`, including `references/matching_audit_scan.md` and `references/mistake_classification.md`.
- Per-table docs: `optimizer_candidates.md`, `optimizer_attempts.md`, `optimizer_attempt_bookings.md`, `optimizer_candidate_tags.md`, `optimizer_tags.md`.
- `bookings` (`bookings.md`) is the far side of `optimizer_attempt_bookings.booking_id`.
