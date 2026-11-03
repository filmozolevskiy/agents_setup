# Project Glossary

Shared vocabulary for every deliverable produced from this repo — chat replies, QA plans, Trello cards, Notion pages, PR descriptions, commit messages. Loaded by the constitution in [`CLAUDE.md`](CLAUDE.md) and [`.cursor/rules/rules.mdc`](.cursor/rules/rules.mdc); read it before writing any text that goes to a non-developer audience.

The rules below are **always-on**, regardless of which skill is active.

---

## Canonical terms — use these

| Term | What it means |
|------|---------------|
| **search results page** | The user-facing page on FlightHub / JustFly that lists packages after a user submits a search. |
| **package** | One priced itinerary card on the search results page. The unit the user picks before the checkout page. |
| **fare-family** | A branded fare on a package (base vs upgrade) offered after Select and before the checkout page. When the package has no upgrades, the checkout page opens and no fare-family panel is shown. |
| **checkout page** | The user-facing page where the user enters passenger / payment details after picking a package. |
| **check availability call** | The availability check that runs automatically when the user lands on the checkout page. Reprices / re-validates the package against the supplier; it does **not** change the price shown to or charged to the user — the price agreed at search stands. |
| **ResPro page** | The internal FH / JF agent booking view. URL pattern: `https://reservations.voyagesalacarte.ca/booking/index/{booking_id}` — never staging-prefixed, never `/internal/`. |
| **confirmation page** / **confirmation email** | The post-booking page shown to the user and the email sent to the same address. |
| **debug log** | Entries in the MongoDB `ota.debug_logs` collection scoped to a transaction. |
| **Mini Rules** | Amadeus structured refund / exchange / void answers. Before a PNR the operation is `MiniRule_GetFromPricing`. After a PNR it is `MiniRule_GetFromPricingRec`. This is not fare rules. |
| **Route Happy** | ATPCO Route Happy. Structured refund / exchange policies we already fetch for packages and booked itineraries. |
| **booking rules** | The refund / exchange / void tiles shown on checkout, and the same structured rules after booking. On checkout, refund and exchange come from Route Happy when Route Happy has that data; otherwise they come from Mini Rules. Void does not come from Mini Rules. |
| **fare rules** | GDS / ATPCO rule text stored on the booking and shown on the ResPro page (and as checkout fare-rules text). Written from `Fare_CheckRules` on Amadeus, not from Mini Rules. |
| **total price (currency + amount)** | The user-facing total on a fare. Always cite both currency and amount when referencing a price. |
| **the user** / **the agent** | The end customer using FlightHub / JustFly / the internal FH or JF employee using ResPro. |
| **AeroHub** | Aggregator. Price & Drop is live. Full booking (ticket issue) is not. |
| **Travelcaster** | Flight aggregator through the Starlings TravelCaster API. Partner is Volans Groups / Fare Fisher (formerly Consolid). Offices TCUSD and TCCAD. Price & Drop is live. |
| **Intelisys** | Booking engine for Flair (F8). We shop and book Flair through the Intelisys REST API. A second account exists for the Voyzant UK partner. |
| **Voyzant** | Two roles. (1) Flight aggregator (GDS / NDC / airline APIs) we are evaluating — public shop call is AirShopping, Postman collection then Price & Drop. (2) Our UK back-office partner on Amadeus office LONU128L7 (classic and NDC) — needs four fixed PNR remarks (BR/1, CN/\<DK number\>, AG/01, INV/DEFAULT) added before ticket issuance so their mid-office system can pick up the booking automatically. |
| **Price & Drop** | Optimizer flow that prices a fare through a supplier and drops the booking after pricing. No ticket is issued. Used to review a supplier's content and prices before a full booking integration. |
| **Automated Unused Tickets** | Wenrix program that claims leftover value on unused issued Amadeus tickets after the last flight has flown more than 90 days. Wenrix files the airline refund and reports each refunded passenger name record. Money returns to the booking form of payment, not the customer card. Distinct from customer-initiated cancel, Optivoid, Optifare, and Flex Booster. |
| **PTC** | Passenger type code — the code a fare is priced under. `ADT` adult, `CHD` child, `INF` lap infant, `INS` seated infant. Non-adult codes we are integrating: `IIT` inclusive tour, `JCB`, `PFA`, each with its own child and infant codes. Spell it out as "passenger type code (PTC)" on first use in a card or report. |
| **Fare Fetch rules page** | Internal page at `https://summit.flighthub.com/rules-fare-fetch` where search targets are configured per office and carrier. |

### Banned terms — do not use in any user-facing artefact

| Banned | Use instead |
|--------|-------------|
| **storefront** | "FlightHub / JustFly", "the user-facing page", or the specific page name (`search results page`, `checkout page`, `confirmation page`). |
| **content source** (or supplier name in plain text — Dida, Amadeus, Sabre, TP) | The upstream system that returned the fare. Supplier names are fine to use directly. |


### Code identifiers are allowed only inside

- SQL / Mongo / ClickHouse query blocks (where QA copies them verbatim).
- A `Code:` annotation that ties a chat-only observation back to a file path for a developer audience.

Anywhere else — checklist text, Trello card body, Notion page prose, PR description, commit message body — they're forbidden. Class names, method signatures, abstract bases, factories, DTOs, namespaces, and file paths do not appear in user-facing prose.

---

## When this glossary needs to change

When a new product surface, internal screen, or supplier enters routine use, add a row here in the same change that introduces the work. Skills do not duplicate this table; they cite it.
