# Booking flow

The spine of the platform: what happens from the moment a user lands on the checkout page to a confirmed (or failed) booking. Most investigations touch this file first because a symptom seen late in the flow often has an earlier root cause.

_Behavior only. Schemas: `../../db_access/db-docs/`. Terms: `../../../GLOSSARY.md`. Code: genesis. Seeded 2026-07-30 from `debug_logs.md` and the bookability / qa_assistant skills; extend via the maintenance loop. Bookability measurement and single-booking tracing merged in from the old bookability notes 2026-11-04._

## Stages, in order

The end-to-end journey for one transaction, keyed by `debug_logs.context` / `_scopes` markers (join key `transaction_id` = MySQL `search_hash` = ClickHouse `search_id`):

1. **Checkout & pre-booking**
   - `checkout-deeplink` — user clicked through from a meta-search site (Google Flights, Kayak) to the checkout page.
   - `pre-checkout` — validates and sets up the checkout session, including fare verification.
   - **Check Availability** (marker in `_scopes`) — the availability check that runs on the checkout page. Re-validates / reprices the package against the supplier. It does **not** change the price shown to the user (search price stands) — see `GLOSSARY.md`. Failure or a price move here is a common "fare disappeared / changed" root cause.

2. **Booker & pre-processing** (`pre-air-booker`)
   - **Optimization** (marker) — the optimizer looks for a better fare / alternative supplier path. This is where a booking can get **rerouted to a different content source** mid-checkout. See [`optimizer.md`](optimizer.md).
   - **loss-limit-fare-increase** — logged when the fare rose past the allowed loss-limit threshold between search and book; can stop the booking. Counts as a bookability failure (not a payment failure) in the bookability-rate lens.
   - `booker-discount-option` — discounts applied by the booker (member discounts, promo codes).

3. **Payment** (`payhub_api_request_*` / `payhub_api_response_*`) — see [`payments.md`](payments.md). Ordered Verify → 3DS → IssueCard → Sale → CancelCard-on-failure.

4. **Booking & post-processing**
   - **Booking flow** (marker in `_scopes`) — the core logic that sends the `Book` request to the supplier / GDS.
   - `post-air-booker` — runs after the booking attempt: confirmation email, internal DB updates, triggers ticketing.
   - **CancelProcessor** (marker) — fires when a booking fails or is cancelled; voids payments, notifies the user, cleans up.

5. **Ticketing** — see [`ticketing.md`](ticketing.md).

## Normal vs abnormal

- **Normal:** each stage's context appears once per transaction, in order; `Check Availability` returns the same package; the `Book` request succeeds; a row lands in `ota.bookings`; ticketing follows.
- **Abnormal signals:** `Check Availability` failing or repricing upward; `loss-limit-fare-increase` present; `CancelProcessor` firing; a `Book` step with a supplier error in `Response`; no `ota.bookings` row for a transaction that reached payment; the booked `gds` differing from the intended supplier (optimizer reroute — verify the `gds` column after any content-source pin).

## Known failure modes

- **Fare increase / loss-limit stop** — fare moved past the loss limit between search and book. Bookability failure. MySQL code `loss_limit_fare_increase`; ClickHouse `FARE_INCREASES`.
- **Availability lost at checkout** — supplier says the fare is gone during `Check Availability`. Presents to the user as "fare no longer available".
- **Supplier rejection at book** — supplier returns an error on the `Book` request; the exact text is in the supplier `Response` field (per-source hints in [`content-sources.md`](content-sources.md)).
- **Optimizer reroute** — the booked supplier is not the one intended; the optimizer swapped the candidate. See [`optimizer.md`](optimizer.md).
- **Payment failure** — declines / 3DS / gateway issues. Non-bookability; see [`payments.md`](payments.md).
- **Supplier says "similar order already exists" (Downtowntravel)** — error on `Downtowntravel::BookFlight` (`Response`) or `::Error` (`Error-Data`). ClickHouse shows it as `FLIGHT_AVAILABILITY_ERRORS` at `bookFlightOperation()`; MySQL stores the coarse `flight_not_available_other`. Two patterns seen: a rebook after the customer cancelled a same-itinerary booking, and first attempts with no prior success. Do not assume one cause. The repeat pattern needs `surfer_id` from MySQL.

## Tracing one booking

Start from a `booking_id` or a `search_hash`.

1. **Resolve the ID.** `booking_id` → `search_hash` (= Mongo `transaction_id`):
   ```sql
   SELECT search_hash FROM ota.bookability_contestant_attempts WHERE booking_id = <id> LIMIT 1;
   -- fallback when no attempt row exists:
   SELECT debug_transaction_id FROM ota.bookings WHERE id = <id>;
   ```
