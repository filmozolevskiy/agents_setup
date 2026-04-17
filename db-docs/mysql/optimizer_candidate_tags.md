## optimizer_candidate_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `~39M`  |  **Size:** `~3.5GB`
**Purpose:** Stores key-value tags associated with optimizer candidates for filtering and analysis.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key |
| `created_at` | `timestamp` | When the tag was added |
| `candidate_id` | `bigint` | FK to `optimizer_candidates.id` |
| `tag_id` | `int` | FK to `optimizer_tags.id` |
| `value` | `varchar(255)` | Value of the tag (e.g., "1" for boolean tags, or specific error/exception strings) |

**Key relationships:**
- Joins to `optimizer_candidates` on `candidate_id`
- Joins to `optimizer_tags` on `tag_id`

**Common queries:**
```sql
-- Get all tags for a specific candidate
SELECT t.name, ct.value 
FROM ota.optimizer_candidate_tags ct
JOIN ota.optimizer_tags t ON ct.tag_id = t.id
WHERE ct.candidate_id = 425122742;
```

**Query guidance:**
- **Size class:** large — ~39M rows, always filter by `candidate_id` or `created_at`.
- **Recommended constraints:** `candidate_id`, `created_at`.

**Notes:**
- Used extensively for tracking promotions, demotions, and exceptions during optimization.
