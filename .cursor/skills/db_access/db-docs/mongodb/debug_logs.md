# debug_logs

**Database:** `ota`

**Purpose:** General debug and error logs from various OTA (Online Travel Agency) processes, capturing transaction context, fare families, and server metadata.

This document also holds **investigation context** for this collection: where else to look, glossary terms, and **verified** per–content-source log hints. Append stable facts here when you confirm them; **query behavior and filters** are in `.cursor/skills/db_access/references/mongodb_query_mechanics.md`.

---

## When to read the sections below

- Before non-trivial work that uses `debug_logs`: bookability deep dives, payments/charges, supplier-specific behavior, or “where are the debug logs for …”.

## When to update (glossary & hints)

- After you confirm something **reusable** and **stable**: log filters, service names, glossary entries, per–content-source rows in the hints table.
- Do **not** use this file as a scratchpad for one-off hypotheses. Prefer short factual bullets.
- If a fact belongs in `**.cursor/skills/db_access/db-docs/**` for another table/collection, **link there** instead of pasting schema detail.
- **How to edit:** append or small patches; correct wrong lines with a brief date in the changelog if useful.

---

## Glossary (internal & common terms)


| Term   | Meaning                    | Notes                                                                                                                                                                                                            |
| ------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payhub | Internal payment processor | Use when investigating **charges on our merchant**, internal payment flow, or Flighthub-side payment handling (not only external card gateways). **Extend this row** when you confirm log sources or dashboards. |


*Add rows as you confirm definitions.*

---

## Observability by workflow

### Bookability / content sources

- MySQL `ota` bookability tables are the **first** stop for rates and attempts; see `**.cursor/skills/bookability/references/standard_bookability_report.md**` for the SQL template.
- `**debug_logs**` often holds supplier-side detail after SQL; the bookability skill describes when to go there. **Add per–content-source log hints** in the table below when verified.

**Content source hints** (log filters, services, caveats — verified entries only):


| Content source / area                   | Where to look                                                                                     | Hint                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Flightroutes24** — verify step        | `context: "flightroutes24-api[ACCOUNT] pricing.do"`                                               | Supplier JSON response in `Response` field. Error shape: `{"code":"XXXXXXXX","message":"[Verify Failed]:..."}`. Known codes: `20901231` (GDS/airline issue, CRITICAL), `20703204` (GDS/airline issue, retry from search), `10701298` (offerId already used — our retry reusing stale offer). Do **not** rely on `Flightroutes24-booker-unknown-error` context — that context has no response data. |
| **Flightroutes24** — booking step       | `context: "flightroutes24-api[ACCOUNT] booking.do"`                                               | Supplier JSON in `Response`. Error shape: `{"code":"XXXXXXXX","message":"[AIRLINE ERROR]:Booking failed"}`. Known codes: `20901219`, `20901220`, `20901221` — FR24 maps multiple airline rejections to these codes; request underlying detail from FR24. Verify step (`pricing.do`) is often `code: 000000 / "ok"` on the same transaction.                                                        |
| **Amadeus** — all booking/pricing steps | `context: "amadeus-sh4-api[OFFICE] OperationName"` or `"amadeus-redux-api[OFFICE] OperationName"` | Supplier SOAP XML is in lowercase `**response**` field (not `Response`). Key operations: `PNR_AddMultiElements_*` (booking), `Fare_PriceUpsellWithoutPNR` (fare pricing). Always query both `Response` and `response` when filtering Amadeus logs.                                                                                                                                                 |
| **Unififi** — verify step               | `context: "unififi-api[ACCOUNT] verify-price"` (accounts `UNIFIFICAD` / `UNIFIFIUSD`; last 7 days of contestant attempts were `UNIFIFIUSD` only, confirmed 2026-08-13) | Request is wrapped: parse `Request` JSON → `body.routing.payload`. Response: `result.errorCode` `0` = success, `3` = failure (often `[trans_flow]Seat/Fare No Available`). **Search** payload is 4 segments (`V4#uuid#N#longId`); **verify response** payload is 2 segments (`V4#uuid`). `_scopes`: booker verify is `Booking` + `Unififi`; later baggage verify is `BaggageOptimization` + `BaggageOptimization-unififi-UNIFIFIUSD` (no space). Checkout-only baggage verifies already send the 4-part search payload. The mismatch is the `BaggageOptimization` verify **after** the `Booking` verify, which used to send the 2-part verify-response value and get status `3`. Confirmed 2026-08-13 on `64871a9829e126a719b06a3eac71c7aa`. |
| **Dida** — fare basis                   | `context: "Dida::VerifyPrice"` (`Request` / `Response`); also `info.dida.routing` on `pre-checkout` `Package` | Dida puts adult and child fare basis on the **same segment** as `ADT^CHD` (example `AAUD0ZBW^AAUD0ZBW`). The caret is in Dida’s `fromSegments[].fareBasis`. We copy it onto the package with no transform. Confirm on `Dida::VerifyPrice` `Response.routing.fromSegments` (Dida’s own JSON) and on stored `info.dida.routing.fromSegments`. Confirmed 2026-08-21 on `fa10e7959efbf56a62365159120db3ee`. |
| **Amadeus Mini Rules** — checkout SOAP | `context: "amadeus-sh4-api[OFFICE] MiniRule_GetFromPricing_11_1"` | Checkout booking-rules fetch before a PNR. `_scopes` is `null`. SOAP XML is in lowercase `request` / `response` (not `Request` / `Response`). `operation` is `MiniRule_GetFromPricing_11_1`. `source` is the `get-booking-rules/{search_id}/{package_id}` URL. Confirmed 2026-08-27 on `aaa824e9b77284710dc5dea75aa3e976#6a905f8cadcdc20c7c0f782d`. |
| **Booking rules from package** | `context: "booking-rules-from-package"` | Written at the same checkout fetch. Fields: `rules` (Mini Rules / unknown), optional `rules-routehappy` and `rules-comparison` when Route Happy ran. `_scopes` is `null`. Several entries can share the context; use the later one. `mini_rules_skipped` is **absent** on production samples through 2026-08-27 (the checkout skip is off in production). Permalink with Route Happy present, no skip flag: `b5067766983fdefeec1a0ddd8d1d3ed6#6a905dde5b7d8ec4bf07c4a5`. SQL mirror: `ota.booking_rules_shadow`. |


