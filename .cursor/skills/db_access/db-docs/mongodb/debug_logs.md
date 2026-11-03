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
| **Dida** — fare basis                   | `context: "Dida::VerifyPrice"` (`Request` / `Response`); also `info.dida.routing` on `pre-checkout` `Package` | Dida puts adult and child fare basis on the **same segment** as `ADT^CHD` (example `AAUD0ZBW^AAUD0ZBW`). The caret is in Dida’s `fromSegments[].fareBasis`. We copy it onto the package with no transform. Confirm on `Dida::VerifyPrice` `Response.routing.fromSegments` (Dida’s own JSON) and on stored `info.dida.routing.fromSegments`. Confirmed 2026-08-21 on `fa10e7959efbf56a62365159120db3ee`. Not every Dida adult+child VerifyPrice has a caret — some rows carry a slash suffix only (`KCUD0LES/SLO` shape). Confirmed 2026-08-28 on `cd5911441b98e96d3620e6ecc980a2ba` (slash, no caret). |
| **Gordian** — create-trip (bags)        | `context: "POST https://api.gordiansoftware.com/v2.2/trip"` | HTTP payload is in `Request body` / `Response body` (strings), not `Request` / `Response`. `_scopes` is empty. Several bag create-trip rows can share the context on one `transaction_id`; pick by `Request body` (`"bag"` present, `fare_basis` value). Gordian rejects a caret in `fare_basis` with `failed_to_parse_fare_basis`. A slash suffix is tolerated. Confirmed 2026-08-21 on `fa10e7959efbf56a62365159120db3ee#6a887c77ba2ca3f9c00fbdc2` (caret, parse fail) and 2026-08-28 on `a6d361f4ee4bd8e3185bbdec991bb793#6a90d1c544be8dd2970db7e4` (caret, parse fail) and `cd5911441b98e96d3620e6ecc980a2ba#6a911df11ae9ce2578082ef2` (slash, no parse fail). A 6h collection-wide aggregation on this context timed out in the CLI; look up by `transaction_id` (indexed). |
| **Amadeus Mini Rules** — checkout SOAP | `context: "amadeus-sh4-api[OFFICE] MiniRule_GetFromPricing_11_1"` | Checkout booking-rules fetch before a PNR. `_scopes` is `null`. SOAP XML is in lowercase `request` / `response` (not `Request` / `Response`). `operation` is `MiniRule_GetFromPricing_11_1`. `source` is the `get-booking-rules/{search_id}/{package_id}` URL. Confirmed 2026-08-27 on `aaa824e9b77284710dc5dea75aa3e976#6a905f8cadcdc20c7c0f782d`. |
| **Booking rules from package** | `context: "booking-rules-from-package"` | Written at the same checkout fetch. Top-level `mini_rules_skipped` (boolean) is the skip flag after genesis PR 55893 turned the production switch on (2026-09-10 19:50:12 UTC). Several entries can share the context (package change, control slice); the later one can be `false` after an earlier `true` on the same `transaction_id`. `rules` may be a JSON string. On a skip, Mini Rules refund/exchange is `serviceable: "unknown"` and void still has a deadline; `rules-routehappy` is often absent on this document — Route Happy ran on sibling `routehappy-api consolidated` / `Routehappy compiled - addFeaturesToPackage`. `_scopes` is `null`. SQL mirror: `ota.booking_rules_shadow` (that row is the later fetch; `JSON_EXTRACT(rules, '$.master.mini_rules_skipped') = false` does **not** mean the search never skipped). Skip true: `97544290e91d62d936df197258c0772d#6aa30a15a7595e996b0bffe3`. Pre-switch, no flag: `b5067766983fdefeec1a0ddd8d1d3ed6#6a905dde5b7d8ec4bf07c4a5`. |
| **Mini Rules skip decision** | `context: "mini-rules-not-skipped"` | Written when the checkout skip did not run. `reason` values seen in production after PR 55893 (window 2026-09-10 19:50:12Z–20:18Z): `not-amadeus`, `no-atpco-features`, `multiticket`, `missing:…`, `alt-carrier`, `control` (5% holdback that still calls Mini Rules), `alt-carrier-donor`, `error`. `error` carries `exception` (class/message/file). Fail-open: Mini Rules still runs. Sample `control`: `d11319886bedd940d43dd980773d4607#6aa30fcbcb83aa302f01e3b2`. Sample `error`: `fcf26329645796ac56e46cca89053f28#6aa30ee851fc1111e20687f8`. |
| **Mini Rules skip guard** | `context: "mini-rules-skip-not-overridden"` | Written when Mini Rules was skipped but Route Happy did not fill a refund or exchange tile. 0 rows in the first ~30 min after the production switch (2026-09-10 19:50:12Z). Any row is a revert signal. |
| **Route Happy consolidated** | `context: "routehappy-api consolidated"` | Same `context` for fare-family and for the checkout booking-rules fetch (genesis PR 55937). Pick by `source`: fare-family is `get-fare-family-options-and-fare-rules` (`_scopes` often `null`); booker is `Check Availability`. Payload is lowercase `request` / `response`. Fare-family `request.control.includes` is `["uta","amenity"]` with no `ticket_attributes_filter`. Confirmed 2026-09-14 on `87a74d8d83b50819f2bc4569c332a381#6aa81f31a657135a560375da`. The booking-rules-only call (`source` contains `get-booking-rules`, `includes` `uta` only, `ticket_attributes_filter` `cancellation` + `advance_change`) is not written in production while the wait/fetch switch is off. |
| **Route Happy ATPCO miss (fare family)** | `context: "Momentum\\Supplier\\Atpco\\Routehappy\\Helpers\\Package::lockAndLoad(): Saved without ATPCO features"`; `"routehappy-upgrade-notice-Momentum\\Supplier\\Atpco\\Routehappy\\Helpers\\Package::addFeaturesToPackageCityPairs(): Segment count to city pair data mismatch"` (`level` `notice`); `"routehappy-upgrade-options"` | Why a package has no ATPCO features (ClickHouse `upsells.fare_family_upgrade_options_event.has_atpco_features = False`; `atpco_error` there is always NULL). **Saved without ATPCO features** is not a clean signal on its own: it also fires for search-results packages (95,839 rows on 9,717 searches vs 4,731 "Saved with" in 2026-09-28 15:00–16:00Z). Classify per search instead: (1) **Mismatch notice** — Route Happy returned data but we dropped it for that city pair. Fields `compiled_city_pair_data` (JSON string, `segment_id` per entry), `compiled_city_pair_data_count`, `segments`, `segments_count`. Two causes: the request is a flat segment list, and Route Happy picks its own leg split (multi-city trips: Route Happy leg N ≠ our city pair N); and inside one leg, segments are numbered per fare component, so a leg with 2 fare components loses segments. 80% of the ATPCO misses on 2026-09-28 NY. Sample `9bad57db7c6b08b824081c9d6a168b64#6aba733fdcb570d465046b9f` (EK multi-city: Route Happy legs ORD-DXB+DXB-SEZ / SEZ-DXB+DXB-ORD). (2) **Route Happy itinerary error** — fare-family `routehappy-api consolidated` (`source` `get-fare-family-options-and-fare-rules`) answers HTTP 200 with empty `data.*` and `response.itineraries[].errors.messages` `Segment #N is not matched` or `Fare for flight <segment_id> is not matched` (`valid: false`). 19% of misses. Samples `6341187e575f6e5e56410bfe57c190ab#6aba81849ae6adea390d30c6` (BA, segment), `577b1fb7926ce3a0e856ae707903258e#6abac7c0fa20c4fe1603142b` (fare). `routehappy-upgrade-options` then carries `has_atpco_features: "False"`, `reason: all_options_filtered` and the removed options in `filtered_empty`. The CLI `find` / `aggregate` parse filters with plain `json.loads`, so `{"$date": …}` is not a date: bound `date_added` from Python (`mongo_query.get_database(...)`) or look up by `transaction_id`. Confirmed 2026-09-29. |
| **Booking-rules source trail** | `context: "booking-rules-source-attempt"` then `"booking-rules-source"` | New in genesis PR 55937. Per-call row (`kind` `routehappy-wait` / `routehappy-fetch` / `mini-rules`, `outcome`, optional `ms`) then one summary (`source` `routehappy` / `mini-rules` / `mixed` / `none`, `source_by_rule`, `attempts`). Production timeline 2026-09-21: logging live **15:57:12Z**, `EnsureRules` behaviour switch on **16:09:28Z** (first `routehappy-fetch`), first `routehappy-wait` 16:11:45Z. **`kind` separates "not deployed" (no rows) from "deployed, switch off" (`mini-rules` only) from "switch on".** `outcome` by kind, production 17:00–18:00Z: `mini-rules` → `not-amadeus` 4544, `no-atpco-features` 575, `control` 362, `alt-carrier` 229, `alt-carrier-donor` 42, `missing:…` 53, `error` 8; `routehappy-fetch` → `data` 1435, `persisted` 1433, `no-data` 264, `skipped:recent-miss` 204 (negative cache), `blocked:bus-or-train` 7; `routehappy-wait` → `data` 28, `expired` 6, `holder-had-no-rules` 1. The wait path is rare (~35/h against ~1910 fetches). A `kind: "mini-rules"` row is **not** proof the SOAP call went out — `not-amadeus` packages never reach Amadeus; count `MiniRule_GetFromPricing_11_1` for that. This trail supersedes `mini-rules-not-skipped` for reason breakdowns: that context now sees only a sliver of the population (9 rows vs 4544 trail rows for `not-amadeus`, 17:00–18:00Z). Confirmed 2026-09-21 18:20 UTC. |
| **Checkout extra-bag factory** | `context: "Baggage"` (`_scopes` `["Baggage"]`) | Per-ticket extra-bag fetch on checkout (not post-booking). Fields: `provider` (lowercase: `amadeus`, `dida`, `intelisys`, `unififi`, `travelfusion`, …), `baggage` (JSON array of options; empty or absent on miss), `exception` (`null` on success). `level` `debug` on success, `error` on miss. A 2-ticket package writes two entries (one per `provider`). Distinct from post-booking `context: "BaggageOptimization"` (`_scopes` starts `BaggageOptimization-…`). When this fetch returns options, checkout writes `storefront-api-baggage-get` at `info` and does **not** call Gordian. When every ticket misses, checkout falls through to Gordian (`storefront-api-baggage-init` then `storefront-api-baggage-get` at `debug`). Confirmed 2026-08-28: production single-ticket success `0e8240936bcb872ce0d74c5ab5115f16#6a9137ba109ddaa9d8078f66` (`provider` `intelisys`, `exception` null); production multi-ticket checkout before the factory ran `0f192898a4c0102c3c9652667ae19e65#6a8ee3cd1a604f6e80044084` (Gordian `storefront-api-baggage-get` only, no checkout `Baggage` log); staging67 mixed success `a9df631c36d138fb4faa55b118b6fb31#6a8f335d5bf7377d730b7284` (`provider` `intelisys`, 4 options). |
| **Air Canada NDC** — seat map | `context: "AirCanadaNDC-OfferPrice"` then `"AirCanadaNDC-SeatAvailability"`; after book also `"AirCanadaNDC-OrderRetrieve"` | SOAP XML is in lowercase `request` / `response`. `_scopes` is `null` on the seat-map URL. **Checkout** `source` contains `ancillaries/seat-map/get/{search_id}/{package_id}` (no `booking/`). Checkout `SeatAvailability` Query is `<Offer OfferID="…" Owner="AC" ResponseID="…"/>`. Confirmed 2026-08-28 on `509e64113e162ee451257ee0292aa947#6a8c94427df0ff508407465e`. **After book** `source` contains `ancillaries/booking/seat-map/get/{booking_id}` (hourly job and change-seat use this URL). Old after-book path sent empty `<Query><Offer/></Query>` on `OfferPrice` and Air Canada returned 2009 Offer not found; `SeatAvailability` did not run. Confirmed 2026-08-28 on `c8c1d020a298cb0f9b938f9ec11ffcee#6a907f4bae172d3f920a49b5`. New after-book path skips `OfferPrice`, sends `OrderRetrieve`, then `SeatAvailability` Query `<Order OrderID="{bookings.pnr}" Owner="AC">` with `PassengerID` / `SegmentID`. Staging2 success: `782335981aa6f6c3fbb3695db13697f0#6a91b9437eb585e96c0fdabe` (`OrderID` `BTFFJT` = `bookings.pnr`, 2 `SegmentID`, `Success`). OrderID+Owner with no passenger/segment ids returned 3019 Offer not found: `509e64113e162ee451257ee0292aa947#6a919fea760b12bce70d21f2`. Same `booking_id` can still show production `ws.flighthub.com` empty `OfferPrice` from the hourly job while staging2-ws already uses Order. |
| **Porter (PD) Navitaire seat-map override** | `context: "PD_NDC_Seatmap_Override"` | Checkout fetch of Porter seats from Navitaire on a non-Navitaire fare (Unififi, Onefly, Amadeus, …). `_scopes` is `null`. `Seatmap` is a **JSON string** (not an object) with `seatmapInformation.row` when Navitaire returned a map. Several entries per `transaction_id` (one per segment). **Before** genesis PR 55460: `level` `error` even on a populated map, then `seatmap-cannot-build` (`packageGDS` `unififi` / `onefly`, `packageValidatingCarrier` `PD`, `seatmapGds` null) and often `seat-bidding-carrier-codes-mismatch` (`segment` `"PD"`) on PD-marketed P3-operated segments. **After** (staging 60): `level` `info` with the same populated `Seatmap` string; no `seatmap-cannot-build`. Confirmed 2026-08-28: old error+map `eacd7ab44af735813e0e65591cd6567d#6a868df3d1ef32572906e9d3`; staging info+map `8f0e95ec517933c06314e61bebde6bc1#6a8c71107537c5bd01054e6a`. Sibling contexts: `Navitaire-NDC-Request-Response-Trace-SeatAvailabilityRQ`, `navitaire-ndc-seatmap-response`. A 24h collection-wide aggregation on this context timed out in the CLI; look up by `transaction_id` (indexed). |
| **Booker response to the client** (what the page / app was told to show) | `context: "post-air-booker"` | Field `Response from Booker` is the response sent back to the web checkout or the native app. Two formats: PHP-style text (`$booker_response['user_error_display'] = show_fare_increase`) and JSON (`{"error_message":…,"error_type":…}`); parse both. Keys: `user_error_display` (`show_fare_increase`, `show_alternative_flights`, empty), `error_type` (`fare_change`, `flight_unavailable`, `fare_increase_not_allowed`), `show_modal`, `error_message`. `user_agent` separates the native app (`CFNetwork` / `AppVersion`, source `storefront-api/book`) from web (`/checkout/billing`). Split-payment fare increases 2026-10-01 → 10-05 UTC: app 138 = 111 `show_fare_increase` + 27 `show_alternative_flights`; web 895 = 727 `show_fare_increase` + 120 `show_alternative_flights` + 48 `fare_increase_not_allowed` (Google Flights). It records what the server asked the client to show, not what the client drew. Confirmed 2026-10-06 on `14b98d0bcf11c148ceca4df5d841132a#6abdcb5aaa4ef4ca730fa784` (app, `show_alternative_flights` after a ×3.25 increase; the same app booked the inflated package 7 min later) and `8c2640c41d24b25286742c22a5d1d8df#6abda377427b7c152200399e` (app, `show_fare_increase`). |
| **Negative-markup fare increase** (booker) | `context: "air-booker-negative-markup-non-bookable"` (`level` `notice`, `_scopes` `["Booking","Optimization"]`); then `"handling-booking-exception"` (`exception.class` `Mv_Ota_Air_Booker_Exception_FareIncrease`) | Written by `handleNegativeMarkupNonBookablePackage()` when the booker removes a negative markup and shows the user a fare increase. `New package` is a **JSON string** holding the re-priced package (`prices.total` = the new price shown). `info.split_payment_fare_increase: 1` inside it marks the split-payment path (`NoContestantSplitPaymentIneligible`): the price was copied from the multi-currency candidate with the **lowest** markup. Filter it with a regex on the string: `"New package": /"split_payment_fare_increase":1/`. **Disabled by genesis PR #56523 (merged 2026-10-05 14:51 Toronto): last split-payment row 2026-10-05 18:xx UTC, 0 since** — those attempts now end in `FlightNotAvailable` / `DelayedFlightNotAvailable`. Volume 2026-09-12 → 10-05 UTC: 7,603 split-payment rows vs ~530 without the flag. The old price is not in the document; join MySQL `optimizer_attempts` on `search_id = transaction_id` + `package_id`, latest `created_at` before `date_added` (`created_at` is America/Toronto). On the next booking try, `loss-limit-fare-increase` carries `original_package` / `adjusted_package` (both with `split_payment_fare_increase`) and `data.original_revenue`. Retention starts 2026-09-12 (oldest row on 2026-10-05). A 3-week scan from Python takes ~5 min; the CLI cannot bound `date_added`. Confirmed 2026-10-05 on `14b98d0bcf11c148ceca4df5d841132a#6abdcb59aa4ef4ca730fa780` (14143.06 CAD shown; correct choice 4406.79), `7d2e61ba20a9ba6f9a4990a05aa1de62#6abc89670a3ba070fe050bab`, `dc864ccb99759ee25ff11081e678ce26#6abc89a4bc0fb4f87e0e6dc8`. |
| **Navitaire NDC** — booker price refresh | `context: "booker-manager-single-ticket"` (`level` `critical`); sibling `navitaire-refresh-package-multiple-matches` | TypeError: `BundleCollection::whereServiceCode()` received `null` after AirShopping still returned matches. ClickHouse `error_message` contains `whereServiceCode`; `booking_step` `navitairePricePackage()`; `classification_category` `TECHNICAL_ERRORS`. Booker maps this to user-facing `flight not available` and MySQL `error` `other` / `exception` `Exception`. Offices `NAVPDUSD` / `NAVPDCAD`, airline PD. Confirmed 2026-09-03 on `afaee3c6d4714d8af44ccc65a527afa9#6a99c0d4f991764225026169` (crash) and `#6a99c0d4f991764225026167` (three AirShopping matches). |


