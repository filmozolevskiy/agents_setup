## optimizer_attempt_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `~34K` (and growing; 33,956 at 2026-06-03)  |  **Size:** small
**Purpose:** Key-value tags attached to an **attempt** (`optimizer_attempts`), not to a single candidate. Attempt-level analogue of [`optimizer_candidate_tags`](optimizer_candidate_tags.md). Each row is one `(attempt_id, tag_id, value)` triple. Tag names come from the shared [`optimizer_tags`](optimizer_tags.md) catalog. A tag here applies to the whole optimizer run, so it logically propagates to every candidate of the attempt.

First confirmed 2026-06-03 (table observed live; not present in earlier optimizer docs). Earliest row `created_at = 2026-05-05`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` PK | Tag-row id. |
| `created_at` | `timestamp` | When the tag was attached. Indexed (MUL). |
| `attempt_id` | `bigint` | FK to `optimizer_attempts.id`. Indexed (MUL). |
| `tag_id` | `int` | FK to `optimizer_tags.id`. Indexed (MUL). |
| `value` | `varchar(255)` | Tag value. For flag-style tags typically a constant; for value-carrying tags (e.g. `Filtered`, `VccRequired`) it carries the meaningful string. |

**Tags observed at this level (last 30 days, 2026-06-03):** `Seats`, `Filtered`, `Risky`, `Upgrade`, `Test`, `VccRequired`. See the **Level** column in [`optimizer_tags.md`](optimizer_tags.md) for which catalog names are attempt-level.

**`VccRequired`** (catalog id 212, added 2026-06-02) lives **only** at this level — 0 rows at the candidate level. Its `value` is the payment method that requires a virtual credit card to fulfill, e.g. `ApplePayPaymentMethod`. Added for JP's ApplePay/PayPal flow.

**Key relationships:**
- `oat.attempt_id = optimizer_attempts.id`
- `oat.tag_id     = optimizer_tags.id`

**Common queries:**
```sql
-- All attempt-level tags for one attempt, resolved to names (Diego's query)
SELECT ot.name, oat.value, oat.created_at
FROM ota.optimizer_attempt_tags oat
JOIN ota.optimizer_tags ot ON ot.id = oat.tag_id
WHERE oat.attempt_id = :attempt_id
ORDER BY ot.name, oat.value;

-- Attempts carrying a specific attempt-level tag in a window
SELECT oat.attempt_id, oat.value
FROM ota.optimizer_attempt_tags oat
JOIN ota.optimizer_tags ot ON ot.id = oat.tag_id
WHERE ot.name = 'VccRequired'
  AND oat.created_at > NOW() - INTERVAL 1 DAY;
```

**Query guidance:**
- **Size class:** small today, but constrain by `attempt_id` or `created_at` — it grows with traffic.
- Join the catalog by `name`, never by hardcoded `id` (`optimizer_tags.id` values are non-sequential).
- The Looker `content_integration_optimizer` project pivots this table in `optimizer_attempt_tags_pivot.view.lkml` (one wide row per attempt) and joins it to the explore on `attempt_id`.

**Notes:**
- Distinct from `optimizer_candidate_tags`: that keys on `candidate_id` (one fare option); this keys on `attempt_id` (the whole run). Same catalog, different grain.
- See the 5-table read-side shape in [`optimizer_join_pattern.md`](optimizer_join_pattern.md).
