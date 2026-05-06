# bookability_contestant_attempts

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~24.1M (InnoDB estimate)  |  **Size:** ~7.6 GB data + ~6.4 GB indexes
**Purpose:** One row per bookability contestant attempt: a single fare the system tried to book (possibly one leg of a multi-ticket pair). Holds the GDS / carrier / office of the attempt, the search/package hashes it came from, the original vs post-attempt fare/booking classes, the final status, and any GDS / internal error details. Primary source for bookability-failure analysis and for attributing a finalized booking back to the search that produced it.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` | Primary key. `auto_increment`. |
| `customer_attempt_id` | `bigint` | FK → `bookability_customer_attempts.id`. Indexed. |
| `date_created` | `datetime` | When the attempt ran. Indexed — primary time filter. |
| `source` | `varchar(64)` | Source system / flow label. |
| `search_hash` | `varchar(32)` | Hash of the originating search. Indexed. |
| `package_hash` | `varchar(32)` | Hash of the flight package. Indexed. |
| `booking_id` | `bigint` | FK → `bookings.id`. Set when the attempt resulted in a finalized booking. Indexed. |
| `office_id` | `varchar(32)` | GDS office / PCC used for the attempt. |
| `package_got_in_a_fight` | `int` | Internal contention flag/counter. |
| `gds` | `varchar(32)` | GDS / content source used. |
| `currency` | `varchar(3)` | Currency of the fare amounts. |
| `fare_type` | `varchar(20)` | `private` / `published` / etc. |
| `validating_carrier` | `varchar(4)` | Validating airline. |
| `departure_airport_code` / `destination_airport_code` | `varchar(4)` | OD. |
| `departure_date` / `arrival_date` | `datetime` | Itinerary dates. |
| `is_multiticket_part` | `tinyint(1)` | `1` if this attempt is one leg of a multi-ticket pair. |
| `multiticket_part` | `varchar(10)` | `master`, `slave`, or `NULL`. |
| `marketing_carriers` / `operating_carriers` | `varchar(32)` | Carrier lists on the itinerary. |
| `original_booking_classes` | `varchar(32)` | Booking classes as seen before the attempt. |
| `original_base_fare` | `float(10,2)` | Pre-attempt base fare. |
| `original_tax` | `float(10,2)` | Pre-attempt tax. |
| `original_revenue` | `float(10,2)` | Pre-attempt revenue. |
| `post_attempt_booking_classes` | `varchar(32)` | Booking classes after the attempt (e.g. if rebooked). |
| `post_attempt_base_fare` / `post_attempt_tax` / `post_attempt_revenue` | `float(10,2)` | Post-attempt amounts. |
| `num_stops` / `num_segments` | `int` | Itinerary shape. |
| `num_adt` / `num_chd` / `num_inl` | `int` | Passenger counts. |
| `experiment_name` / `experiment_variation` | `varchar(100)` | A/B test bucket. |
| `status` | `varchar(32)` | Final status of the contestant attempt. |
| `exception` | `varchar(255)` | Internal code exception message. |
| `error` | `varchar(255)` | Normalized error reported by the GDS. |
| `gds_error_message` | `varchar(255)` | Raw error text from the GDS. |
| `erroneous_data` | `varchar(255)` | Auxiliary field with problematic data snippet. |
| `was_returned_to_customer` | `tinyint(1)` | `1` if this attempt's fare was displayed to the customer. |
| `built_contestant_id` | `bigint` | FK → `bookability_built_contestant.id`. Indexed. |

**Key relationships:**
- `bookability_contestant_attempts.customer_attempt_id = bookability_customer_attempts.id`
- `bookability_contestant_attempts.built_contestant_id = bookability_built_contestant.id` (also correlates via `customer_attempt_id` + `multiticket_part` for split bookings)
- `bookability_contestant_attempts.booking_id = bookings.id` — links an attempt to the booking it produced (nullable: most attempts never finalize into a booking).
- `bookability_contestant_attempts.search_hash` / `package_hash` — correlate attempts to the upstream search / package records.

**Common queries:**

```sql
-- GDS error breakdown for a single customer attempt
SELECT multiticket_part, gds, validating_carrier, status,
       error, exception, gds_error_message
FROM bookability_contestant_attempts
WHERE customer_attempt_id = 12345678;
```

```sql
-- Semi-join: keep only bookings that went through the bookability pipeline.
-- Used as an EXISTS-style filter alongside bookings-level joins.
SELECT b.id, b.booking_date, b.gds, b.validating_carrier
FROM bookings b
JOIN bookability_contestant_attempts bca ON bca.booking_id = b.id
WHERE b.booking_date > NOW() - INTERVAL 1 DAY
GROUP BY b.id;
```

```sql
-- Failure-rate by GDS over a window
SELECT gds,
       SUM(status = 'success') / COUNT(*) AS success_rate,
       COUNT(*) AS attempts
FROM bookability_contestant_attempts
WHERE date_created > NOW() - INTERVAL 1 DAY
GROUP BY gds;
```

**Query guidance:**
- **Size class:** large (~24M rows, ~7.6 GB). Always filter by `date_created` or join from a scoped `bookings` / `bookability_customer_attempts` set.
- **Recommended constraints:** `date_created` range, plus `gds`, `validating_carrier`, `status`, `booking_id IS NOT NULL` depending on intent.
- **Typical date range:** full history; practical analysis windows are the last 1–30 days.

**Notes:**
- Multiple rows per `customer_attempt_id`: one per contestant fare the system tried. Multi-ticket runs produce both a `master` and a `slave` row; join on `multiticket_part` when reconciling per-leg.
- `booking_id` is `NULL` for attempts that never finalized; use it as an existence filter when you only care about attempts that became real bookings.
- For supplier-evidence or raw payloads, correlate to MongoDB `ota.debug_logs` / `ota.optimizer_logs` via `search_hash` / `transaction_id` (see `bookability_analysis` and `optimizer_analysis` skills).
- Joining to `bookings` gives the final FOP / customer context; joining to `bookings.booking_date` is usually a tighter filter than `bca.date_created` when scoping a booked-bookings window.
