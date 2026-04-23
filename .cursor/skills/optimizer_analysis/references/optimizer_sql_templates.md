# Optimizer SQL templates

Parameterized, index-friendly variants of the canonical contestants-with-tags
query. Pick the template that matches the user's input, replace `{placeholders}`,
and run via `scripts/mysql_query.py`:

```bash
set -a && source .env && set +a && python3 scripts/mysql_query.py query "<SQL>"
```

All templates share the same two-CTE shape (`base` → `tags_agg`). Only the
`WHERE` on `base` changes. `tags_agg` is always joined to `base.contestant_id`
so the 39M-row `optimizer_candidate_tags` table is **never** scanned
unbounded.

## Mandatory guardrails

- **Always bound `oc.created_at`.** `optimizer_candidates` is ~45M rows (see
  [`db-docs/mysql/optimizer_candidates.md`](../../../../db-docs/mysql/optimizer_candidates.md)).
  Even when filtering by `attempt_id` the `created_at` bound is a cheap
  safety net.
- **Keep `tags_agg` scoped to the narrow `base` CTE.** Do not join
  `optimizer_candidate_tags` in the main `SELECT`; it inflates row count and
  breaks index usage.
- **Do not fetch `oa.package`** unless the user explicitly asks — it is a
  large JSON blob (see `db-docs/mysql/optimizer_attempts.md`).
