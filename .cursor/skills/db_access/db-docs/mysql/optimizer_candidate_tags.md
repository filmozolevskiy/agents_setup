## optimizer_candidate_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `~42.3M`  |  **Size:** `~3.88 GB`
**Purpose:** Key-value tags attached to `optimizer_candidates`. Each row is one `(candidate_id, tag_id, value)` triple. Tag names come from `optimizer_tags`; values carry either a boolean-style `"1"` or the specific exception / label string.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` PK | Tag-row id. |
| `created_at` | `timestamp` | When the tag was attached. |
| `candidate_id` | `bigint` | FK to `optimizer_candidates.id`. |
| `tag_id` | `int` | FK to `optimizer_tags.id`. |
| `value` | `varchar(255)` | Tag value. For flag-style tags this is typically a constant (`"1"` or the tag name). For `Exception` it carries the exception text (e.g. `No matching fares found`, `Blocked by Supplier Rules …`). Multiple rows can exist per `(candidate_id, tag_id)` — tags are not unique. |

**Indexes:** `created_at`, `candidate_id`, `tag_id` (all MUL).

**Key relationships:**
- `oct.candidate_id = optimizer_candidates.id`
- `oct.tag_id       = optimizer_tags.id`

**Common queries:**
```sql
-- All tags for one candidate, resolved to names
SELECT ot.name, oct.value, oct.created_at
FROM ota.optimizer_candidate_tags oct
JOIN ota.optimizer_tags ot ON ot.id = oct.tag_id
WHERE oct.candidate_id = :candidate_id
ORDER BY ot.name, oct.value;

-- Candidates carrying a specific exception string
SELECT oct.candidate_id, oct.value
FROM ota.optimizer_candidate_tags oct
JOIN ota.optimizer_tags ot ON ot.id = oct.tag_id
WHERE ot.name = 'Exception'
  AND oct.value LIKE 'Blocked by Supplier Rules%'
  AND oct.created_at > NOW() - INTERVAL 1 DAY;

-- Tag roll-up per candidate (canonical pattern used by optimizer audits)
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
    MAX(CASE WHEN ot.name = 'Downgrade'                   THEN 1 ELSE 0 END) AS is_downgrade,
    MAX(CASE WHEN ot.name = 'MixedFareType'               THEN 1 ELSE 0 END) AS is_mixed_fare_type,
    MAX(CASE WHEN ot.name = 'AlternativeMarketingCarrier' THEN 1 ELSE 0 END) AS is_alternative_marketing_carrier,
    MAX(CASE WHEN ot.name = 'Risky'                       THEN 1 ELSE 0 END) AS is_risky
FROM ota.optimizer_candidate_tags oct
JOIN ota.optimizer_tags ot ON ot.id = oct.tag_id
WHERE oct.candidate_id IN (...)
GROUP BY oct.candidate_id;
```

**Query guidance:**
- **Size class:** large — ~42M rows, ~3.9 GB. Always constrain by `candidate_id` (narrow via a pre-filtered candidate set) or `created_at`.
- **Recommended constraints:** drive the join from a narrow candidate set (e.g. a single `attempt_id`) and then `JOIN optimizer_candidate_tags ON candidate_id`. Never scan the full table.
- **Denormalise with `GROUP_CONCAT`** when you need one row per candidate (see canonical pattern above and `optimizer_join_pattern.md`).

**Notes:**
- Tags are **many-to-many per candidate** — the same candidate can have several `Exception` rows with different values. `GROUP_CONCAT(DISTINCT … SEPARATOR ', ')` is the standard way to collapse.
- Routine `Blocked by Supplier Rules%` exception values are normal policy exceptions; optimizer audits usually exclude them (see `.cursor/skills/optimizer_analysis/`).
- See `optimizer_tags.md` for the full catalog of tag names and their meaning.
