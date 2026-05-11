# 3-slot proposal template

When the user kicks off a watch, the agent reads the parent card and
posts a proposal in chat. The user approves or edits it before any
SQL runs. This file is the canonical shape of that proposal — copy
the headings, fill in the parameters from the card, do not invent
new slots.

## Reading the card

Pull from the parent Trello card (or chat spec):

| Field | Where to find it |
|---|---|
| `content_source` | Card description / title (e.g. "Intelisys", "Unififi"). |
| `carrier` | Card description (IATA code) or PR diff. Sometimes "all". |
| `gds` | Card description; rare in CI cards but present in payment-side ones. |
| `payment_processor` | Payhub / merchant / processor name from the card (e.g. "F8"). |
| `card_brand`, `card_funding` | Card description if relevant (e.g. "F8/F8", "debit cards"). |
| `ticket_shape` | "single" / "multi" / "both" — usually in the title or the Implementation plan. |
| `office`, `pos` | If specifically scoped. |
| `deploy_time` | PR `merged_at` (preferred) → card last move into deployment list → user-stated. |
| `error_signature` | If the card is "fix error X", lift the literal substring. |

## Slot shape

Each slot has the same five lines so the user can compare them at a
glance:

```
**#<n> <Slot title>** — <one-line purpose>
- **Watches:** <SQL dimensions>
- **SQL:** <bookability_analysis / optimizer_analysis template name + parameters>
- **Verifies in Mongo:** <collection + predicate>
- **Dedup:** <one-shot / per-signature 6h>
```

## The three slots, by purpose

### Slot #1 — Happy path baseline

**Goal.** Confirm the integration as a whole still works after the
deploy. Fires `@reporter` once, then goes silent.

- **Watches.** Successful bookings on the card's `content_source`,
  any carrier, any office, since `deploy_time`.
- **SQL.** `bookability_analysis` "successes by content source"
  template, scoped to `content_source = <card>`, window
  `[deploy_time, now]`, `LIMIT 200`.
- **Verifies in Mongo.** `debug_logs` for each candidate booking ID:
  `status.success == true` AND the booking's content source line
  resolves to `<card content_source>`.
- **Dedup.** One-shot — first confirmed success fires once, no more.

### Slot #2 — Card target

**Goal.** Confirm the specific change the dev shipped takes effect.
This is the slot the user cares about most. Fires once on the first
confirmed hit; failures on the same dimensions also fire (those
are the "fix did not land" signal).

- **Watches.** The literal combo from the card: e.g.
  `content_source = Intelisys, payment_processor = F8, ticket_shape
  = multi, card_brand IN (Visa, Mastercard), card_funding =
  debit`. Window `[deploy_time, now]`.
- **SQL.** `bookability_analysis` "successes / failures by combo"
  template, with the card's full dimensions in the `WHERE` clause.
- **Verifies in Mongo.** `debug_logs` plus, when payment-relevant,
  the Payhub / merchant Sale payload — the card target predicate
  comes straight from the card description (e.g. for Cuwwjgmr:
  `payhub.merchant == "F8" AND card.brand IN {Visa, Mastercard}
  AND card.funding == "debit" AND payhub.sale.status == "success"`).
- **Dedup.** One-shot for success; per-signature with 6h cooldown
  for failure on these exact dimensions.

### Slot #3 — Regression sweep

**Goal.** Catch anything the deploy broke around the same area. The
loudest slot — the one most likely to fire on this watch.

- **Watches.** All errors on `content_source = <card>`, any
  carrier, any office. Window `[deploy_time, now]`.
- **SQL.** `bookability_analysis` "failure signatures by content
  source" template (ClickHouse `jupiter_booking_errors_v2`),
  grouped by error signature, ordered by count desc, since
  `deploy_time`.
- **Verifies in Mongo.** For the top-N error signatures, sample one
  `debug_logs` document and check whether the failing call /
  payload looks deploy-related (e.g. payment processor on the
  failing leg matches the deploy's processor; failing carrier
  matches a carrier the deploy touched). The agent's "looks
  deploy-related" judgement is the gate for `@reporter`.
- **Dedup.** Per error signature (canonicalised: error message with
  IDs / timestamps stripped + content source + carrier). 6h
  cooldown — re-fires after 6h if still active.

## Worked example — [Cuwwjgmr](https://trello.com/c/Cuwwjgmr) (Intelisys / Float card / F8 / F8 debit cards)

The card's relevant dimensions:

- `content_source = Intelisys`
- `payment_processor = F8` (the Float card's merchant)
- `ticket_shape = multi`
- `card_brand IN {Visa, Mastercard}` (the Float card brand set)
- `card_funding = debit`
- `deploy_time = <PR merged_at>` (or "since this morning" from chat)

The proposal the agent posts in chat:

> Proposing 3 slots for the Cuwwjgmr watch. Approve or edit before I
> start querying.
>
> **#1 Happy path baseline** — confirm Intelisys is still booking after the deploy.
> - Watches: successful bookings on Intelisys, any carrier, any office.
> - SQL: `bookability_analysis` "successes by content source" template,
>   `content_source = Intelisys`, window `[deploy_time, now]`, `LIMIT 200`.
> - Verifies in Mongo: `debug_logs` `status.success == true` for the candidate booking.
> - Dedup: one-shot.
>
> **#2 Card target** — confirm Float card on F8 multi-ticket F8/F8 debit charges go through.
> - Watches: `content_source = Intelisys, payment_processor = F8, ticket_shape = multi, card_brand IN (Visa, Mastercard), card_funding = debit`.
> - SQL: `bookability_analysis` "successes / failures by combo" template with the full WHERE clause.
> - Verifies in Mongo: `debug_logs.payhub.merchant == "F8" AND debug_logs.card.brand IN {Visa, Mastercard} AND debug_logs.card.funding == "debit" AND debug_logs.payhub.sale.status == "success"`.
> - Dedup: one-shot for success; per-signature 6h for failure.
>
> **#3 Regression sweep** — catch anything broken on Intelisys post-deploy.
> - Watches: all errors on `content_source = Intelisys`, any carrier, any office.
> - SQL: `bookability_analysis` "failure signatures by content source" template, ClickHouse `jupiter_booking_errors_v2`, grouped by signature, ordered by count desc.
> - Verifies in Mongo: sample one `debug_logs` per top signature; mark "deploy-related" if the failing payment processor or carrier lines up with the deploy.
> - Dedup: per signature, 6h cooldown.
>
> **Cadence:** 5 min (Intelisys is high-volume).
> **Reporter recipient:** `$REPORTER_DEFAULT_SLACK_USER_ID`.
>
> Approve, edit, or tell me to drop a slot.

The user replies: `approved` / `drop slot 3 — too noisy on Intelisys, just slot 1 and 2` / `change cadence to 10 min`. The agent persists the approved spec to `state.json` and starts the loop.

## Anti-patterns

- **Do not propose more than 3 slots.** The structure is
  intentional. If the user needs more dimensions, fold them into an
  existing slot's WHERE clause.
- **Do not propose a slot without a verification predicate.** SQL
  candidates without a Mongo confirmation are not allowed to fire
  `@reporter` — that's the rule that keeps the alarm signal-heavy.
- **Do not re-propose after every tick.** The proposal is a one-time
  approval gate at watch start. Mid-watch changes go through a
  short "I want to change slot N to …" exchange in chat, not a full
  re-propose.