### Payments / charges (Payhub)

- See **Glossary → Payhub**. **Add** index names, log service names, or query patterns here once confirmed.
- **Virtual-card eligibility** — `context: "booker-payment-manager-vcc-availability"`. Evaluated more than once per transaction. `_scopes` `Booking` is checkout / booker. `_scopes` `TicketProcessor` is ticket-issue recovery. Payload fields `connexpay-volume-shift-result` and `b2b-wallet-availability-result` are JSON strings with `success` and `context`. Production rows through 2026-08-20 have `context` as `{timestamp}` only. Confirmed 2026-08-20 on `0e53cda9c9eddd7b21a114d259a81948` (`Booking`, all `success` false, cheque) and `d8442ea76fe2cd7fb1ed206a6a65066b` (`TicketProcessor`, `success` true, virtual-card try).

---

## Related data & tools


| Need                                                  | Where                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Table/collection purpose & columns (other stores)     | `.cursor/skills/db_access/db-docs/` and `.cursor/skills/db_access/scripts/mysql_query.py`, `.cursor/skills/db_access/scripts/mongo_query.py`, `.cursor/skills/db_access/scripts/clickhouse_query.py` |
| Bookability SQL workflow                              | `.cursor/skills/bookability/references/standard_bookability_report.md`                  |
| MongoDB query rules (`debug_logs` / `optimizer_logs`) | `.cursor/skills/db_access/references/mongodb_query_mechanics.md`                            |
| Optimizer-only repricing logs                         | `.cursor/skills/db_access/db-docs/mongodb/optimizer_logs.md`                                                              |


---

## Changelog (optional)


| Date       | Change                                       |
| ---------- | -------------------------------------------- |
| 2026-08-27 | Mini Rules checkout SOAP + `booking-rules-from-package` field shape; `mini_rules_skipped` still absent in production. |
| 2026-08-26 | `Customer-Attempt-Price-Discrepancy`: absorb ≤ $2, fare-increase only if > $2; alert is not an abort. |
| 2026-08-21 | Dida fare basis `ADT^CHD` on `fromSegments[].fareBasis`; `Dida::VerifyPrice` + `info.dida.routing`. |
| 2026-08-20 | Virtual-card eligibility: `booker-payment-manager-vcc-availability`; `Booking` vs `TicketProcessor` `_scopes`. |
| 2026-08-13 | Unififi verify-price: `_scopes` `BaggageOptimization` (no space); mismatch is post-Booking baggage verify, not checkout-only. |
| 2026-08-12 | Added Unififi verify-price payload / status-3 hint. |
| 2026-04-20 | Added FR24 and Amadeus content-source hints. |


---

## Log flow & key contexts

`debug_logs` records the end-to-end journey of a transaction. Below are the most important `context` values and markers to look for during an investigation:

### 1. Checkout & Pre-booking

