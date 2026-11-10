## jupiter_check_availability_call

**Database:** `jupiter`
**Engine:** `Distributed` over `jupiter_check_availability_call_shard` (`ReplicatedMergeTree`)  |  **Rows:** 16,981,896 (sum of Q0, 2026-11-02 15:14 America/New_York)  |  **Size:** 779.75 MiB on the connected shard (`system.tables`, 2026-11-02)
**Storage:** cluster `ota`, sharding key `rand()`. Shard table: `PARTITION BY toYYYYMM(called_at)`, `ORDER BY called_at`, TTL (time to live) `called_at + INTERVAL 6 MONTH`.
**Purpose:** One row per check availability call, per ticket part. A row records which upstream system was asked, whether it said the package is still available, how long the call took, the package price before the call and after the upstream answer, and the fare increase decision. Use it to measure unavailable answers, time-outs, and price moves per upstream system and per caller.
**Writer:** genesis `src/CheckAvailability/Data/CheckAvailabilityCall.php` (`develop` at `ed5f38af91b`), sent through the Kafka topic `jupiter_check_availability_call`. See Note 8. Paths in `Code:` notes are relative to the genesis root. The local clone is `.cursor/skills/codebase_access/codebase/`.
**Verified:** 2026-11-02 (America/New_York). Q0 ran at about 15:14 and showed rows from 15:13:52. Sample: the latest 100 rows by `called_at DESC`. Every query below ran against the live databases on that date.

