## optimizer_attempts

**Database:** `ota` (default)
**Engine:** `InnoDB`  |  **Rows:** `~534K`  |  **Size:** `~1.82 GB`
**Purpose:** One row per Optimizer execution — tied to a search, a selected package, or a checkout. Each attempt owns a set of `optimizer_candidates`. Most attempt-level columns (pricing, carrier, booking classes, fare bases, …) describe the anchor / target fare the Optimizer was asked to match, not a specific candidate.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` PK | Attempt id. FK target for `optimizer_candidates.attempt_id` and `optimizer_attempt_bookings.attempt_id`. |
| `checkout_id` | `varchar(32)` | Checkout session id, when the attempt ran inside a checkout. |
| `search_id` | `varchar(32)` | Search session id. |
| `package_id` | `varchar(32)` | Selected package / fare id the Optimizer was targeting. |
| `created_at` | `timestamp` | When the attempt started. |
| `gds` | `varchar(30)` | Primary GDS / content source. |
| `gds_account_id` | `varchar(30)` | GDS account / office id. |
| `currency` | `char(3)` | Attempt currency. |
| `fare_type` | `enum('published','private')` | Published vs private fare on the anchor. |
| `price_qualifiers` | `varchar(30)` | Pricing qualifiers requested (GDS-specific). |
| `trip_type` | `enum('oneway','roundtrip','multi')` | Trip shape. |
| `validating_carrier` | `varchar(4)` | Validating carrier on the anchor. |
| `flight_numbers` | `varchar(100)` | Flight numbers in the target itinerary. |
| `commission_trip_id` | `bigint` | Commission rule trip id on the anchor. |
| `void_rule_id` | `int` | Void policy on the anchor. |
| `base` | `decimal(10,2)` | Anchor base fare. |
| `tax` | `decimal(10,2)` | Anchor taxes. |
| `markup` | `decimal(10,2)` | Anchor markup. |
| `total` | `decimal(10,2)` | Anchor total. |
| `commission` | `decimal(10,2)` | Anchor commission. |
| `merchant_fee` | `decimal(10,2)` | Anchor merchant fee. |
| `supplier_fee` | `decimal(10,2)` | Anchor supplier fee. |
| `revenue` | `decimal(10,2)` | Anchor estimated revenue. |
| `dropnet_revenue` | `decimal(10,2)` | Anchor drop-net revenue. |
| `segment_revenue` | `decimal(10,2)` | Anchor segment-level revenue. |
| `booking_classes` | `varchar(20)` | Anchor RBDs per segment. |
| `cabin_codes` | `varchar(20)` | Anchor cabin codes per segment. |
| `fare_bases` | `varchar(255)` | Anchor fare basis codes per segment — reconciliation key against candidates. |
| `fare_families` | `varchar(255)` | Anchor fare families. |
| `affiliate_id` | `int` | Affiliate that made the request. |
| `target_id` | `int` | Target / white-label identifier inside the affiliate. |
| `package` | `json` | Full JSON of the selected package / fare — itinerary, pricing, flags. Heavy; do not pull on wide scans. |

**Indexes:** `checkout_id`, `search_id`, `created_at`, `gds`, `validating_carrier`, `affiliate_id`, `target_id` (all MUL).

**Key relationships:**
- Parent to `optimizer_candidates` on `id = oc.attempt_id` (one attempt → many candidates).
- Parent to `optimizer_attempt_bookings` on `id = oab.attempt_id` (one attempt → zero or more booked candidates).
- `search_id` / `checkout_id` / `package_id` link across to upstream search / checkout flows and to MongoDB `ota.optimizer_logs` via shared identifiers.

**Common queries:**
```sql
-- Attempt context for a single id
SELECT * FROM ota.optimizer_attempts WHERE id = 5406862;

-- Attempts made for one search (may span multiple package selections)
SELECT id, package_id, created_at, gds, total, revenue
FROM ota.optimizer_attempts
WHERE search_id = :search_id
ORDER BY created_at;

-- Attempts that led to a booking, via the junction
SELECT DISTINCT oa.id, oa.search_id, oa.checkout_id, oa.created_at
FROM ota.optimizer_attempt_bookings oab
JOIN ota.optimizer_attempts oa ON oa.id = oab.attempt_id
WHERE oab.booking_id = :booking_id;
```

**Query guidance:**
- **Size class:** medium — ~534K rows. Filter by `id`, `search_id`, `checkout_id`, or `created_at`.
- **Recommended constraints:** `id` / `search_id` / `checkout_id` for drill-downs; `created_at > now() - interval N day` for scans.
- Avoid `SELECT package` on anything but a single-row lookup — the JSON is large.

**Notes:**
- Attempt-level fare columns describe the **anchor** (original target) fare, not a specific candidate. When comparing anchor vs candidate in a reprice variant, the anchor-is-`oa.*`, candidate-is-`oc.*` model is the cleanest.
- Some columns are duplicated between `optimizer_attempts` and `optimizer_candidates` by design — the attempt row pins what we were asked to price; the candidate rows capture what the Optimizer actually priced.
