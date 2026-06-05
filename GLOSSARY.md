# Project Glossary

Shared vocabulary for every deliverable produced from this repo — chat replies, QA plans, Trello cards, Notion pages, PR descriptions, commit messages. Loaded by the constitution in [`CLAUDE.md`](CLAUDE.md) and [`.cursor/rules/rules.mdc`](.cursor/rules/rules.mdc); read it before writing any text that goes to a non-developer audience.

The rules below are **always-on**, regardless of which skill is active.

---

## Canonical terms — use these

| Term | What it means |
|------|---------------|
| **search results page** | The user-facing page on FlightHub / JustFly that lists flight options after a user submits a search. |
| **checkout page** | The user-facing page where the user enters passenger / payment details after picking a flight. |
| **check availability call** | The availability check that runs automatically when the user lands on the checkout page. Reprices / re-validates the package against the supplier; it does **not** change the price shown to or charged to the user — the price agreed at search stands. |
| **ResPro page** | The internal FH / JF agent booking view. URL pattern: `https://reservations.voyagesalacarte.ca/booking/index/{booking_id}` — never staging-prefixed, never `/internal/`. |
| **confirmation page** / **confirmation email** | The post-booking page shown to the user and the email sent to the same address. |
| **debug log** | Entries in the MongoDB `ota.debug_logs` collection scoped to a transaction. |
| **total price (currency + amount)** | The user-facing total on a fare. Always cite both currency and amount when referencing a price. |
| **the user** / **the agent** | The end customer using FlightHub / JustFly / the internal FH or JF employee using ResPro. |

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