| Column | Type | Description |
|--------|------|-------------|
| `called_at` | `DateTime` | When the row was built, in whole seconds. This is right after the upstream answer came back (Code: `CheckAvailabilityCall.php:184`), so `called_at - elapsed_seconds` is about the start of the call. Server time zone: America/New_York (Note 7). Partition key, sorting key, and TTL column: filter on it in every query. |
| `context` | `String` | Where the check started. Five values exist in the whole table (Q0). `checkoutAjax`: background request from the checkout page (Code: `include/Mv/Ota/Flighthub/App/Checkout/View/Experiment/billing.php:575`). `checkoutTransit`: the validate page that runs before the checkout page (Code: `include/Mv/Ota/Flighthub/App/Checkout.php:1155`). `storefrontAPI`: requests from the mobile app (Code: `include/Mv/Ota/Jfly/App/StorefrontApi.php:4721`; the top affiliates are the iOS app, Q4 and Q8). `airAvailability`: the partner API (application programming interface) (Code: `include/Mv/Ota/Api/App/Air.php:1106`). `package-verify`: the default when the caller sets no context (Code: `include/Mv/Ota/Fare/Package.php:7202`). Counts: Q1. |
| `search_id` | `String` | Search hash. The same value is `search_id` in `jupiter_booking_errors_v2` and `search_api_stats.gds_raw`, `debug_transaction_id` in MySQL `ota.bookings`, and `transaction_id` in MongoDB `ota.debug_logs`. |
| `package_id` | `String` | Package inside the search. Use it with `search_id` (Q12). |
| `multiticket_part` | `Nullable(String)` | NULL for a single-ticket package. `master` or `slave` for the two parts of a multi-ticket package. Each part has its own row (Q10). |
| `user_currency` | `String` | Currency of the user (for example `CAD`, `USD`, `GBP`, `EUR`). Amounts in this table are in `gds_currency`, not in this currency (Note 4). |
| `adults`, `children`, `infants`, `seats` | `UInt8` | Passenger counts. `infants` adds infants on seat and infants on lap (Code: `CheckAvailabilityCall.php:190-195`). |
| `site_id` | `UInt8` | Brand. `1` = FlightHub, `4` = JustFly. The code also defines `5` Agencia, `10` testing, and `11` Afritrip (Code: `include/Mv/Ota/Site.php:13-18`). |
| `affiliate_id`, `affiliate_type` | `Nullable(UInt32)`, `Nullable(String)` | Affiliate that sent the user, and the affiliate type. Join to MySQL `ota.affiliates` on `id` (Q8). Examples: `1042` = Google Flights Meta (`type105`); `1091` and `1121` = mobile app, logged in and not logged in (`type101`). |
| `campaign_id` | `Nullable(UInt32)` | Affiliate campaign id. NULL when the package has none. |
| `target_id` | `Nullable(UInt32)` | Targeting id carried by the package. NULL when the package has none. |
| `trip_type` | `String` | `oneway`, `roundtrip`, or `multi`. |
| `routing` | `String` | `domestic`, `international`, or `transborder`. |
| `origin_airport`, `destination_airport` | `String` | IATA (International Air Transport Association) airport codes of the trip. |
| `origin_country`, `destination_country` | `String` | Two-letter country codes (for example `US`, `KR`). |
| `stops` | `Int8` | Number of stops. |
| `lead_days` | `UInt16` | Days from the call date to the first departure (Code: `Package.php:14792`). |
| `duration_days` | `UInt16` | Trip length in days. |
| `gds` | `String` | Upstream system that was asked, as a slug (GDS = global distribution system). Examples: `amadeus`, `dida`, `pkfare`, `unififi`. Q2 lists every slug in its window. |
| `gds_account_id` | `String` | Account or office used for the call (for example `ATL1S211S`, `PKFAREUSD`, `TKNDCCAD`). |
| `gds_currency` | `String` | Currency of the upstream system. Every `before_*` and `after_*` amount is in this currency (Note 4). |
| `validating_carrier` | `String` | Validating airline, IATA code (for example `YP`, `WS`). |
| `successful_call` | `Bool` | `true`: the check returned "available". `false`: unavailable, error, or time-out; read `error`. Also `true` when the upstream system has no check (Note 1). |
| `error` | `Nullable(String)` | NULL when `successful_call` is true. Otherwise the upstream feedback message, else the response code, else `Unknown` (Code: `CheckAvailabilityCall.php:215`). Top messages: Q6. |
| `elapsed_seconds` | `Nullable(Float32)` | Seconds the upstream call took (Code: `Package.php:1112-1115`). About 0 when no upstream call is made (Note 1). Time-outs: Q7. |
| `before_fare_type` | `String` | `published` or `private`. |
| `before_flight_numbers`, `before_cabin_codes`, `before_booking_classes`, `before_fare_bases`, `before_fare_families` | `Array(String)` | One entry per flight segment, before the call. Example for a round trip: `['WS2042','WS2043']`, `['M','M']`, `['E','E']`, `['KL0D0HBW','LL0D0HBW']`, `['BASIC','BASIC']`. An entry is `''` when the fare has no fare family. |
| `before_base`, `before_tax`, `before_markup`, `before_total` | `Decimal(10, 2)` | Package amounts before the call, in `gds_currency`. `before_total` differs from base + tax + markup on more than half of the rows, almost always by 5 cents or less (Q11). Do not rebuild the total from the parts. |
| `after_fare_type` | `Nullable(String)` | Fare type after the upstream answer. NULL when `successful_call` is false. |
| `after_flight_numbers`, `after_cabin_codes`, `after_booking_classes`, `after_fare_bases`, `after_fare_families` | `Array(String)` | The same lists after the upstream answer. Empty arrays when `successful_call` is false. |
| `after_base`, `after_tax`, `after_markup`, `after_total` | `Nullable(Decimal(10, 2))` | Package amounts after the upstream answer is applied to a copy of the package, in `gds_currency`. NULL when `successful_call` is false (Q11). Shows the upstream price. It is not always the price the user pays (Note 2). |
| `notices` | `Array(String)` | Change flags set by the writer (Code: `CheckAvailabilityCall.php:179` and `262-282`): `Unavailable`, `TotalIncreased`, `TotalDecreased`, `FareType`, `FlightNumbers`, `CabinCodes`, `BookingClasses`, `FareBases`, `FareFamilies`, `Base`, `Tax`, `Markup`, `Total`. Empty array when nothing changed. Flags can disagree with the amounts (Note 5). |
| `should_delay_fi` | `Nullable(Bool)` | Fare increase decision for the package. NULL: the comparison found no fare increase. `true`: fare increase found, and it is delayed. `false`: fare increase found, and it is not delayed. Read Note 3 before you use it. |
| `is_basic_package_cache` | `UInt8` | `1` when the package came from the basic packages cache. |
| `bpc` | `JSON(age UInt32, ttl UInt32)` | Cache entry data. `age`: age of the cached answer when it was read. `ttl`: the time to live it was written with. Both in seconds (Code: `src/Flight/Search/FareFetch/BasicPackagesCache.php:19-31`). Example: `{"age": 285, "ttl": 600}`. |
| `id` | `String` | Row id: a UUID (universally unique identifier, version 4) made by the writer (Code: `CheckAvailabilityCall.php:256`). Not unique on every row (Note 6). |
| `checkout_id` | `Nullable(String)` | Checkout id (32-character hex string). Set on `checkoutAjax` rows only: in Q1 (2026-10-25 to 2026-11-01, America/New_York), `with_checkout_id` is 423,278 of 423,280 calls for `checkoutAjax` and 0 for every other context. Joins to `upsells.fare_family_upgrade_options_event.checkout_id` (Q13). |
| `time_of_search` | `Nullable(Int32)` | UNIX time, in seconds, when the search started (Code: `CheckAvailabilityCall.php:258`). Age of the search at the call: `toUnixTimestamp(called_at) - time_of_search` (Q9). |
| `api_user` | `Nullable(String)` | API user of the search (for example `kayak`, `kayakapp`, `skyscanner`). NULL when the search has none (Code: `CheckAvailabilityCall.php:259`). |

