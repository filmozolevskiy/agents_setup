## optimizer_candidates

**Database:** `ota` (default)
**Engine:** `InnoDB`  |  **Rows:** `~44.9M`  |  **Size:** `~7.05 GB`
**Purpose:** One row per fare option (contestant) the Optimizer built for a given attempt. This is the core output of the Optimizer — every candidate evaluated, eligible or not, across repricing variants and multi-ticket parts.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` PK | Candidate (contestant) id. Referenced by `optimizer_candidate_tags.candidate_id` and `optimizer_attempt_bookings.candidate_id`. |
| `parent_id` | `bigint` | Candidate this one was derived from. Used to link repriced children back to their anchor (original) candidate and to chain multi-ticket operands. `NULL` for the anchor. |
| `created_at` | `timestamp` | When the candidate was written. Always filter on this on large scans. |
| `attempt_id` | `bigint` | FK to `optimizer_attempts.id`. |
| `reprice_type` | `varchar(32)` | Repricing strategy that produced this candidate (e.g. anchor/original vs a reprice variant). Combined with `reprice_index` to distinguish `master_N` / `slave_N` operands for multi-ticket attempts. |
| `reprice_index` | `varchar(32)` | Index inside the `reprice_type` bucket (e.g. `master_0`, `slave_1`). |
| `rank` | `int` | Rank of this candidate inside the attempt (Optimizer-assigned ordering). |
| `candidacy` | `enum` | Eligibility status. Values: `Unprocessable`, `Unbookable`, `Inadmissible`, `Unsalable`, `Incalculable`, `Unprofitable`, `Unmatchable`, `Eligible`, `Saver`, `Admissible`. `Unmatchable` pairs with the `No matching fares found` Exception tag and means the supplier responded but the Optimizer could not reconcile it to the target itinerary. |
| `gds` | `varchar(30)` | GDS / content source the candidate was priced on (e.g. `amadeus`, `dida`). |
| `gds_account_id` | `varchar(30)` | Account / office id on the GDS side. |
| `currency` | `char(3)` | Pricing currency. |
| `fare_type` | `enum('published','private')` | Published vs private (negotiated) fare. |
| `validating_carrier` | `char(2)` | Validating carrier IATA code for this priced option. |
| `pricing_options` | `varchar(8)` | Pricing-option qualifiers applied when repricing (GDS-specific flags). |
| `flight_numbers` | `varchar(100)` | Flight numbers covered by this candidate. |
| `commission_trip_id` | `bigint` | Commission rule trip id used for `commission` / `revenue` calc. |
| `void_rule_id` | `int` | Void policy id applied to this candidate. |
| `base` | `decimal(10,2)` | Base fare. |
| `tax` | `decimal(10,2)` | Taxes. |
| `markup` | `decimal(10,2)` | Markup applied on top of base+tax. |
| `total` | `decimal(10,2)` | Final customer-facing total = base + tax + markup (+ fees depending on flow). |
| `commission` | `decimal(10,2)` | Commission earned. |
| `merchant_fee` | `decimal(10,2)` | Merchant-side fee component. |
| `supplier_fee` | `decimal(10,2)` | Supplier-side fee component. |
| `revenue` | `decimal(10,2)` | Estimated total revenue for this candidate (net to us). |
| `dropnet_revenue` | `decimal(10,2)` | Revenue that comes from drop-net strategies specifically. |
| `segment_revenue` | `decimal(10,2)` | Revenue attributed at the segment level (for segmented repricing). |
| `booking_classes` | `varchar(20)` | RBDs for each segment, concatenated. |
| `cabin_codes` | `varchar(20)` | Cabin codes per segment. |
| `fare_bases` | `varchar(255)` | Fare basis codes per segment. Primary reconciliation key against supplier evidence in `ota.optimizer_logs` and against the attempt anchor. |
| `fare_families` | `varchar(255)` | Fare family / brand per segment (when available). |

**Indexes:** `created_at`, `attempt_id`, `parent_id`, `gds` (all MUL).

**Key relationships:**
- `oc.attempt_id = optimizer_attempts.id` — links the candidate to its search / package / checkout context.
- `oc.id = optimizer_candidate_tags.candidate_id` — attached tags (Exception, Demoted, Promoted, MultiTicketPart, Downgrade, MixedFareType, AlternativeMarketingCarrier, Risky, Rogue, Dropped, …). See `optimizer_tags.md` for the full catalog.
- `oc.id = optimizer_attempt_bookings.candidate_id` — winning candidate → booking link.
- `oc.parent_id = oc.id` (self join) — find the anchor (original) candidate behind a repriced child; the anchor is the ground truth when auditing reprice variants.

**Common queries:**
```sql
-- All candidates for one attempt, with tags rolled up (the canonical join pattern)
-- See db-docs/mysql/optimizer_join_pattern.md for the full template.
SELECT oc.id, oc.candidacy, oc.reprice_type, oc.reprice_index, oc.total, oc.revenue,
       oc.fare_bases, oc.booking_classes
FROM ota.optimizer_candidates oc
WHERE oc.attempt_id = 5406862
ORDER BY oc.rank;

-- Anchor (original) candidate behind a reprice variant
SELECT parent.*
FROM ota.optimizer_candidates child
JOIN ota.optimizer_candidates parent ON parent.id = child.parent_id
WHERE child.id = :candidate_id;
```

**Query guidance:**
- **Size class:** large — ~45M rows, ~7 GB. Always filter by `attempt_id` or a recent `created_at` window.
- **Recommended constraints:** `attempt_id` for single-attempt drill-downs; `created_at > now() - interval N hour/day` for scans.
- **Typical date range:** several months of history.

**Notes:**
- Multi-ticket attempts emit one candidate per `Reprice[master_N]` / `Reprice[slave_N]` operand. When auditing, iterate all operands; do not collapse on `attempt_id` alone.
- `reprice_and_drop` candidates are shadow repricings and are usually ignored in matching audits (see `.cursor/skills/optimizer_analysis/`).
- `parent_id` is the only structural link between a reprice variant and its anchor — join back to the same table to recover it.
