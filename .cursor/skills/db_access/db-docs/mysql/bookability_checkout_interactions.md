## bookability_checkout_interactions

**Database:** `ota`
**Engine:** `InnoDB`  |  **Rows:** ~14.2M (InnoDB estimate)  |  **Size:** ~3.0 GB
**Purpose:** Server-side log of what the web checkout page showed and what the user did — one row per front-end interaction (booking attempt launched, error shown, fare-increase popup shown / accepted / denied, …). Written by the server from `Mv.CheckoutInteraction.track()` / `Mv.CheckoutAttemptInteraction.track()` calls, so ad blockers and consent do not drop rows (unlike GTM [`gtm_views.fare_increase_events`](../clickhouse/fare_increase_events.md)).

| Column | Type | Description |
|--------|------|-------------|
| `id` | `bigint` PK | Auto-increment. |
| `checkout_id` | `varchar(255)` | Checkout session id. **Indexed.** |
| `search_id` | `varchar(255)` | Search hash. **Not indexed** — always bound on `date_created` first. |
| `package_id` | `varchar(255)` | `NULL` on fare-increase events (checked 2026-10-01). Do not join on it. |
| `surfer_id` | `varchar(255)` | Surfer id. |
| `customer_attempt_id` | `bigint` | `ota.bookability_customer_attempts.id`. |
| `event` | `varchar(255)` | Interaction name — see table below. |
| `payload` | `text` | JSON string. Fare-increase events: `{"price_difference":"562.1"}`. `error_displayed`: `{"user_error_display": …, "error_type": …}`. |
| `date_created` | `datetime` | America/Toronto. **Indexed** — primary time filter. |

**Event values (2026-10-01, one day):** `booking_attempt_launched` 14,458 · `error_displayed` 6,612 · `fare_increase_displayed` 457 · `allowed_attempt_displayed_price_discrepancy` 254 · `fare_increase_denied` 188 · `fare_increase_accepted` 121 · `generic_error_displayed` 43 · `allowed_locked_package_book_attempt` 42 · `blocked_locked_package_book_attempt` 13 · `time_lapse_session_expired` 1.

**Writers (code):** genesis `Mv_Ota_Bookability_Checkout_Interaction` (`include/Mv/Ota/Bookability/Checkout/Interaction.php`, table name in `Interaction/Metadata.php`). Front-end calls: storefront `src/js/helpers/dataLayer.ts` `fireEventFareIncreaseAnalytics()`; legacy `include/Mv/Ota/OtaCommon/View/Partials/FareChange/modalFlightFareIncrease.php`. Booker also writes rows directly (`include/Mv/Ota/Air/Booker/Manager.php:641`, `include/Mv/Ota/Flighthub/App/Checkout.php:5633`).

**Key relationships:**
- `search_id` → `ota.optimizer_attempts.search_id` / `ota.bookings.debug_transaction_id`. Collations differ — convert explicitly when joining from `optimizer_attempts` (utf8mb4).
- `customer_attempt_id` → `ota.bookability_customer_attempts.id`.

**Common queries:**
```sql
-- Fare-increase popup events for one search
SELECT event, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.price_difference')) AS price_difference, date_created
FROM ota.bookability_checkout_interactions
WHERE date_created >= '2026-09-15' AND date_created < '2026-10-07'
  AND search_id = :search_id
  AND event IN ('fare_increase_displayed', 'fare_increase_accepted', 'fare_increase_denied')
ORDER BY date_created;

-- What error the page showed instead (e.g. Google Flights fare increase)
SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.error_type')) AS error_type,
       JSON_UNQUOTE(JSON_EXTRACT(payload, '$.user_error_display')) AS shown_as, COUNT(*)
FROM ota.bookability_checkout_interactions
WHERE date_created >= NOW() - INTERVAL 1 DAY AND event = 'error_displayed'
GROUP BY error_type, shown_as ORDER BY 3 DESC;
```

**Query guidance:**
- **Size class:** large (~14M rows). Always bound `date_created`. A `search_id IN (…)` filter without a date bound scans the table.
- For many searches, pull the event rows for the window once (fare-increase events: ~16K rows for 3 weeks) and join in code; a correlated `EXISTS` from `optimizer_attempts` over 3 weeks ran past 10 minutes (2026-10-06).
- Match a fare increase on `search_id` + `price_difference` (±1), after the attempt time. `package_id` is `NULL`.

### When a fare increase is not displayed

Confirmed 2026-10-06 on the 6,014 split-payment fare increases (`IneligibleSplitPayment` attempts, 2026-09-15 → 10-05 Toronto). The booker throws `Mv_Ota_Air_Booker_Exception_FareIncrease` (MongoDB `debug_logs` `handling-booking-exception`) in every case; what the user sees depends on:

| Case | Rule (code) | What the user sees | Interaction rows | Cases |
|------|-------------|--------------------|------------------|-------|
| **Google Flights meta** (`affiliate_id` 1042) | `Manager::convertFareIncreaseExceptionToGenericForGoogle()` (`Manager.php:5988-6002`) converts to `FareIncreaseNotAllowed` and marks the package sold out 4 h | Error, no popup | `error_displayed` with `error_type: fare_increase_not_allowed` | 906 — 0 popups |
| **Increase ≥ old price and old price ≥ 100** (new ≥ 2× old), not Google | GrowthBook `double_fi_then_fna` (forced `true` for `affiliate_id != 1042`, production) → `FareIncreaseDelayedFna::shouldThrowFlightUnavailable()`; `DisplayBookingErrorTrait.php:102-110` | "Flight not available" + alternative flights | `error_displayed` with `user_error_display: show_alternative_flights` | web 838 of 1,170 had no fare-increase event |
| **Native app** (`user_agent` `CFNetwork` / `AppVersion`; source `storefront-api/book`) | App does not call the interaction tracker | Popup shown by the app (accepted cases exist, e.g. search `14b98d0bcf11c148ceca4df5d841132a` → retry attempt 19481011) | **None** — not tracked | 571 — use the next optimizer attempt at the new price as proof of acceptance |
| **Web, below the 2× rule** | `show_fare_increase` | Popup | `fare_increase_displayed` (+ accepted / denied) | 2,374 same amount; 891 amount within ~±20% (Assumption: page amount is built from package totals incl. other items); 67 no event (~2%) |
