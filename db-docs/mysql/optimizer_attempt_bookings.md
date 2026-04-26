## optimizer_attempt_bookings

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `~573K`  |  **Size:** `~25.5 MB`
**Purpose:** Junction table linking a winning `optimizer_candidates` row (the candidate that actually got booked) to the resulting `bookings` row. One row per successful candidate → booking outcome.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` PK | Junction row id. |
| `attempt_id` | `bigint` | FK to `optimizer_attempts.id`. Denormalised alongside `candidate_id` so you can go attempt → booking without joining through candidates. |
| `candidate_id` | `bigint` | FK to `optimizer_candidates.id`. The winning contestant. |
| `booking_id` | `int` | FK to `bookings.id`. The booking the candidate produced. |

**Indexes:** `attempt_id`, `candidate_id`, `booking_id` (all MUL).

**Key relationships:**
- `oab.candidate_id = optimizer_candidates.id` — winning candidate.
- `oab.attempt_id  = optimizer_attempts.id`   — owning attempt (shortcut; equivalent to `oc.attempt_id`).
- `oab.booking_id  = bookings.id`             — the booking itself.

**Common queries:**
```sql
-- Reverse-resolve a booking to its attempt + winning candidate
SELECT oab.attempt_id, oab.candidate_id, oa.search_id, oa.checkout_id, oa.created_at
FROM ota.optimizer_attempt_bookings oab
JOIN ota.optimizer_attempts oa ON oa.id = oab.attempt_id
WHERE oab.booking_id = :booking_id;

-- List the winning candidates for a specific attempt
SELECT oab.candidate_id, oab.booking_id
FROM ota.optimizer_attempt_bookings oab
WHERE oab.attempt_id = :attempt_id;
```

**Query guidance:**
- **Size class:** small — ~573K rows, ~25 MB. Any of `booking_id`, `candidate_id`, or `attempt_id` is indexed and cheap.
- No `created_at` column — use the linked `optimizer_attempts.created_at` or `optimizer_candidates.created_at` when a date bound is needed, especially on candidate-side joins (the candidates table is large).

**Notes:**
- Used by the `optimizer_analysis` skill (`.cursor/skills/optimizer_analysis/`) to wire `booking_id` back to `attempt_id` in the `by_booking` drill-down.
- Not every attempt has a row here — only attempts whose winning candidate was actually booked.
- When joining on `candidate_id`, use a `LEFT JOIN` so you keep non-winning / not-yet-booked candidates too (this is what the canonical join pattern does).
