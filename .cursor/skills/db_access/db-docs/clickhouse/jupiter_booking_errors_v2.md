## jupiter_booking_errors_v2

**Database:** `jupiter`
**Engine:** Distributed  |  **Rows:** N/A (distributed)  |  **Size:** N/A
**Purpose:** Pre-classified booking errors with the raw supplier/integration error message. Used as the starting point for content integration health scans — provides richer error text than MySQL `contestant_error` codes without requiring the full bookability join chain.

| Column | Type | Description |
|--------|------|-------------|
| `timestamp` | DateTime | When the error occurred — use for all time-bound filters |
| `gds` | String | Content source / GDS identifier (e.g. `dida`, `flightroutes24`, `amadeus`) |
| `gds_account_id` | String | Specific account/credential set within the GDS (e.g. `DIDACAD`, `FLIGHTROUTES24USD`) |
| `validating_carrier` | String | Airline IATA code for the booking attempt |
| `affiliate` | Int32 | Affiliate/partner ID |
| `route` | String | Origin-Destination pair (e.g. `YYZ-LHR`) |
| `departure_date` | DateTime | Outbound departure date |
| `return_date` | DateTime | Return departure date |
| `number_of_adults` | Int32 | Passenger count — adults |
| `number_of_children` | Int32 | Passenger count — children |
| `number_of_infants_on_seat` | Int32 | Passenger count — infants on seat |
| `number_of_infants_on_lap` | Int32 | Passenger count — infants on lap |
| `booking_step` | String | Step in the booking flow where the error occurred (e.g. `Mv_Ota_Air_Booker_Dida->verifyPriceOperation()`) |
| `search_id` | String | **= MongoDB `transaction_id` = MySQL `search_hash`** — the cross-system join key |
| `package_id` | String | Package identifier |
| `error_message` | String | Raw error text from the supplier or integration — often the actual supplier message, richer than MySQL error codes |
| `main_group_error` | String | Our internal error group (e.g. `Mv_Ota_Air_Booker_Exception_GdsError`) |
| `sub_group_error` | String | Our internal sub-group |
| `front_end_message` | String | Customer-facing error message shown in the UI |
| `classification_category` | String | High-level category — see taxonomy below |
| `classification_subcategory` | String | More specific subcategory |

**`classification_category` taxonomy:**

| Category | Meaning | Include in integration scan? |
|---|---|---|
| `CONTENT_SOURCE_ERRORS` | Supplier error, GDS error, integration failure | ✅ Yes |
| `TECHNICAL_ERRORS` | Internal code errors | ✅ Yes |
| `CUSTOMER_INPUT_ERRORS` | Passenger data validation failures (may indicate our mapping issues) | ✅ Yes |
| `OTHER` | Unclassified | ✅ Yes |
| `FLIGHT_AVAILABILITY_ERRORS` | Flight/seats no longer available | ❌ Exclude (availability noise) |
| `FARE_INCREASES` | Fare price changed since search | ❌ Exclude (pricing noise) |
| `PRICING_DISCREPANCY_ERRORS` | Cannot price, fare unavailable | ❌ Exclude (pricing noise) |
| `PAYMENT_ERRORS` | Card declines, payment failures | ❌ Exclude (not integration issues) |

**Key relationships:**
- `search_id` joins to `debug_logs.transaction_id` (MongoDB) for deep-dive investigations
- `search_id` joins to `bookability_contestant_attempts.search_hash` (MySQL) if full bookability metrics are needed

**Common queries:**

```sql
-- Integration error scan (last 7 days, all sources)
SELECT gds, classification_category, classification_subcategory, error_message,
       COUNT(*) AS c, groupArray(10)(search_id) AS sample_search_ids
FROM jupiter.jupiter_booking_errors_v2
WHERE timestamp >= now() - INTERVAL 7 DAY
  AND classification_category NOT IN (
    'FLIGHT_AVAILABILITY_ERRORS', 'FARE_INCREASES',
    'PRICING_DISCREPANCY_ERRORS', 'PAYMENT_ERRORS'
  )
  AND search_id != ''
GROUP BY gds, classification_category, classification_subcategory, error_message
HAVING c >= 5
ORDER BY gds, c DESC
```

**Query guidance:**
- **Size class:** medium-large (Distributed across shards) — always filter by `timestamp`
- **Recommended constraints:** `timestamp` range required; optionally `gds` for single-source queries
- **Typical date range:** rolling 7–30 days for integration health scans

**Notes:**
- `error_message` is the actual text captured from the supplier response or our integration code — use it directly as the signature for Mongo `$regex` matching in deep-dives, saving a discovery round
- `booking_step` naming convention follows `Mv_Ota_Air_Booker_{GDS}->{method}()` patterns
- Engine is Distributed — `total_rows` is not reported in `system.tables`; use `COUNT(*)` with a time filter for row estimates