2. **Pull the whole timeline first.** `debug_logs` for the `transaction_id`, sorted by `date_added` ascending, no `context` filter. Filter only after the full picture is known.
3. **Split the timeline with the stage markers** in [Stages](#stages-in-order): checkout, `Check Availability`, `Optimization`, `payhub_api_*`, `Booking flow` / `pre-air-booker` / `post-air-booker`, `Ticketer` / `AirTicketRQ`, `CancelProcessor` / `CancelCard`.
4. **Find the failure.** Look for `level` `error` or `critical`, supplier `Response` bodies, and Payhub declines. When the supplier request / response and a local exception both exist for one event, read the supplier entry first (see [`observability.md`](observability.md#evidence-hierarchy-in-debug_logs)).
5. **Check the recovery.** Did the customer book on another supplier in the same customer attempt?
   ```sql
   SELECT u.status FROM ota.bookability_customer_attempts u
   JOIN ota.bookability_contestant_attempts c ON c.customer_attempt_id = u.id
   WHERE c.search_hash = '<hash>';
   ```
6. A failure the tester caused on purpose (card decline test, fare-increase injection) is not a defect. Judge whether the platform behaved as designed.

Evidence rule: a `debug_logs` line mixes several suppliers under one `transaction_id`. Keep only lines of the supplier under review (`source`, `context`, `meta`).

## How to measure bookability

Data stores and their jobs (details: [`observability.md`](observability.md#the-join-key-one-value-three-shapes)):

| Store | Use it for | Do not use it for |
|-------|-----------|-------------------|
| MySQL `ota.bookability_*` | Denominators, successes, customer attempts, `surfer_id` repeats, `master` / `slave` split, `booking_id` → `search_hash` | Real supplier error text. `bconta.error` is a coarse code (for example `flight_not_available_other`). |
| ClickHouse `jupiter.jupiter_booking_errors_v2` | Failure signatures: raw `error_message`, `booking_step`, classification, carrier | Rates. It has no success rows, no customer attempt grain, no `surfer_id`. |
| MongoDB `ota.debug_logs` | Raw supplier request / response, one-transaction timeline | Cross-source counts (expensive, capped collection). Never use `optimizer_logs` for bookability. |

Definitions:

- **Contestant attempt** — one try on one content source (`bconta`). **Customer attempt** — what the customer ends up with (`bcusta`). `bconta.status` `1` = success, `0` = failure. `bcusta.status` `1` = the customer booked.
- **Contestant bookability success rate** = `successes / (successes + bookability failures)`. Bookability failures are all `status = 0` rows except `contestant_error = 'payment_error'`. Payment failures leave both numerator and denominator. `loss_limit_fare_increase` counts as a bookability failure. A NULL or empty error counts as bookability until classified.
- **Customer recovery rate** = distinct `customer_attempt_id` with a failed contestant on the source under review **and** `bcusta.status = 1`, divided by distinct `customer_attempt_id` with a failed contestant on that source. Report counts with the percentage (for example 72 / 153 = 47%).
- **Repeat clients** — failing rows with `surfer_id` not NULL and at least 2 distinct `customer_attempt_id` in the window. Count NULL `surfer_id` separately.

Base filters (apply to every metric):

- Join `bookability_customer_attempts` → `bookability_contestant_attempts` (on `customer_attempt_id`) → `bookability_built_contestant` (on `customer_attempt_id` and `built_contestant_id`). `LEFT JOIN ota.bookings b ON b.id = bconta.booking_id`.
- Production only: `(b.is_test = 0 OR b.is_test IS NULL)`.
- Multi-ticket: count `master` and `slave` rows separately. Each leg is its own supplier call. MySQL and ClickHouse counts then match within ingestion-lag noise. A large gap points to a test flag, a window error, or lag.
- Bound `bcusta.date_created` (indexed). Never scan the whole table. State the window and timezone with every number.
- Reuse one denominator definition inside an investigation.

Core query shape (name the slice once in a CTE, then aggregate or list examples):

```sql
WITH base AS (
  SELECT bcusta.id AS customer_attempt_id, bcusta.surfer_id, bcusta.status AS customer_status,
         bconta.status AS contestant_status, bconta.error AS contestant_error,
         bconta.booking_id, bconta.search_hash
  FROM ota.bookability_customer_attempts bcusta
  JOIN ota.bookability_contestant_attempts bconta ON bconta.customer_attempt_id = bcusta.id
  JOIN ota.bookability_built_contestant bbc
    ON bbc.customer_attempt_id = bcusta.id AND bbc.id = bconta.built_contestant_id
  LEFT JOIN ota.bookings b ON b.id = bconta.booking_id
  WHERE bcusta.date_created >= '{start}' AND bcusta.date_created < '{end}'
    AND bconta.gds = '{content_source}'            -- optional: AND validating_carrier / office
    AND (b.is_test = 0 OR b.is_test IS NULL)
)
SELECT SUM(contestant_status = 1)
       / NULLIF(SUM(contestant_status = 1)
              + SUM(contestant_status = 0 AND IFNULL(contestant_error,'') <> 'payment_error'), 0)
       AS contestant_bookability_success_rate
FROM base;
-- Recovery: COUNT(DISTINCT CASE WHEN contestant_status = 0 AND customer_status = 1 THEN customer_attempt_id END)
--         / NULLIF(COUNT(DISTINCT CASE WHEN contestant_status = 0 THEN customer_attempt_id END), 0)
```

For failure causes, group ClickHouse by `(classification_category, classification_subcategory, booking_step, main_group_error, sub_group_error, error_message)` on the same window and `gds`. Feed the `search_id` list to Mongo (`transaction_id` `$in`, batches of 25 to 100, exact `context`) only when `error_message` is too coarse. Wrappers such as `Failed to reprice` can hide the real supplier code, so read one raw supplier entry per cluster before naming a cause. Rows with NULL or empty `search_id` / `search_hash` cannot be correlated; count them apart.

### Error classification lenses (MySQL ↔ ClickHouse)

State the lens with every number. The lenses disagree on fare increases.

| MySQL `bconta.error` | ClickHouse `classification_category` | Bookability-rate lens | Integration-health lens |
|---|---|---|---|
| `payment_error` | `PAYMENT_ERRORS` | Excluded | Excluded |
| `loss_limit_fare_increase` | `FARE_INCREASES` | **Included** | Excluded |
| `flight_not_available_other` | `FLIGHT_AVAILABILITY_ERRORS` | Included | Excluded |
| generic / empty / pricing wrappers | `PRICING_DISCREPANCY_ERRORS` | Included | Excluded |
| wrapped internal exceptions | `TECHNICAL_ERRORS`, `CONTENT_SOURCE_ERRORS`, `CUSTOMER_INPUT_ERRORS`, `OTHER` | Included | Included |

- **Bookability-rate lens:** only payment is excluded. Use it for "what is the bookability rate".
- **Integration-health lens:** also drops availability, fare increase and pricing. Use it for "which integration issues need a ticket".
- If supplier evidence in Mongo contradicts the SQL class (payment cause under a generic code, or the reverse), reclassify and note the mismatch. Supplier evidence wins. For payment-shaped clusters, run the checks in [`payments.md`](payments.md#known-traps) first.
- A `bconta.error` code not in the table: classify it by the ClickHouse category of the same `search_hash` / `search_id`.

### Multi-ticket pair audits

Question shape: "find carrier A + carrier B in multi-ticket bookings" (for example F8 + F8, or a content-source pair rule). Use `ota.bookability_contestant_attempts` as the grain, not `optimizer_candidates`. Some low-cost carriers (Flair / F8) do not appear in `optimizer_candidates` the way they do in the booking pipeline, so optimizer-side queries return zero for carriers that clearly exist. An `OPTIMIZER:` card title does not change this.

Each multi-ticket customer attempt has two rows with one `search_hash`, one per `multiticket_part`. Self-join on `search_hash`; do not pivot with `CASE WHEN`.

```sql
WITH mt_parts AS (
  SELECT master.date_created, master.booking_id, master.gds AS master_gds, slave.gds AS slave_gds
  FROM ota.bookability_contestant_attempts master
  JOIN ota.bookability_contestant_attempts slave ON master.search_hash = slave.search_hash
  WHERE master.multiticket_part = 'master' AND slave.multiticket_part = 'slave'
    AND master.validating_carrier = 'F8' AND slave.validating_carrier = 'F8'
    AND master.date_created > now() - interval 1 week
)
SELECT DATE(date_created) dd, master_gds, slave_gds, count(*) bookings
FROM mt_parts GROUP BY 1, 2, 3 ORDER BY 1 DESC, bookings DESC;
```

Keep the content-source pair in the output so existing exceptions (for example `intelisys + intelisys`) stay visible next to new combinations.

## Where to look (evidence map)

- **Rates and attempt-level truth (MySQL `ota`):** `bookability_customer_attempts` ← `bookability_contestant_attempts` ← `bookability_built_contestant`, joined to `bookings`. Resolve a `booking_id` → `search_hash` here.
- **Failure signatures (ClickHouse `jupiter`):** `jupiter_booking_errors_v2` — raw supplier error, `booking_step`, classification.
- **Raw flow (MongoDB `ota.debug_logs`):** the full chronological journey for one `transaction_id`, using the context markers above.
- Full evidence map: [`observability.md`](observability.md).

## Hand off

- Single-booking "what went wrong" trace or any bookability-rate question → [Tracing one booking](#tracing-one-booking) and [How to measure bookability](#how-to-measure-bookability) above.
- Symptom is the optimizer swapping / dropping a candidate → [`optimizer.md`](optimizer.md) for mistake classes and multi-ticket rules.
- Need a live reproduction → [`../../qa_assistant/SKILL.md`](../../qa_assistant/SKILL.md).
