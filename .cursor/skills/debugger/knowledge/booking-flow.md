# Booking flow

The spine of the platform: what happens from the moment a user lands on the checkout page to a confirmed (or failed) booking. Most investigations touch this file first because a symptom seen late in the flow often has an earlier root cause.

_Behavior only. Schemas: `../../db_access/db-docs/`. Terms: `../../../GLOSSARY.md`. Code: genesis. Seeded 2026-07-30 from `debug_logs.md` and the bookability / qa_assistant skills; extend via the maintenance loop._

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

## Where to look (evidence map)

- **Rates and attempt-level truth (MySQL `ota`):** `bookability_customer_attempts` ← `bookability_contestant_attempts` ← `bookability_built_contestant`, joined to `bookings`. Resolve a `booking_id` → `search_hash` here.
- **Failure signatures (ClickHouse `jupiter`):** `jupiter_booking_errors_v2` — raw supplier error, `booking_step`, classification.
- **Raw flow (MongoDB `ota.debug_logs`):** the full chronological journey for one `transaction_id`, using the context markers above.
- Full evidence map: [`observability.md`](observability.md).

## Hand off

- Single-booking "what went wrong" trace or any bookability-rate question → run [`../../bookability/SKILL.md`](../../bookability/SKILL.md) (it owns the single-booking flow workflow and the report format).
- Symptom is the optimizer swapping / dropping a candidate → [`optimizer.md`](optimizer.md) then [`../../optimizer/SKILL.md`](../../optimizer/SKILL.md).
- Need a live reproduction → [`../../qa_assistant/SKILL.md`](../../qa_assistant/SKILL.md).
