## fare_increase_events

**Database:** `gtm_views`
**Engine:** `Distributed` over `gtm_views.fare_increase_events_shard` (`ReplicatedMergeTree`, `PARTITION BY toYYYYMM(fare_increase_event_timestamp)`, `ORDER BY (fare_increase_event_timestamp, surfer_id, search_id, package_id, checkout_id, bookability_customer_attempt, ip_override)`). Fed by the materialized view `gtm_views.fare_increase_event_view`.
**Rows:** ~241K (2025-02-13 → 2026-10-06).
**Purpose:** One row per web front-end (GTM `dataLayer`) event on the fare-increase popup at checkout: shown, accepted, or denied. Use it to answer "did the user see the fare increase, and what did they do?" for **web** traffic.

| Column | Type | Description |
|--------|------|-------------|
| `fare_incease_event` | `Enum8` | **Typo in the column name** (`incease`). Values: `fare_increase_displayed`, `fare_increase_accepted`, `fare_increase_denied`. |
| `fare_increase_event_timestamp` | `DateTime` | When the event fired. Stored with America/Toronto offset (`-04:00` in September–October). Partition and sort key — always bound on it. |
| `database_timestamp` | `DateTime` | When the row landed. |
| `search_id` | `String` | Search hash. Equals `ota.optimizer_attempts.search_id` and `ota.bookings.debug_transaction_id`. |
| `package_id` | `String` | Package on the page when the event fired. **Often differs from the package the fare increase was built on** — see Notes. |
| `fare_price_difference` | `Float64` | Increase shown to the user = `fareChangeDetails.new_price - old_price` (storefront `FareIncreaseModal.tsx`). |
| `checkout_id` | `String` | Checkout session id. |
| `bookability_customer_attempt` | `UInt64` | Customer attempt id (`ota.bookability_customer_attempts.id`). |
| `affiliate_id` / `campaign_id` | `UInt64` | Traffic source. |
| `site_id` / `site_name` | `Nullable` | `FlightHub` = 1, `justfly.com` = 4. |
| `page_location` / `page_hostname` / `page_title` / `page_referrer` | `String` | Page where the popup opened. |
| `surfer_id`, `client_id`, `session_*`, `visit_*`, `*_cookie`, `consent`, `user_agent`, `language`, `screen_resolution`, `viewport_size`, `ip_override`, `cdata_unique_event_id`, `version` | — | Standard GTM session / device fields. |

**Writers (code):**
- New storefront: `genesis-storefront` `src/js/components/checkout/modals/BookingError/FareIncreaseModal.tsx` → `fireEventFareIncreaseAnalytics()` in `src/js/helpers/dataLayer.ts`. `displayed` fires once when the popup opens; `accepted` on Accept (or PayPal / Apple Pay authorized inside the popup); `denied` on "Show more options".
- Legacy (control) checkout: genesis `include/Mv/Ota/OtaCommon/View/Partials/FareChange/modalFlightFareIncrease.php` (same three events).
- Both writers also send the same payload to `Mv.CheckoutInteraction` / `Mv.CheckoutAttemptInteraction`, which writes MySQL [`ota.bookability_checkout_interactions`](../mysql/bookability_checkout_interactions.md). **Prefer that MySQL table** for coverage — this GTM table loses rows to consent / ad blockers.

**Key relationships:**
- `search_id` → `ota.optimizer_attempts.search_id`, `ota.bookings.debug_transaction_id`, MongoDB `ota.debug_logs.transaction_id`.
- `bookability_customer_attempt` → `ota.bookability_customer_attempts.id`.

**Common queries:**
```sql
-- Fare-increase popups for a set of searches, matched on the amount (not on package_id)
-- Verified 2026-10-05 on search 5b777cced5d9d6f5f54cde96d8e056d4 (2301.48 displayed 2026-10-05 16:48:47 -04:00).
WITH cases AS (
  SELECT * FROM VALUES('search_id String, expected_diff Float64',
    ('5b777cced5d9d6f5f54cde96d8e056d4', 2301.48))
)
SELECT c.search_id, e.package_id, e.fare_incease_event, e.fare_price_difference, e.fare_increase_event_timestamp
FROM cases c
JOIN gtm_views.fare_increase_events e ON e.search_id = c.search_id
WHERE e.fare_increase_event_timestamp >= '2026-09-14'
  AND abs(e.fare_price_difference - c.expected_diff) < 1
ORDER BY e.fare_increase_event_timestamp;

-- Daily volume by event
SELECT toDate(fare_increase_event_timestamp) d, fare_incease_event, count()
FROM gtm_views.fare_increase_events
WHERE fare_increase_event_timestamp >= now() - INTERVAL 7 DAY
GROUP BY d, fare_incease_event ORDER BY d;
```

**Notes:**
- **Web only.** The native iOS / Android app (`user_agent` contains `CFNetwork` / `AppVersion`, affiliates such as 1091 / 1121 "Mobile App …") writes nothing here.
- **Match on `search_id` + `fare_price_difference`, not `package_id`.** Across the split-payment fare increases of 2026-09-15 → 10-05, matching on the package found 1,813 cases; matching on search + amount (±1) found 550 more under a different `package_id`.
- **Coverage gap vs the MySQL interactions table.** On 2026-10-01: this table had 683 rows (all three events); `ota.bookability_checkout_interactions` had 766 (457 / 121 / 188). Treat a missing row here as "unknown", not "not shown".
- **A fare increase is not always shown as a popup.** See [`bookability_checkout_interactions.md`](../mysql/bookability_checkout_interactions.md#when-a-fare-increase-is-not-displayed) for the rules (Google Flights meta → error; `double_fi_then_fna` → alternative flights).
