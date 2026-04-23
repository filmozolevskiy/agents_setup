## optimizer_attempt_bookings

**Database:** `ota`
**Purpose:** Junction table that links a successful `optimizer_candidates`
row (the "winning" contestant) to the `bookings` row it produced.

**Status:** **Stub** — created to support the `optimizer-analysis` skill.
Column types and row counts were not verified during creation (DB access
unavailable). Fill in and expand during the first optimizer investigation
that touches this table; follow the template in
[`db-docs/README.md`](../README.md).

| Column | Type | Description |
|--------|------|-------------|
| `candidate_id` | `bigint` (to verify) | FK to `optimizer_candidates.id` |
| `booking_id` | `bigint` (to verify) | FK to `bookings.id` |
| `created_at` | `timestamp` (to verify) | When the link was recorded |

**Key relationships:**
- Joins to `optimizer_candidates` on `candidate_id`
- Joins to `bookings` on `booking_id`

**Common queries:**
```sql
-- Find the attempt and candidate behind a booking
SELECT oa.id AS attempt_id, oab.candidate_id, oa.search_id, oa.created_at
FROM ota.optimizer_attempt_bookings oab
JOIN ota.optimizer_candidates       oc ON oc.id = oab.candidate_id
JOIN ota.optimizer_attempts         oa ON oa.id = oc.attempt_id
WHERE oab.booking_id = {booking_id};

-- List bookings produced by a specific attempt
SELECT oab.candidate_id, oab.booking_id
FROM ota.optimizer_attempt_bookings oab
JOIN ota.optimizer_candidates oc ON oc.id = oab.candidate_id
WHERE oc.attempt_id = {attempt_id};
```

**Query guidance:**
- Use this table to reverse-resolve `booking_id` → `attempt_id` for the
  `optimizer-analysis` `by_booking` SQL template.
- Always pair with a date bound on `optimizer_candidates.created_at` when
  joining, since the candidates table is large.

**Notes:**
- Used by the `optimizer-analysis` skill
  ([`.cursor/skills/optimizer_analysis/SKILL.md`](../../.cursor/skills/optimizer_analysis/SKILL.md)).
- Columns and types need verification — expand this doc when you next
  query the table with live DB access.
