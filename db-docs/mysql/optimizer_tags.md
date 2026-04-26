## optimizer_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `15`  |  **Size:** `~0.02 MB`
**Purpose:** Reference / dimension table of tag names that the Optimizer attaches to candidates. Joined onto `optimizer_candidate_tags.tag_id` to turn numeric ids into names.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` PK | Tag id. |
| `name` | `varchar(255)` UNI | Tag name. Unique. |
| `created_at` | `timestamp` | When the tag definition was added. |

### Tag catalog

Snapshot observed in production (2026-04-23). `id` values are dense but not sequential — filter by `name`, never hardcode `id`.

| id | name | Meaning / typical value |
|----|------|-------------------------|
| 2   | `RepriceIndex`                       | Records the reprice slot / operand index for repricing variants (e.g. `master_0`, `slave_1`). |
| 12  | `Original`                           | Marks the anchor / original candidate (`parent_id IS NULL` side). |
| 22  | `MultiCurrency`                      | Flags candidates involving a currency conversion. |
| 32  | `Exception`                          | Reason the candidate was held back / demoted. Value carries the text (e.g. `No matching fares found`, `Blocked by Supplier Rules …`). |
| 42  | `MultiTicketPart`                    | Multi-ticket operand label (`master_N`, `slave_N`). |
| 51  | `MixedFareType`                      | Candidate mixes published and private fares across segments. |
| 61  | `Downgrade`                          | Candidate downgrades the cabin / brand vs the anchor. |
| 71  | `AlternativeMarketingCarrier`        | Marketing carrier differs from the anchor. |
| 81  | `NetUnderPub`                        | Net fare came in under the published fare. |
| 91  | `Risky`                              | Candidate flagged as risky by policy. |
| 92  | `Promoted`                           | Candidate was actively promoted. Value carries the reason. |
| 102 | `Demoted`                            | Candidate was demoted. Value carries the reason. |
| 112 | `SupplierVolumeDistributionOverride` | Volume-distribution override applied by policy. |
| 122 | `Rogue`                              | Candidate was classified as rogue. |
| 132 | `Dropped`                            | Candidate was dropped downstream. |

**Key relationships:**
- Parent of `optimizer_candidate_tags` on `id = oct.tag_id`.

**Common queries:**
```sql
-- Full catalog
SELECT id, name, created_at FROM ota.optimizer_tags ORDER BY id;

-- Resolve tag_id -> name as part of a bigger join (see optimizer_candidate_tags.md)
```

**Query guidance:**
- **Size class:** tiny — 15 rows. Safe to join without filters.
- Always join by `name`, never by hardcoded `id`: new tags get new non-sequential ids.

**Notes:**
- Audit tooling in `.cursor/skills/optimizer_analysis/` relies on tag **names** (e.g. `Exception`, `Demoted`, `Promoted`, `MultiTicketPart`, `Downgrade`, `MixedFareType`, `AlternativeMarketingCarrier`, `Risky`). Keep usage in sync with this catalog.
- New tag names appear over time; re-run the catalog query periodically and update this doc.