**Key relationships:**
- `search_id` and `package_id` join to `jupiter.jupiter_booking_errors_v2` on both columns. It shows what the check said before a booking error. Verified in Q12. See [jupiter_booking_errors_v2.md](jupiter_booking_errors_v2.md).
- `search_id` joins to `search_api_stats.gds_raw.search_id` (search telemetry per upstream system; see [search_api_stats_gds_raw.md](search_api_stats_gds_raw.md)), to MySQL `ota.bookings.debug_transaction_id` (see [bookings.md](../mysql/bookings.md)), and to MongoDB `ota.debug_logs.transaction_id` (see [debug_logs.md](../mongodb/debug_logs.md)).
- `affiliate_id` joins to MySQL `ota.affiliates.id` (Q8).
- `checkout_id` joins to `upsells.fare_family_upgrade_options_event.checkout_id` (Q13). See [fare_family_upgrade_options_event.md](fare_family_upgrade_options_event.md).

**Common queries:**

Q1 to Q7, Q10, Q11, and Q14 use the window `called_at` from 2026-10-25 00:00:00 up to, not including, 2026-11-01 00:00:00, America/New_York (168 hours). Change the dates to your window. Keep the upper bound exclusive. Each stamp gives the date, the window, and the time zone of the run.

```sql
-- Q0. Size, age, and freshness per caller context. Cheap: no time window needed.
-- verified 2026-11-02 15:14 America/New_York, no window (reads the whole table), returned 5 rows
SELECT context, count() AS rows_all_time, min(called_at) AS first_row, max(called_at) AS last_row
FROM jupiter.jupiter_check_availability_call
GROUP BY context
ORDER BY rows_all_time DESC
```

```sql
-- Q1. Checks by caller context.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 5 rows
SELECT context, count() AS calls, countIf(NOT successful_call) AS unavailable,
       round(avg(elapsed_seconds), 2) AS avg_s, countIf(checkout_id IS NOT NULL) AS with_checkout_id
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
GROUP BY context
ORDER BY calls DESC
```

```sql
-- Q2. Outcome mix per upstream system, checkout page only.
-- upstream_price_up / _down: successful call and after_total - before_total beyond +/-1.5.
-- The threshold ignores currency: each row uses its own gds_currency.
-- decision_delayed / decision_shown: should_delay_fi = true / false.
-- up_no_decision: price up, but no decision recorded.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 23 rows
SELECT gds, count() AS calls,
       countIf(NOT successful_call) AS unavailable,
       countIf(successful_call AND toFloat64(after_total) - toFloat64(before_total) > 1.5) AS upstream_price_up,
       countIf(successful_call AND toFloat64(after_total) - toFloat64(before_total) < -1.5) AS upstream_price_down,
       countIf(should_delay_fi = true) AS decision_delayed,
       countIf(should_delay_fi = false) AS decision_shown,
       countIf(should_delay_fi IS NULL AND successful_call AND toFloat64(after_total) - toFloat64(before_total) > 1.5) AS up_no_decision,
       round(avg(elapsed_seconds), 2) AS avg_s
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax'
GROUP BY gds
ORDER BY calls DESC
```

