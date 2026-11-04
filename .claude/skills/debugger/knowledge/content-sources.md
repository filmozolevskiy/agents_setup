# Content sources (suppliers / GDS)

Per-supplier behavior: how a given content source responds, where its evidence lives, and the quirks that trip up investigations. A "content source" is the upstream system that returned the fare (supplier names — Amadeus, Sabre, etc. — are fine to use directly per `GLOSSARY.md`).

_Schemas: `../../db_access/db-docs/`. Per-source log hints also live in `../../db_access/db-docs/mongodb/debug_logs.md`. Last updated 2026-08-21 (Dida caret). Seeded 2026-07-30; extend via the maintenance loop._

## Cross-source concepts

- **Office / account** — a supplier can have multiple offices (`gds_account_id`, e.g. `TFCAD`, `TFVALCCAD`). A booking on the right supplier but wrong office is only a partial match; record both values.
- **Marketing vs operating carrier** — the **marketing / validating** carrier issues the ticket and owns the flight-number prefix. `UA1234 operated by TK` is a UA booking, not TK. `validating_carrier` in `ota.bookings` is the ground truth.
- **LCC quirks** — low-cost carriers (e.g. Flair / F8) may not surface in `optimizer_candidates` the way pipeline bookings do; some LCC fares arrive with `fareBasisCode=[]`, which package-assembly gates can drop.

## Per-source log hints (verified)

Mirror of the confirmed entries in `../../db_access/db-docs/mongodb/debug_logs.md` — read that doc for the authoritative, growing table.

| Source | Where to look (`debug_logs.context`) | Hint |
|--------|--------------------------------------|------|
| **Flightroutes24** — verify | `flightroutes24-api[ACCOUNT] pricing.do` | Supplier JSON in `Response`. Shape `{"code":"…","message":"[Verify Failed]:…"}`. Codes: `20901231` (GDS/airline, critical), `20703204` (retry from search), `10701298` (offerId reused — stale offer). Do not rely on `Flightroutes24-booker-unknown-error` (no response data). |
| **Flightroutes24** — booking | `flightroutes24-api[ACCOUNT] booking.do` | Supplier JSON in `Response`. Shape `{"code":"…","message":"[AIRLINE ERROR]:Booking failed"}`. Codes `20901219/20/21` map many airline rejections; ask FR24 for underlying detail. |
| **Amadeus** — pricing / booking | `amadeus-sh4-api[OFFICE] Op` or `amadeus-redux-api[OFFICE] Op` | SOAP XML in **lowercase** `response` (not `Response`). Ops: `PNR_AddMultiElements_*` (book), `Fare_PriceUpsellWithoutPNR` (price). Query both `Response` and `response`. |
| **NDCONE** (Condor / DE) — optimizer reprice | `optimizer_logs.context = "Ndcone[<ACCOUNT>] shopping/flight"` | Condor NDC 21.3. Accounts `NDCONEDE{CAD,USD,EUR}`. Supplier JSON in top-level `Response` (readable). Two live shapes: (1) Condor `error` with `1000` / `NATIVE ParseError [1,1] Content is not allowed in prolog` — [Trello #3177](https://trello.com/c/wrOwyMbs); (2) `error=[]` with offers — do not trust MySQL `Exception:No fares found` until you open this log. From 2026-08-18 Condor can put booking class `Y` in `paxSegmentList.marketingCarrierRBDCode` (until 2026-07-30 that field was the marketing carrier). We then build `Y552` instead of `B6552`. Presence of `Ndcone[<ACCOUNT>] offer/price` means matching kept a package. Payload map: [`optimizer_logs.md`](../../db_access/db-docs/mongodb/optimizer_logs.md). Fix: [Trello #3199](https://trello.com/c/abmelgzt). |
| **Unififi** — verify | `unififi-api[ACCOUNT] verify-price` | `Request` → `body.routing.payload`. Status `0` success / `3` failure. Search payload = 4 segments (`V4#…#N#longId`); verify response payload = 2 segments (`V4#…`). Later verifies must not reuse the verify-response payload (baggage optimization `_scopes` or a second booker verify). Booker overwrites package routing after a successful verify — that is the known failure mode. Confirmed 2026-08-12. |
| **Dida** — fare basis | `Dida::VerifyPrice`; `info.dida.routing` on `pre-checkout` `Package` | Adult and child fare basis on one segment: `ADT^CHD`. Dida sends the caret; we copy it. Full hint: [`debug_logs.md`](../../db_access/db-docs/mongodb/debug_logs.md). Confirmed 2026-08-21. |

## Normal vs abnormal

- **Normal:** the intended source responds in search telemetry, prices cleanly at `Check Availability`, and books.
- **Abnormal signals:** source missing from `search_api_stats` for a transaction; supplier error text in `Response` at verify / book; booked `gds` differing from intent (reroute — see [`optimizer.md`](optimizer.md)); office / carrier mismatch on `ota.bookings`.

## Where to look (evidence map)

- **MongoDB `ota.debug_logs`:** per-source contexts above.
- **ClickHouse `jupiter`:** `search_api_stats_gds_raw` (which sources responded), `jupiter_booking_errors_v2` (failure signatures by `validating_carrier` / source).
- **MySQL `ota.bookings`:** `gds`, `gds_account_id`, `validating_carrier` — the outcome truth.
- Full evidence map: [`observability.md`](observability.md).

## Maintenance

New per-source log context / error-code mapping → propose it into `../../db_access/db-docs/mongodb/debug_logs.md` (the authoritative table), and add a one-line pointer here only if it changes debugger routing.