### Payments / charges (Payhub)

- See **Glossary → Payhub**. **Add** index names, log service names, or query patterns here once confirmed.
- **Virtual-card eligibility** — `context: "booker-payment-manager-vcc-availability"`. Evaluated more than once per transaction. `_scopes` `Booking` is checkout / booker. `_scopes` `TicketProcessor` is ticket-issue recovery. Payload fields `connexpay-volume-shift-result` and `b2b-wallet-availability-result` are JSON strings with `success` and `context`. After genesis PR 55361 the `context` object also carries `fopRejectRecovery`. Ticket-issue recovery with `fopRejectRecovery: true` can still be `success: false` when first-part rules fail (common last rule `IsCreditCardSupportedRule`). A missing `TicketProcessor` row with a later `FOP not accepted. Switching to check` note means fares already had a virtual card — recovery does not mint a second one. Checkout can fail `IsNotExcludedAirlineByCurrencyRule` (`CADUA`) while recovery with `fopRejectRecovery: true` succeeds. Confirmed 2026-08-20 on `0e53cda9c9eddd7b21a114d259a81948` (`Booking`, all `success` false, cheque) and `d8442ea76fe2cd7fb1ed206a6a65066b` (`TicketProcessor`, `success` true, virtual-card try). Confirmed 2026-08-31 on `5c57b93b0e8895f0f7113c8f56eb7528#6a9509a9ae24db2acf070f0c` (recovery true, both false, credit-card-not-supported), `21d5df99735fb9357b139d01b46ae8f6#6a951a7dbd8d639a3a0ee5bb` (`Booking` only, already-carded cheque), `6e910ea37b87040d9897d40b0df2953b#6a957111868fb4b39e0e18ad` (recovery passed `CADUA`). Behavior write-up: `debugger/knowledge/payments.md` (Amadeus FOP-reject recovery). Travelfusion: ConnexPay fail with B2B Wallet `success: true` does **not** mean a virtual card was minted — confirm with missing `IssueCard` / `booker-payment-manager-vcc-successfully-issued` and `cancel-virtual-card-pipe-info` `No virtual card found for booking.` Confirmed 2026-09-02 on `d0e97f6a6bea3545b7c619659a99b156#6a972b2184ea559ee20e3694`. Behavior: `debugger/knowledge/payments.md` (Travelfusion when a virtual card is missing or fails).
- **Travelfusion customer-card surcharge** — `context: "travelfusion-google-cc-fee-absorbed"` (`level` `notice`, `_scopes` `["Booking"]`). Fields: `surcharge`, `markup`, `covered_by_markup`. Written when Travelfusion billed the customer card (no virtual card) and a card surcharge was absorbed by markup. Sibling `context: "travelfusion-cc-fee-statement-item"` has `absorbed`, `surcharge`, `additive`, `saved`. ResPro mirror: `TravelFusion card surcharge {amount} {currency} ({brand}). Paid by us, not charged to the customer.` Confirmed 2026-09-02 on `d0e97f6a6bea3545b7c619659a99b156#6a972b2e84ea559ee20e3699` (surcharge `14.1`, markup `20.66`, `covered_by_markup` true) and statement-item `#6a972b2f84ea559ee20e36a1`.

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
| 2026-09-29 | Route Happy ATPCO miss on fare family: mismatch notice (our side, 80%) vs itinerary `errors.messages` (Route Happy, 19%); "Saved without ATPCO features" also fires on search results. |
| 2026-09-21 | PR 55937 in production: logging live 15:57:12Z, `EnsureRules` behaviour switch on 16:09:28Z. Checkout Mini Rules call rate (join `booking-rules-from-package` to `MiniRule_GetFromPricing_11_1` on `{search_id}/{package_id}` in `source`) fell from **60.1% to 23.8%** of Amadeus fetches; `no-atpco-features` 3564/h -> 585/h; `mini-rules-skip-not-overridden` stayed 0. `MiniRule_GetFromPricingRec_11_1` is post-booking servicing, not checkout. `mini-rules-not-skipped` lost most of its population to the source trail — do not use it across the deploy boundary. Queries: `reports/post_deploy/ST4Q2S5J/queries.md`. |
| 2026-09-14 | Route Happy `routehappy-api consolidated` is shared across fare-family and booking-rules; pick by `source`. Wait/fetch trail `booking-rules-source-attempt` / `booking-rules-source` is 0 rows in production while the switch is off. |
| 2026-09-11 | Navitaire NDC booker: `whereServiceCode` TypeError on null bundle code; AirShopping can still match; user-facing map is `flight not available`. |
| 2026-09-10 | Checkout Mini Rules skip on in production (PR 55893): `booking-rules-from-package.mini_rules_skipped`; `mini-rules-not-skipped` reasons; `mini-rules-skip-not-overridden` still 0. |
| 2026-09-02 | Travelfusion customer-card fallback: `travelfusion-google-cc-fee-absorbed` / `travelfusion-cc-fee-statement-item`; B2B Wallet `success: true` is not proof a virtual card was minted. |
| 2026-08-31 | Amadeus FOP-reject recovery: `fopRejectRecovery` on TicketProcessor availability; cheque when already-carded / `IsCreditCardSupportedRule` / VCC then refused; recovery can pass `CADUA`. |
| 2026-08-28 | Porter PD Navitaire seat-map override: `PD_NDC_Seatmap_Override` `Seatmap` JSON string; `level` error→info; Unififi/Onefly `seatmap-cannot-build` + PD-P3 `seat-bidding-carrier-codes-mismatch`. |
| 2026-08-28 | Air Canada NDC seat map: checkout `ancillaries/seat-map/get` vs after-book `booking/seat-map`; empty OfferPrice 2009 vs Order+PassengerID+SegmentID Success; 3019 when Order has no passenger/segment ids. |
| 2026-08-28 | Checkout extra-bag factory: `context` `Baggage`, `_scopes` `["Baggage"]`, `provider` / `baggage` / `exception`; Gordian fallback only when every ticket misses. |
| 2026-08-28 | Gordian create-trip: `Request body` / `Response body`, empty `_scopes`, caret → `failed_to_parse_fare_basis`; Dida adult+child is not always caret. |
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
| `Request body` / `Response body` | `String` | HTTP-style supplier payload used by some integrations (Gordian create-trip). Distinct from `Request` / `Response`. |
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
- **Fetch one log by `_id` through `mongo_query.py`:** the CLI parses filters with plain `json.loads`, so `{"$oid": …}` fails with `unknown operator: $oid`. Use `aggregate` with `{"$match": {"$expr": {"$eq": ["$_id", {"$toObjectId": "<24-hex id>"}]}}}`. The permalink fragment after `#` in a `/debug-logs/log-group/<transaction_id>#<id>` URL is this `_id`. Confirmed 2026-09-30.
- **Bound a scan by time without `$date`:** the first 8 hex chars of an `_id` are the insert time (Unix seconds). Use `{"$expr": {"$gte": ["$_id", {"$toObjectId": "<8-hex-time>0000000000000000"}]}}` plus an equality on `context`. A month-wide group-by on `Booker` with no `context` timed out in the CLI; a `context` + `exception` regex scan from a month start returned in under two minutes. Confirmed 2026-09-30.