```sql
-- Q3. Google Flights share (affiliate 1042, see Q8) by context.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 5 rows
SELECT context, if(affiliate_id = 1042, 'google_flights', 'other') AS traffic,
       count() AS calls, countIf(NOT successful_call) AS unavailable
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context IN ('checkoutAjax', 'checkoutTransit', 'storefrontAPI')
GROUP BY context, traffic
ORDER BY context, calls DESC
```

```sql
-- Q4. Top affiliates for the iOS app address.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 4 rows
SELECT affiliate_id, count() AS calls
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'storefrontAPI'
GROUP BY affiliate_id
ORDER BY calls DESC
LIMIT 4
```

```sql
-- Q5. Amadeus checks that carry a fare increase decision, by traffic.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 2 rows
SELECT if(affiliate_id = 1042, 'google_flights', 'other') AS traffic,
       countIf(should_delay_fi = true) AS decision_delayed, countIf(should_delay_fi = false) AS decision_shown
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax' AND gds = 'amadeus' AND should_delay_fi IS NOT NULL
GROUP BY traffic
ORDER BY traffic
```

```sql
-- Q6. Top failure messages, checkout page.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 8 rows
SELECT gds, substring(coalesce(error, '(none)'), 1, 70) AS error_start, count() AS calls,
       round(avg(elapsed_seconds), 1) AS avg_s
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax' AND NOT successful_call
GROUP BY gds, error_start
ORDER BY calls DESC
LIMIT 8
```

```sql
-- Q7. Time-out messages, checkout page.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 6 rows
SELECT gds, count() AS calls, round(avg(elapsed_seconds), 1) AS avg_s
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax' AND NOT successful_call
  AND (error ILIKE '%timed out%' OR error ILIKE '%timeout%')
GROUP BY gds
ORDER BY calls DESC
LIMIT 6
```

```sql
-- Q8. Affiliate names (MySQL, read only).
-- verified 2026-11-02, no time window (lookup by id), returned 3 rows
SELECT id, name, type FROM ota.affiliates WHERE id IN (1091, 1121, 1042)
```

```sql
-- Q9. Every check availability call for one search, oldest first. Replace <search_id>.
-- secs_since_search: seconds from the start of the search to the call.
-- verified 2026-11-02 15:12 America/New_York with a real search id, window = the 2 days before the run, returned 7 rows
SELECT called_at, context, multiticket_part, gds, successful_call, error, elapsed_seconds,
       gds_currency, before_total, after_total, should_delay_fi, notices,
       toUnixTimestamp(called_at) - time_of_search AS secs_since_search
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= now() - INTERVAL 2 DAY
  AND search_id = '<search_id>'
ORDER BY called_at
```

```sql
-- Q10. Does the row's own price move explain should_delay_fi? Single-ticket rows vs multi-ticket parts.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 9 rows
SELECT multiticket_part, should_delay_fi,
       count() AS calls,
       countIf(NOT successful_call) AS unavailable,
       countIf(successful_call AND toFloat64(after_total) - toFloat64(before_total) > 1.0) AS own_price_up
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
GROUP BY multiticket_part, should_delay_fi
ORDER BY multiticket_part, should_delay_fi
```

```sql
-- Q11. Data-quality checks. Expected: failed_rows_with_after_total = 0.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 1 row
SELECT count() AS calls,
       countIf(NOT successful_call AND after_total IS NOT NULL) AS failed_rows_with_after_total,
       countIf(id = '') AS empty_id,
       countIf(id != '') - uniqExactIf(id, id != '') AS repeated_id_rows,
       countIf(before_total = before_base + before_tax + before_markup) AS total_equals_parts,
       countIf(abs(toFloat64(before_total) - toFloat64(before_base + before_tax + before_markup)) <= 0.05) AS total_within_5_cents,
       countIf(abs(toFloat64(before_total) - toFloat64(before_base + before_tax + before_markup)) > 1) AS total_off_by_more_than_1,
       countIf(has(notices, 'Tax') AND before_tax = after_tax) AS tax_flag_same_amount,
       countIf(has(notices, 'TotalIncreased') AND (after_base + after_tax) <= (before_base + before_tax)) AS increased_flag_base_tax_not_up
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
```

