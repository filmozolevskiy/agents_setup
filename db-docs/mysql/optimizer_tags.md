## optimizer_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `13`  |  **Size:** `0.02 MB`
**Purpose:** Reference table for tag names used in the optimizer.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` | Primary key |
| `name` | `varchar(255)` | Name of the tag (e.g., `Exception`, `Demoted`, `Promoted`, `Risky`) |
| `created_at` | `timestamp` | When the tag definition was created |

**Key relationships:**
- Parent to `optimizer_candidate_tags`

**Common queries:**
```sql
-- List all available tags
SELECT * FROM ota.optimizer_tags;
```

**Query guidance:**
- **Size class:** small — only a few rows.

**Notes:**
- Static reference table.
