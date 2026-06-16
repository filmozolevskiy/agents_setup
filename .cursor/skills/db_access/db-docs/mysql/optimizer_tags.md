## optimizer_tags

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** `23`  |  **Size:** `~0.02 MB`
**Purpose:** Reference / dimension table of tag names that the Optimizer attaches. Joined onto `optimizer_candidate_tags.tag_id` (candidate-level tags) **and** `optimizer_attempt_tags.tag_id` (attempt-level tags) to turn numeric ids into names. Both link tables share this one catalog. See [`optimizer_attempt_tags.md`](optimizer_attempt_tags.md).

| Column | Type | Description |
|--------|------|-------------|
| `id` | `int` PK | Tag id. |
| `name` | `varchar(255)` UNI | Tag name. Unique. |
| `created_at` | `timestamp` | When the tag definition was added. |

### Tag catalog

Snapshot observed in production (2026-06-16; was 2026-06-03). `id` values are dense but not sequential — filter by `name`, never hardcode `id`. **Level** marks where the tag is normally attached: `candidate` → `optimizer_candidate_tags`, `attempt` → `optimizer_attempt_tags`. Some tags appear at both.

| id | name | Level | Meaning / typical value |
|----|------|-------|-------------------------|
| 2   | `RepriceIndex`                       | candidate | Records the reprice slot / operand index for repricing variants (e.g. `master_0`, `slave_1`). |
| 12  | `Original`                           | candidate | Marks the anchor / original candidate (`parent_id IS NULL` side). |
| 22  | `MultiCurrency`                      | candidate | Flags candidates involving a currency conversion. |
| 32  | `Exception`                          | candidate | Reason the candidate was held back / demoted. Value carries the text (e.g. `No matching fares found`, `Blocked by Supplier Rules …`). |
| 42  | `MultiTicketPart`                    | candidate | Multi-ticket operand label (`master_N`, `slave_N`). |
| 51  | `MixedFareType`                      | candidate | Candidate mixes published and private fares across segments. |
| 61  | `Downgrade`                          | candidate | Candidate downgrades the cabin / brand vs the anchor. |
| 71  | `AlternativeMarketingCarrier`        | candidate | Marketing carrier differs from the anchor. |
| 81  | `NetUnderPub`                        | candidate | Net fare came in under the published fare. |
| 91  | `Risky`                              | candidate, attempt | Flagged as risky by policy. |
| 92  | `Promoted`                           | candidate | Candidate was actively promoted. Value carries the reason. |
| 102 | `Demoted`                            | candidate | Candidate was demoted. Value carries the reason. |
| 112 | `SupplierVolumeDistributionOverride` | candidate | Volume-distribution override applied by policy. |
| 122 | `Rogue`                              | candidate | Candidate was classified as rogue. |
| 132 | `Dropped`                            | candidate | Candidate was dropped downstream. |
| 142 | `Selected`                           | candidate | Candidate was selected. |
| 152 | `Test`                               | candidate, attempt | Non-production / test traffic. |
| 162 | `Seats`                              | attempt | Attempt involved seat-selection ancillaries. |
| 172 | `Filtered`                           | attempt | Inputs filtered out for the attempt. Value carries what was filtered (e.g. `ApplePayPaymentMethod`, `PayPalPaymentMethod`). |
| 182 | `Unfit`                              | candidate | Candidate deemed unfit. Value carries the reason (e.g. `PayPalPaymentMethod`, `Multi-Currency+Seat Selection Fees`, `No display currency`). |
| 192 | `LowRevenue`                         | candidate | Candidate flagged low-revenue. |
| 202 | `Upgrade`                            | attempt | Optimizer formed the package as a fare-family upgrade (Trello #2896, genesis PR #53702). |
| 212 | `VccRequired`                        | attempt | Attempt's chosen payment method needs a virtual credit card to fulfill. Value carries the method (e.g. `ApplePayPaymentMethod`). Added 2026-06-02 for the ApplePay/PayPal flow. |
| 242 | `Acceptable`                         | candidate | Candidate has minor differences from the original (e.g. change / cancellation policy) but is still considered acceptable for eligibility. Value carries the comma-separated list of dimensions that diverged (e.g. `advance_change`, `cancellation,advance_change`). Added 2026-06-15. |
| 252 | `RoutehappyError`                    | candidate | RouteHappy lookup failed for this contestant. Writer attaches the tag as a presence flag — `value` is `NULL` (970 of 970 rows observed 2026-06-16 12:40 → 14:13 had no value). Added 2026-06-16. |

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
- Audit tooling in `.cursor/skills/optimizer/` relies on tag **names** (e.g. `Exception`, `Demoted`, `Promoted`, `MultiTicketPart`, `Downgrade`, `MixedFareType`, `AlternativeMarketingCarrier`, `Risky`). Keep usage in sync with this catalog.
- New tag names appear over time; re-run the catalog query periodically and update this doc.