```sql
-- Q12. Join check: booking errors that have a check availability call for the same search and package.
-- verified 2026-11-02, windows: errors 2026-10-31 00:00:00 to 2026-11-01 00:00:00, calls 2026-10-30 00:00:00 to 2026-11-01 00:00:00, America/New_York; returned 1 row (1,716 booking errors, 1,578 with a check call)
SELECT count() AS booking_errors,
       countIf((search_id, package_id) IN (
         SELECT search_id, package_id
         FROM jupiter.jupiter_check_availability_call
         WHERE called_at >= toDateTime('2026-10-30 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
       )) AS with_check_call
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= toDateTime('2026-10-31 00:00:00') AND timestamp < toDateTime('2026-11-01 00:00:00')
  AND search_id != ''
```

```sql
-- Q13. Join check: checkout page calls whose checkout_id appears in the upsell event table the same day.
-- verified 2026-11-02, window 2026-10-31 00:00:00 to 2026-11-01 00:00:00 America/New_York (both tables); returned 1 row (49,116 calls, 48,470 with an upsell event)
SELECT count() AS check_calls,
       countIf(checkout_id IN (
         SELECT checkout_id
         FROM upsells.fare_family_upgrade_options_event
         WHERE timestamp >= toDateTime('2026-10-31 00:00:00') AND timestamp < toDateTime('2026-11-01 00:00:00')
           AND checkout_id IS NOT NULL AND checkout_id != '' AND checkout_id != 'undefined'
       )) AS with_upsell_event
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-31 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax'
```

```sql
-- Q14. Amount currency check: same route, same upstream system, upstream currency USD.
-- If amounts were in the user's currency, CAD users would show a clearly higher median than USD users.
-- verified 2026-11-02, window 2026-10-25 00:00:00 to 2026-11-01 00:00:00 America/New_York, returned 2 rows (CAD users: 481 calls, median 1472.40; USD users: 63 calls, median 1440.96)
SELECT user_currency, count() AS calls, round(median(toFloat64(before_total)), 2) AS median_before_total
FROM jupiter.jupiter_check_availability_call
WHERE called_at >= toDateTime('2026-10-25 00:00:00') AND called_at < toDateTime('2026-11-01 00:00:00')
  AND context = 'checkoutAjax' AND gds = 'amadeus' AND gds_currency = 'USD'
  AND origin_airport = 'YVR' AND destination_airport = 'DEL' AND trip_type = 'roundtrip'
  AND successful_call AND multiticket_part IS NULL AND user_currency IN ('CAD', 'USD')
GROUP BY user_currency
ORDER BY user_currency
```

**Query guidance:**
- **Size class:** medium. 16,981,896 rows (sum of Q0). About 635,000 rows per week: Q1 sums to 634,854 rows for 2026-10-25 00:00:00 to 2026-11-01 00:00:00, America/New_York.
- **Recommended constraints:** a `called_at` window in every query (it is the partition key and the sorting key). Add `context = 'checkoutAjax'` for checkout page questions, `gds` for one upstream system, and `NOT successful_call` for failures. Add a `called_at` window to a `search_id` lookup too (Q9).
- **Typical date range:** the shard table deletes rows 6 months after `called_at` (TTL). The first row is 2026-05-15 10:46:02 America/New_York (Q0, 2026-11-02). Typical windows: 1 to 7 days.

**Notes:**

Numbers in these notes come from the Q queries. Their window is 2026-10-25 00:00:00 to 2026-11-01 00:00:00, America/New_York, unless the stamp says otherwise.

1. **Which calls write a row.**
   - One row per ticket part, written after the upstream call. A multi-ticket package writes two rows, `master` and `slave` (Q10).
   - Two cases return before the upstream call and write no row: an upgraded package, and (when the caller sets the timestamp check) a package that has a stored delayed fare increase and was checked less than 10 minutes ago. Code: `include/Mv/Ota/Fare/Package.php:9046-9078`.
   - A row does not prove a real upstream call. An upstream system with no check code is marked as checked and counts as available. Code: `Package.php:10385-10391`. Intelisys shows this: in Q2 its `avg_s` is 0.0 and no price moves.