- `**checkout-deeplink**`: Triggered when a user clicks through from a meta-search site (e.g. Google Flights, Kayak) to our checkout page.
- `**pre-checkout**`: Initial validation and setup of the checkout session, including fare verification.
- `**Check Availability**` (marker in `_scopes`): Calls to the supplier/GDS to confirm the fare is still available and hasn't changed price before the user enters details.

### 2. Booker & Pre-processing

- `**pre-air-booker**`: Final checks before the actual booking attempt. This is where **Optimization** and **Loss Limit** logic typically runs.
- `**Optimization**` (marker in `_scopes` or `context`): Logs from the booking optimizer attempting to find a better fare or alternative GDS path to maximize margin or bookability.
- `**loss-limit-fare-increase**`: Logged if the fare has increased beyond the allowed threshold (loss limit), potentially stopping the booking.
- `**Customer-Attempt-Price-Discrepancy**`: Alert when the checkout displayed total is below the package total. Message shape: `Customer expects to pay $X, but package is priced at $Y`. Diffs **≤ $2** are absorbed: the booker rewrites the package to the displayed total and writes checkout event `allowed_attempt_displayed_price_discrepancy`. Diffs **> $2** throw a fare-increase. The alert also fires on attempts that later issue — it is not itself an abort. Confirmed 2026-08-26 on `0a0c7d5aa26ed1d275908722a64e217a` ($793.72 vs $793.73; same alert on issued booking `306983071`).
- `**booker-discount-option**`: Details on any discounts applied by the booker logic (e.g. member discounts, promo codes).

### 3. Payment (Payhub)

- `**payhub_api_request_...**` / `**payhub_api_response_...**`: Communication with **Payhub** (our internal payment processor).
  - `Verify`: Card validation/authorization.
  - `ThreeDs` / `UpdateThreeDs`: 3D Secure authentication flow.
  - `IssueCard`: Generation of a virtual credit card (VCC) to pay the supplier.
  - `Sale`: The actual charge to the customer's card.
  - `CancelCard`: Voiding a VCC if the booking fails.

### 4. Booking & Post-processing

- `**Booking flow**` (marker in `_scopes`): The core logic that sends the `Book` request to the supplier/GDS.
- `**post-air-booker**`: Tasks that run after the booking attempt, such as sending confirmation emails, updating internal databases, or triggering ticketing.
- `**CancelProcessor**` (marker in `_scopes`): Triggered if a booking fails or is cancelled, handling the cleanup (voiding payments, notifying the user).

### 5. Ticketing (Ticketer)

- `**Ticketer**` (marker in `_scopes`): The main ticketing process.
- `**AirTicketRQ**` (operation in payload): The actual request sent to the GDS (e.g. Sabre) to issue the tickets.
- `**pending-statement-transaction**` / `**current-statement-item**`: Logs related to finalizing the financial records (statement items) for the booking during ticketing.
- `**SessionCloseRQ**` (operation in payload): Closing the GDS session after ticketing is complete.

---

## Field reference


| Field                     | Type       | Description                                        |
| ------------------------- | ---------- | -------------------------------------------------- |
| `_id`                     | `ObjectId` | Unique identifier for the log entry                |
| `meta`                    | `Object`   | Metadata associated with the log                   |
| `_scopes`                 | `Array`    | Execution scopes or contexts                       |
| `available_fare_families` | `Array`    | List of fare families available at the time of log |
| `base_fare_family`        | `String`   | The base fare family used                          |
| `package`                 | `Object`   | Package information if applicable                  |
| `context`                 | `String`   | Description of where the log was triggered         |
| `level`                   | `String`   | Log level (e.g. info, error, debug)                |
| `source`                  | `String`   | Source component or service name                   |
| `transaction_id`          | `String`   | Unique ID for the user transaction                 |
| `ip`                      | `String`   | Client IP address                                  |
| `server_ip`               | `String`   | Server IP address that processed the request       |
| `date_added`              | `ISODate`  | Timestamp when the log was created                 |
| `user_agent`              | `String`   | Client user agent string                           |
| `pid`                     | `Int`      | Process ID                                         |


**Indexes:**

- `_id`_: `_id: 1`
- `transaction_id`_: `transaction_id: 1`
- `context_`: `context: 1`
- `date_added_`: `date_added: 1`
- `ip_`: `ip: 1`

**Common queries:**

```javascript
// Find logs for a specific transaction
db.debug_logs.find({ "transaction_id": "TRANS-123" }).sort({ "date_added": -1 })

// Find error logs from the last hour
db.debug_logs.find({
  "level": "error",
  "date_added": { "$gt": new Date(Date.now() - 3600000) }
})
```

**Notes:**

- This is a capped collection, meaning old logs are automatically overwritten when it reaches its size limit.
- Sorting by `date_added` is recommended for time-series analysis.