- **Exclude routine policy filtering by default.** Drop
  `Exception` values matching `Blocked by Supplier Rules%` (and siblings
  — see [`SKILL.md` → Default scope](../SKILL.md#default-scope--routine-policy-exclusions))
  from anomaly counts. Re-include only when the user explicitly asks to
  see policy filtering (e.g. "include supplier rules", "include policy
  exceptions").
- **`reprice_index` is a string.** Values look like `master_0` (the
  attempt's anchor, `reprice_type='original'`), `master_1`,
  `master_2`, … `master_N` (reprice variants). Never compare it as an
  integer.

## Tag map (keep in sync with `optimizer_tags`)

Stable tag names currently handled below:

- `Exception` — carries an error / rejection string value.
- `Demoted` — value explains the demotion reason.
- `Promoted` — value explains the promotion reason.
- `MultiTicketPart` — value = `master` / `slave`.
- `Downgrade` — boolean presence.
- `MixedFareType` — boolean presence.
- `AlternativeMarketingCarrier` — boolean presence.
- `Risky` — boolean presence.

If a new stable tag surfaces during an investigation, extend this list and
update [`db-docs/mysql/optimizer_tags.md`](../../../../db-docs/mysql/optimizer_tags.md).
A full `tag_pairs` dump is included as a `-- debug` line for first-run
troubleshooting; comment it in only when the named columns are insufficient.

## Template: `by_attempt`

**Use when** the user supplies an `attempt_id` (or anything that resolves to
one — e.g. `search_id` with a `LIMIT 1`, `booking_id` via
`optimizer_attempt_bookings`).

```sql
WITH base AS (
  SELECT
    oc.id            AS contestant_id,
    oc.created_at,
    oc.attempt_id,
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
    oc.base,
    oc.tax,
    oc.markup,
    oc.total,
    oc.commission,
    oc.merchant_fee,
    oc.supplier_fee,
    oc.revenue,
    oc.dropnet_revenue,
    oc.segment_revenue,
    oc.booking_classes,
    oc.cabin_codes,
    oc.fare_bases,
    oc.fare_families,
    oa.search_id,
    oa.package_id,
    oa.checkout_id,
    oa.trip_type,
    oa.affiliate_id,
    oa.target_id,
    oab.booking_id
  FROM ota.optimizer_candidates oc
  JOIN ota.optimizer_attempts oa
    ON oc.attempt_id = oa.id
  LEFT JOIN ota.optimizer_attempt_bookings oab
    ON oab.candidate_id = oc.id
  WHERE oc.attempt_id = {attempt_id}
    AND oc.created_at > NOW() - INTERVAL {lookback_hours} HOUR   -- default 24
),
tags_agg AS (
  SELECT
    oct.candidate_id,
    GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Exception'       THEN oct.value END
                 ORDER BY oct.value SEPARATOR ', ') AS exception_values,
    GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Demoted'         THEN oct.value END
                 ORDER BY oct.value SEPARATOR ', ') AS is_demoted,
    GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Promoted'        THEN oct.value END
                 ORDER BY oct.value SEPARATOR ', ') AS is_promoted,
    GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'MultiTicketPart' THEN oct.value END
                 ORDER BY oct.value SEPARATOR ', ') AS multiticket_part_values,
    MAX(ot.name = 'Downgrade')                   AS is_downgrade,
    MAX(ot.name = 'MixedFareType')               AS is_mixed_fare_type,
    MAX(ot.name = 'AlternativeMarketingCarrier') AS is_alt_marketing_carrier,
    MAX(ot.name = 'Risky')                       AS is_risky
    -- debug:
    -- , GROUP_CONCAT(DISTINCT CONCAT(ot.name, ':', COALESCE(oct.value, ''))
    --               ORDER BY ot.name, oct.value SEPARATOR ', ') AS tag_pairs
  FROM base b
  JOIN ota.optimizer_candidate_tags oct ON oct.candidate_id = b.contestant_id
  JOIN ota.optimizer_tags           ot  ON ot.id            = oct.tag_id
  GROUP BY oct.candidate_id
)
SELECT b.*,
       t.exception_values,
       t.is_demoted,
       t.is_promoted,
       t.multiticket_part_values,
       t.is_downgrade,
       t.is_mixed_fare_type,
       t.is_alt_marketing_carrier,
       t.is_risky
FROM base b
LEFT JOIN tags_agg t ON t.candidate_id = b.contestant_id
ORDER BY b.rank, b.contestant_id;
```

## Template: `by_search`

**Use when** the user supplies a `search_id` or when `search_id` is known but
the attempt window is ambiguous (e.g. retried optimizer runs for the same
search). Returns contestants across **all** attempts that share the
`search_id` in the window.

Replace the `WHERE` clause on `base`:

```sql
  WHERE oa.search_id = '{search_id}'
    AND oc.created_at >= '{start_datetime}'
    AND oc.created_at <  '{end_datetime}'
```

## Template: `by_booking`

**Use when** the user supplies a `booking_id`. The attempt / candidate are
discovered through `optimizer_attempt_bookings`.

Replace the `WHERE` clause on `base`:

```sql
  WHERE oab.booking_id = {booking_id}
    AND oc.created_at >= '{start_datetime}'
    AND oc.created_at <  '{end_datetime}'
```

For the date window pick a conservative range around
`bookings.date_created` (e.g. 24h before to 24h after) — the booking row
itself lives in [`db-docs/mysql/bookings.md`](../../../../db-docs/mysql/bookings.md).

## Template: `by_gds_window`

**Use when** the user asks for a broad scan over a content source + time
window (Workflow B). Returns attempts with per-attempt aggregates so you can
cheaply flag anomalies before drilling into logs.

**Default policy exclusion:** the inner `tags_agg` filters out `Exception`
values matching `Blocked by Supplier Rules%` so the aggregate
`exception_count` reflects real anomalies, not affiliate-tier policy
filtering. Flip the sentinel `{include_supplier_rules}` to `TRUE` only when
the user asks to include policy exceptions.

```sql
WITH attempt_rollup AS (
  SELECT
    oc.attempt_id,
    MAX(oc.gds)                                    AS gds,
    MAX(oa.search_id)                              AS search_id,
    MAX(oa.package_id)                             AS package_id,
    MAX(oa.checkout_id)                            AS checkout_id,
    MAX(oa.trip_type)                              AS trip_type,
    MIN(oc.created_at)                             AS first_candidate_at,
    MAX(oc.created_at)                             AS last_candidate_at,
    COUNT(*)                                       AS candidate_count,
    SUM(oc.candidacy = 'Unbookable')               AS unbookable_count,
    SUM(CASE WHEN t.is_risky          THEN 1 ELSE 0 END) AS risky_count,
    SUM(CASE WHEN t.is_demoted IS NOT NULL AND t.is_demoted <> '' THEN 1 ELSE 0 END) AS demoted_count,
    SUM(CASE WHEN t.exception_values IS NOT NULL AND t.exception_values <> '' THEN 1 ELSE 0 END) AS exception_count
  FROM ota.optimizer_candidates oc
  JOIN ota.optimizer_attempts oa ON oa.id = oc.attempt_id
  LEFT JOIN (
    SELECT
      oct.candidate_id,
      MAX(ot.name = 'Risky') AS is_risky,
      GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Demoted' THEN oct.value END
                   ORDER BY oct.value SEPARATOR ', ') AS is_demoted,
      GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Exception'
                              /* ignore routine policy filtering by default */
                              AND ({include_supplier_rules} = TRUE
                                   OR oct.value NOT LIKE 'Blocked by Supplier Rules%')
                              THEN oct.value END
                   ORDER BY oct.value SEPARATOR ', ') AS exception_values
    FROM ota.optimizer_candidate_tags oct
    JOIN ota.optimizer_tags ot ON ot.id = oct.tag_id
    WHERE oct.created_at >= '{start_datetime}'
      AND oct.created_at <  '{end_datetime}'
    GROUP BY oct.candidate_id
  ) t ON t.candidate_id = oc.id
  WHERE oc.gds = '{gds}'
    AND oc.created_at >= '{start_datetime}'
    AND oc.created_at <  '{end_datetime}'
  GROUP BY oc.attempt_id
)
SELECT *
FROM attempt_rollup
WHERE
  /* heuristic anomalies — tune per investigation */
  candidate_count <= 1                                    -- suspiciously few contestants
  OR exception_count = candidate_count                    -- every candidate had a non-policy Exception
  OR unbookable_count = candidate_count                   -- everything ended up Unbookable
  OR demoted_count >= candidate_count / 2                 -- majority demoted
ORDER BY last_candidate_at DESC
LIMIT 500;
```

Tune the heuristic thresholds per question; the structure matters more than
the numbers. Typical next step is to feed `attempt_id` (or
`search_id` as `transaction_id`) into the Mongo `$in` query described in
[`optimizer_logs_patterns.md`](optimizer_logs_patterns.md).

## Template: `anchor_diff`

**Use when** investigating a matching mistake on a reprice candidate and
the supplier payload is not readable (the common case — `meta.*` fields
in `optimizer_logs` are placeholders). Pivots the candidate set for one
attempt around the anchor row (`reprice_type = 'original'` /
`reprice_index = 'master_0'`) and shows where each reprice variant
diverges. Surfaces the **fare-basis mismatch** pattern
([`mistake_classification.md` → bucket 2a](mistake_classification.md#bucket-2a--fare-basis-mismatch-anchor-relative))
directly.

```sql
WITH base AS (
  SELECT
    oc.id AS candidate_id,
    oc.reprice_type,
    oc.reprice_index,
    oc.candidacy,
    oc.gds,
    oc.gds_account_id,
    oc.currency,
    oc.validating_carrier,
    oc.total,
    oc.flight_numbers,
    oc.booking_classes,
    oc.cabin_codes,
    oc.fare_bases
  FROM ota.optimizer_candidates oc
  WHERE oc.attempt_id = {attempt_id}
    AND oc.created_at > NOW() - INTERVAL {lookback_hours} HOUR
),
anchor AS (
  SELECT *
  FROM base
  WHERE reprice_type = 'original'
  LIMIT 1
)
SELECT
  b.reprice_index,
  b.reprice_type,
  b.candidate_id,
  b.gds,
  b.gds_account_id,
  b.candidacy,
  b.total                                          AS reprice_total,
  a.total                                          AS anchor_total,
  ROUND(b.total - a.total, 2)                      AS total_delta,
  (b.flight_numbers  = a.flight_numbers)           AS flights_match,
  (b.booking_classes = a.booking_classes)          AS classes_match,
  (b.cabin_codes     = a.cabin_codes)              AS cabins_match,
  (b.validating_carrier = a.validating_carrier)    AS carrier_match,
  (b.fare_bases      = a.fare_bases)               AS fare_bases_match,
  b.fare_bases                                     AS reprice_fare_bases,
  a.fare_bases                                     AS anchor_fare_bases
FROM base b
CROSS JOIN anchor a
WHERE b.reprice_type <> 'original'
ORDER BY b.reprice_index;
```

Rows where every `*_match` flag is `1` **except** `fare_bases_match = 0`
are the **FARE_BASIS_MISMATCH** signature. Pair with the tag aggregation
from `by_attempt` to confirm the Exception / candidacy state.

## Resolving inputs to `attempt_id`

When the user gives something other than an `attempt_id`:

```sql
-- search_id  →  attempt_id list
SELECT id AS attempt_id, created_at, gds, trip_type
FROM ota.optimizer_attempts
WHERE search_id = '{search_id}'
  AND created_at >= '{start_datetime}'
ORDER BY created_at DESC;

-- package_id / checkout_id  →  attempt_id
SELECT id AS attempt_id, created_at, search_id, gds
FROM ota.optimizer_attempts
WHERE package_id = '{package_id}'   -- or: checkout_id = '{checkout_id}'
  AND created_at >= '{start_datetime}'
ORDER BY created_at DESC;

-- booking_id  →  attempt_id
SELECT oa.id AS attempt_id, oab.candidate_id, oa.search_id, oa.created_at
FROM ota.optimizer_attempt_bookings oab
JOIN ota.optimizer_candidates       oc ON oc.id = oab.candidate_id
JOIN ota.optimizer_attempts         oa ON oa.id = oc.attempt_id
WHERE oab.booking_id = {booking_id};
```

If the user cannot provide a time window, default to **last 72h**. Document
any wider fallback in the final report so the reader knows the bound.