2. **`after_*` is the upstream price, not always the price the user pays.**
   - The writer applies the upstream answer to a copy of the package, even when the real package is not changed. Code: `CheckAvailabilityCall.php:169-173`.
   - For some upstream systems, the check does not update the package fares on normal traffic (not Google Flights). The list is in code: 13 systems at genesis `ed5f38af91b`. Code: `Package.php:9090-9108`. Commit `aaabb0209e0` (2026-10-30) added Frontier NDC, so the list changes over time.
   - Example, Amadeus in Q2: 10,255 successful checks have `after_total` more than 1.50 above `before_total`, and 9,584 of them have no decision.
   - A delayed fare increase keeps the package at the search total with a negative markup (Code: `Package.php:9062-9065`). `after_total` keeps the upstream price.
3. **`should_delay_fi` is the decision for the whole package.**
   - The code sets it after the fare comparison, and only when the comparison found a fare increase. Code: `Package.php:9199-9212`.
   - NULL: no fare increase found. This includes calls where `after_total` is higher but the package was not updated (Note 2).
   - `true`: found, and delayed. `false`: found, and not delayed (the price change banner path, Code: `Package.php:9259-9266`).
   - A multi-ticket package writes the same value on both part rows. In Q10, `master` and `slave` both have 256 rows with `false` and 772 rows with `true`. So a part row can carry a decision although its own price did not rise, or although its own call failed.
   - On single-ticket rows with a decision, 37,388 of 37,418 rows also show a price rise of more than 1.0 on the same row (Q10; amounts in `gds_currency`).
4. **Amounts are in `gds_currency`.**
   - For a package priced in two currencies, the writer switches the package to the upstream currency before the call, then builds `before_*` and `after_*` in that currency. Code: `Package.php:1103-1118` and `CheckAvailabilityCall.php:181`.
   - Q14 shows the effect. On one route with `gds_currency` `USD`, the median `before_total` is 1,472.40 USD for CAD users and 1,440.96 USD for USD users.
5. **`notices` can disagree with the amount columns.**
   - `TotalIncreased` and `TotalDecreased` compare base + tax only. A markup change does not set them. Code: `CheckAvailabilityCall.php:263-271`. The base + tax rule dates from 2026-07-15 (commit `cceece3d9df`).
   - Some rows carry flags that the stored amounts do not show. In Q11, 1,694 rows have the `Tax` flag with `before_tax = after_tax`, and 1,262 rows have `TotalIncreased` with base + tax not higher.
   - The cause was not traced. To trace it, read the debug log entry that the same check writes (Code: `Package.php:1120-1124`; entry name `check-availability-response-single`, `-master`, or `-slave`).
   - Compare the amount columns when you need an exact answer.
6. **`id` is not unique on every row.** Q11 finds 2 rows with an empty `id` and 58 extra rows that share an `id` with another row (634,854 rows in the window). That is under 0.01% of rows, so ignore it for rates. The cause was not traced.
7. **Time zone.**
   - `called_at` is a `DateTime` without its own time zone. ClickHouse shows it in the server time zone: `SELECT timezone()` returns `America/New_York` (2026-11-02).
   - The stored value is a UNIX timestamp, so `toDateTime('...')` literals use the same zone.
   - The clocks changed on 2026-11-01 at 02:00 (from Eastern Daylight Time to Eastern Standard Time). A local-time window that includes that hour is one hour longer.
8. **Writer and path to ClickHouse.**
   - Code: genesis `src/CheckAvailability/Data/CheckAvailabilityCall.php`, branch `develop` at commit `ed5f38af91b` (2026-11-02).
   - `fromPackage()` builds the row (lines 155-287). `broadcast()` pushes it to the Kafka topic `jupiter_check_availability_call` (lines 309-318; topic name at `src/Kafka/Topic.php:147`).
   - The caller is `include/Mv/Ota/Fare/Package.php`: lines 1092-1118 build the row after the upstream call, and lines 9199-9212 add `should_delay_fi` and send the row.
   - The message follows an Avro schema (`src/CheckAvailability/Data/CheckAvailabilityCallAvroSchema.php`).
   - The consumer that writes to ClickHouse is not in genesis. It was not traced.
