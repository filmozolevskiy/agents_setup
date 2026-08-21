# Knowledge base index

Read this first, every debugger session. Match the symptom to a subsystem below, then open **only** the matched file(s). Do not preload the whole base.

Knowledge files hold **behavior and process** only — how a subsystem works, what breaks, where to look. Schemas live in `../../db_access/db-docs/`, term definitions in `../../../GLOSSARY.md`, code in genesis. Files link out; they do not copy.

## Symptom → subsystem lookup

Match on what the user observed. When several match, read the earliest stage first (a symptom late in the flow often has an earlier root cause).

| Observed symptom / keyword | Open |
|----------------------------|------|
| No results, empty search, wrong / missing content source on results page, "which supplier responded" | [`search.md`](search.md) |
| Fare changed / disappeared between search and checkout, availability check failed, price drift, loss-limit stop | [`booking-flow.md`](booking-flow.md) |
| Booking failed / not bookable, "trace this booking", `booking_id` / `search_hash` "what went wrong", supplier rejected the fare | [`booking-flow.md`](booking-flow.md) → hand off to `bookability` |
| Wrong supplier booked, optimizer rerouted, contestant missing / mistagged, reprice, fare-basis mismatch | [`optimizer.md`](optimizer.md) → hand off to `optimizer` |
| Card declined, 3DS, charge failed, virtual card, refund, statement, chargeback, "Payhub" | [`payments.md`](payments.md) |
| Supplier-specific error / behavior, GDS office, marketing vs operating carrier, per-source quirk | [`content-sources.md`](content-sources.md) |
| Ticket not issued, ticketing failed, `AirTicketRQ`, PNR, session close, statement finalization, “not queued to Wenrix”, pending ticketing | [`ticketing.md`](ticketing.md) |
| Baggage / seat / ancillary wrong, missing, or mispriced; Gordian create-trip `failed_to_parse_fare_basis` | [`ancillaries.md`](ancillaries.md) |
| "Where are the logs / traces for X", Datadog error spike, latency, exception with no clean DB row, which dashboard | [`observability.md`](observability.md) |
| Regression with a clean onset time — "started failing at T", "what changed" | (no file) → hand off to `deploy_blamer` |

## Subsystem files

| File | Scope | Last updated |
|------|-------|--------------|
| [`booking-flow.md`](booking-flow.md) | End-to-end flow: checkout → check availability → pre-air-booker (optimization, loss limit) → book → post-air-booker → cancel-on-failure. The spine most investigations touch. | 2026-07-30 (seeded) |
| [`optimizer.md`](optimizer.md) | How the optimizer/repricer forms and ranks contestants and can reroute a booking mid-checkout. Behavior only — audits belong to the `optimizer` skill. | 2026-08-20 (PD Upgrade one-office) |
| [`payments.md`](payments.md) | Payhub flow (Verify → 3DS → IssueCard → Sale → CancelCard), virtual cards paying suppliers, statement items / transactions. | 2026-07-30 (vcc tracing) |
| [`content-sources.md`](content-sources.md) | Per-supplier / GDS behavior: offices / accounts, marketing vs operating carrier, LCC quirks, per-source `debug_logs` context hints. | 2026-08-21 (Dida caret) |
| [`search.md`](search.md) | Search submission → results page; content-source fan-out; search telemetry (which sources responded). | 2026-07-30 (seeded) |
| [`ticketing.md`](ticketing.md) | Ticketer: `AirTicketRQ` to the GDS, Wenrix `ticket/issue-wenrix` path vs agent-queue flags, statement finalization, session close, and where issuance stalls. | 2026-08-13 (Wenrix queue) |
| [`ancillaries.md`](ancillaries.md) | Baggage / ancillary optimization behavior and its data. | 2026-08-21 (Gordian fare-basis) |
| [`observability.md`](observability.md) | Cross-cutting evidence map: for each subsystem, the Mongo log contexts, ClickHouse tables, MySQL tables, and Datadog surfaces to reach for. | 2026-07-30 (seeded) |

## Maintenance

When an investigation confirms a durable, reusable fact, propose the update (per `../SKILL.md` § 5), and on approval:
- append the fact to the right subsystem file, and
- bump that file's **Last updated** cell above with the date and a two-word note.

Keep the durability bar high: facts that help a *future, different* investigation, backed by an artefact from this session. No one-offs, no restatements of `db-docs` / `GLOSSARY`.
