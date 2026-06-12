# Card anatomy — title and sections

Everything a Content Integration card carries. **Three mandatory sections, up to four optional ones, then the AI footer.**

Section order (mandatory + optional interleaved):

1. `### ⊙ **Short description**` *(mandatory)* — one sentence, the scannable TL;DR.
2. `### ⊙ **Details**` *(mandatory)* — the flow explained, with debug-log permalinks inline to verify. **What changed, not how to fix it.**
3. `### ⊙ **Possible solution / expected behavior**` *(optional, when present sits here — right after Details)* — what should happen instead, in one or two short sentences. State the outcome, not the implementation.
4. `### ⊙ **Visibility**` *(mandatory)* — how we track it: the debuggable query + count/window.
5. `### ⊙ **Credentials / access**` *(optional — new-integration cards only)* — a labeled placeholder the card owner fills by hand.
6. `### ⊙ **QA notes**` *(optional)* — only when there is a shipped fix to verify; omit by default.
7. `### ⊙ **Similar / relevant cards**` *(optional)* — cards that **directly inform** this one.

Do not pad a card with empty optional sections. If an optional section has nothing real to say, leave it out.

## Formatting rules (apply to every section)

- Section headings are **H3 with the `⊙` marker**: `### ⊙ **Short description**`. Never a bare `⊙ **…**` line, never `## `, never H1/H2.
- **No blank line after a heading** — the section content starts on the line directly below the `### ⊙ **…**` heading.
- **One blank line after each section's content**, before the next heading. That gap is what separates the sections; the heading stays attached to its own content. (Within a section, separate paragraphs, permalink groups, and query blocks with a single blank line as usual.)
- The AI footer is the last block, preceded by a `---` rule.

Shape:

```markdown
### ⊙ **Short description**
One sentence here, directly under the heading.

### ⊙ **Details**
First line of details, directly under the heading.

More detail after a blank line inside the section.

### ⊙ **Visibility**
…
```

## Plain language (mandatory)

Write so an ESL reader understands the card on first pass. Short, common words. One idea per sentence. Prefer the simple phrasing on the right:

| Avoid | Use |
|------|-----|
| intermittently | sometimes |
| on a share of attempts / searches | in some cases |
| the failure does not surface on the storefront flow | real users on the front end are not affected by this error |
| is no longer sellable / priceable | can no longer be sold / priced |
| meaningful share | many / a lot of |

Keep error codes and supplier names as-is (they anchor the card). This rule is about the prose around them, not the evidence.

## Glossary (mandatory)

Use the canonical terms in [`GLOSSARY.md`](../../../GLOSSARY.md) in every card. Common ones:

- **ResPro page** — the internal FH / JF agent booking view. Write "ResPro page", never "Voyages a la carte ResPro" or a staging-prefixed URL.
- **the user** (end customer on the storefront) / **the agent** (internal FH/JF employee on ResPro).
- **search results page**, **checkout page**, **check availability call**, **confirmation page / email**, **debug log**.
- **content source** — the upstream supplier (Amadeus, Dida, Sabre, TP, Downtowntravel…). Supplier names are fine in plain text.

No class / method / DTO / file-path names of *our* code in card prose — those belong only inside query blocks. **Supplier API operation names (`OfferPrice`, `PriceUpsellWithoutPNR`, `VerifyPrice`, `BookFlight`, `OrderCreate`, `Fare_PriceUpsellWithoutPNR`, …) are allowed in Details / Possible solution prose when they anchor the specific call site the card is about** — same exception that applies to titles.

## Title

Format: **`SOURCE_OR_AREA: short concrete summary`**. Keep it short — one concrete clause, roughly ≤ 10 words after the prefix. Drop trailing qualifiers ("…and never confirms", "…on a share of searches", "…over the last 14 days").

- `SOURCE` prefix in ALL CAPS: `AMADEUS`, `RESPRO`, `TRAVELFUSION`, `FLXNDC`, `PAYHUB`, `BOOKABILITY`, `WORDSPAN`, `DIDA`, `OPTIMIZATION`, `MULTI TICKETS`, `FARE FAMILIES`, `SEATS`, `BAGGAGE`, `SYNC`, `CHECK AVAILABILITY`, `ACNDC`, `FR24`.
- Colon + space after the prefix.
- Investigations with no fix yet: `(Investigation Pending) SOURCE: …`.
- Concrete symptom after the colon, not vague.
- Align wording with existing titles on the same source after the dedup pass.
- **Supplier operation names are allowed in the title** (`VerifyPrice`, `BookFlight`, `OrderCreate`, `PNR_AddMultiElements`, `Fare_PriceUpsellWithoutPNR`, etc.) when they anchor the card better than a plain-language paraphrase — especially when the same operation is used in several flows (Check Availability + Booker + ancillary re-quote, for example) and naming the operation is more precise than naming one flow. The body still stays plain.

Good: `RESPRO: Downtowntravel booking fails at payment`. `OPTIMIZATION: FLX NDC optimizer misses a cheaper contestant fare`. `AMADEUS: NO FARE FOR CLASS on BookFlight office YYZAA38AA`. `DIDA: Modify VerifyPrice to see fare price changes` (operation name anchors a card that touches multiple flows).

## The sections

### `### ⊙ **Short description**` (mandatory)

One sentence. What fails + where, plain language. The line a groomer reads to triage without opening anything else.

- Everyday verbs (`booking fails`, `we get error X`, `manual rate climbed`).
- Name the flow / integration / content source in plain words.
- One error code is allowed if it anchors the card. No stacked acronyms, no payload walkthroughs, no counts. Those belong elsewhere.

```markdown
### ⊙ **Short description**
BookFlight on Amadeus office YYZAA38AA fails with NO FARE FOR CLASS — looks like a class-mapping mismatch on our side.
```

### `### ⊙ **Details**` (mandatory)

The flow explained end to end so a developer understands what happens and why it breaks. The only section that carries narrative. **Describe what changed, not how to fix it** — fix hypotheses go in `Possible solution / expected behavior`.

- Walk the flow: what the user / agent does, what we send, where the response goes wrong, the hypothesis for why.
- Embed **debug-log permalinks inline** at the step they illustrate, so the reader verifies each claim as they read — not a permalink dump at the bottom. One URL per line.
  - Debug logs: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>`
  - Optimizer logs: swap the base for the optimizer-log tool URL.
- Every factual claim has a link or query behind it. No artefact → mark it `Assumption:` and say what would prove it.
- Related cards go in the optional `Similar / relevant cards` section, not inline here.
- **No code paths, file names, or line ranges in the prose.** Wrong: a `Code:` bullet block citing `include/Mv/Ota/Air/Booker/Dida.php:305`, `src/Supplier/Dida/Operation/AbstractResponse.php:25-40`. Right: describe the behavior (the supplier operation, the user-visible symptom, the debug log). Code-path citations belong in the PR description, not on the card.
- **No "things we still need to figure out" sub-lists.** Wrong: "Two things still need our attention: 1) confirm `handleFareChange` runs end to end, 2) handle the `segment.cabin` change." Open questions either fold into one line in `Possible solution / expected behavior`, or stay in the chat — not on the card.

```markdown
### ⊙ **Details**
On Amadeus BookFlight we send the booking class returned by the search response, but Amadeus rejects it with NO FARE FOR CLASS at pricing.

The search returns class `Q` and we forward it unchanged:
https://reservations.voyagesalacarte.ca/debug-logs/log-group/abc123#65f1

At BookFlight the same class comes back rejected:
https://reservations.voyagesalacarte.ca/debug-logs/log-group/abc123#65f2

Assumption: the fare class expires between search and book on this office — to confirm, compare the search timestamp against the BookFlight timestamp on the same transaction_id.
```

### `### ⊙ **Visibility**` (mandatory)

How we keep an eye on this: the query that surfaces it, plus the current count and window when known.

- One debuggable query — Mongo (leading `$match`) or MySQL / ClickHouse (named CTE). The slice lives in one place so the outer statement swaps between count and examples without re-validating the filter. See [Query structure](#query-structure--always-debuggable-mandatory).
- **The query must surface the bug, not just enumerate the area.** A reviewer running it should see rows that demonstrate the wrong behaviour (requested cabin ≠ returned cabin, supplier returned `NO FARE FOR CLASS`, refund missing the `-` sign, etc.). A pure "list all logs from supplier X in the last N minutes" query is **not** a Visibility query — it is a discovery dump, and discovery dumps belong in the chat, not on the card. If the slice cannot be expressed yet because the payload shape is unknown, do the discovery first (in the chat), then write the Visibility query.
- State the measured result on one line: how often + window + distinct `transaction_id` when known. *OR* a fenced per-day / per-bucket breakdown text table (see [#2746](https://trello.com/c/Nfg1JVNy)) — never both. The table IS the count.
- **Use fenced text tables (monospaced block, aligned with spaces) for tabular numbers.** Trello renders pipe / markdown tables (`| col | col |` with a `|---|---|` separator) as raw text — never use them in a card body. Worked example:

  ````markdown
  ```
  Cabin             Calls   Searches   Won calls   Packages won
  ----------------  ------  ---------  ----------  ------------
  Business          1,198   1,102      548         22,435
  EconomyPremium      880     711      437         19,390
  First               211     176       95          7,231
  ```
  ````

- When no count has been measured yet, omit the count line — the query stands on its own. Do not write "count pending" / "run the query to fill in". Never fabricate a number.
- Scale lives here only. Do not restate counts in Short description or Details.
- **External dashboard URL is allowed when it tracks the same slice.** When an existing Looker / Tableau dashboard is the live counterpart to the query, put `Reference Looker: <url>` (or `Reference Tableau: …`) on its own line **after** the query block. Treat it as a parallel monitoring surface, not a replacement for the query.

````markdown
### ⊙ **Visibility**
47 BookFlight failures, 39 distinct transaction_id, 2026-05-18 → 2026-06-01.

mongo_query:

```javascript
[
  { $match: {
      context: "Amadeus::BookFlight",
      Response: { $regex: "NO FARE FOR CLASS", $options: "i" },
      date_added: { $gte: ISODate("2026-05-18T00:00:00.000Z"), $lte: ISODate("2026-06-01T00:00:00.000Z") }
  }},
  { $sort: { date_added: -1 } },
  { $project: { _id: 0, link: { $concat: [
      "https://reservations.voyagesalacarte.ca/debug-logs/log-group/", "$transaction_id", "#", { $toString: "$_id" } ]}}},
  { $group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } } },
  { $project: { _id: 0, count: 1, links: 1 } }
]
```
````

### `### ⊙ **Possible solution / expected behavior**` (optional)

When present, this section sits **right after Details and before Visibility** — the dev reads what changed, then immediately reads what should happen, then the scale evidence.

Include when there is a clear statement of what should happen instead. Plain language, no code identifiers. One or two short sentences — **state the outcome, not the implementation**.

- **No numbered developer to-do lists** ("1. verify the new payload, 2. add cabin handling, 3. keep the error branch, 4. ship behind a flag"). The dev decides how. The card says what.
- When the upstream change is already live on a staging / sandbox / test environment, name that environment in one line so the dev knows where to test, and attach any supplier confirmation (Slack screenshot, email PDF) on the card.

```markdown
### ⊙ **Possible solution / expected behavior**
We need to read the new fare from the success response and run our standard fare-change flow on both Check Availability and the booker re-quote.

The change is already activated on the Dida sandbox.
```

### `### ⊙ **Credentials / access**` (optional — new-integration cards only)

Only on **new-integration** cards, where someone needs supplier / office access to exercise a flow that does not exist yet. Not on bug / error cards — for those, put any access note in Details. The agent writes the placeholder prompt lines, never the secret values, and never fabricates office codes / PCCs / logins.

```markdown
### ⊙ **Credentials / access**
_To be filled by the card owner:_
- Environment (staging / prod):
- Test office / account / content source:
- Login or PCC needed to reproduce:
```

If the user dictates specific access details, paste exactly what they gave and nothing more.

### `### ⊙ **QA notes**` (optional)

Only when there is a shipped fix to verify. Omit by default. When present: staging repro steps in plain user language, what to check across MySQL / ClickHouse / Mongo, and the post-deploy signal. Observable by a human or a log query only — no class / method / file-path mentions.

### `### ⊙ **Similar / relevant cards**` (optional)

Cards that **directly inform** this one — same code path, same supplier behavior, same root cause, or known overlap of fix. One per line: `[title](shortUrl) — short note on the overlap`. **Drop neighbouring-area cards that only share the supplier or only share the board area** — "another Dida bug" is not enough. If a dev would not open the linked card while working on this one, it does not belong here.

Omit when nothing qualifies. This is where related-card links live — keep them out of Details.

```markdown
### ⊙ **Similar / relevant cards**
[AMADEUS: NO FARE FOR CLASS on BookFlight office YYZAA38AA](https://trello.com/c/abcd1234) — same error, different office.
[RESPRO: Downtowntravel booking fails at payment](https://trello.com/c/efgh5678) — related payment-step failure.
```

### Footer (mandatory)

AI attribution block as the last lines, preceded by a `---` rule. No text after it.

```markdown
---

_Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
```

## Editing older cards

Migrate legacy cards (`⊙ **Summary**` / `⊙ **Numbers/ quantity/ Examples:**`, or bare-`⊙` non-H3 headings) to this layout unless the user asks to keep the old shape. Map Summary → Short description + Details, Numbers/Examples → Visibility.

Field-shape reference cards (read for tone, not structure):

- [#2679 DTT: NDC-1348…](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) — short lead + lean evidence.
- [#2746 FLX NDC: Test Bookings go to Agents](https://trello.com/c/Nfg1JVNy) — breakdown table + bare ResPro example URL + MySQL CTE.

## Query structure — always debuggable (mandatory)

Every aggregation or example query on a card (Visibility, or any query in Details) has the slice defined once and the outer statement swappable between count and examples without re-validating the filter.

**MySQL / ClickHouse:**

```sql
WITH slice AS (
  SELECT ...
  FROM ...
  WHERE ...   -- the named slice; window, content source, error filter
)
SELECT COUNT(*) FROM slice;
```

Ship one outer statement only — count or examples, whichever the card needs. Do **not** paste the counterpart as a commented-out `SELECT`; reviewers can rerun the CTE with a different outer statement themselves.

When a reviewer would naturally want the counterpart (count ↔ examples, coverage ↔ gap rows), **name it on the lead-in line** before the fenced block instead of pasting commented SQL:

```markdown
clickhouse_query (coverage; swap the outer SELECT to join `jupiter_fare_priceupsellwithoutpnr` and filter `offers_returned = 0 AND error_code IS NOT NULL` to inspect gap rows):
```

One prose sentence pointing at the alternate outer is enough — the named CTEs above carry the slice.

### Multi-CTE funnel pattern

When the card sits on a funnel (e.g. `begin_checkout` → upsell call → final-step proposals), build one CTE per stage, then `LEFT JOIN` the optional stages with a `(rn = 1 OR rn IS NULL)` guard so a missing row at a downstream stage does not drop the checkout from the denominator. The latest-row-per-key dedup lives inside each CTE (`ROW_NUMBER() OVER (PARTITION BY <key> ORDER BY <ts> DESC) AS rn`).

```sql
WITH stage_a AS (
  SELECT key1, key2, ...,
         ROW_NUMBER() OVER (PARTITION BY key1, key2 ORDER BY ts DESC) AS rn
  FROM table_a
  WHERE ts > now() - interval 1 day
),
stage_b AS (
  SELECT key1, key2, ...,
         ROW_NUMBER() OVER (PARTITION BY key1, key2 ORDER BY ts DESC) AS rn
  FROM table_b
  WHERE ts > now() - interval 1 day
)
SELECT count(), countIf(<condition>) ...
FROM stage_a
LEFT JOIN stage_b ON stage_a.key1 = stage_b.key1 AND stage_a.key2 = stage_b.key2
WHERE stage_a.rn = 1
  AND (stage_b.rn = 1 OR stage_b.rn IS NULL)
  AND <denominator filter, e.g. is_eligible_for_upgrade = true>;
```

Use an `INNER JOIN` to a "membership" CTE (e.g. "the package's GDS is X") when the slice depends on it; `LEFT JOIN` for stages that may be missing.

**Mongo:** the leading `$match` stage is the slice. Branch between aggregation (`$group` / `$sum` / `$addToSet`) and one of the two canonical permalink shapes below.

Never ship two separately-filtered queries (one for counts, one for examples) on a card — reviewers cannot trust they describe the same slice.

## Mongo permalink output shapes

Pick one per query block. Same `$match`; only the post-`$match` differs.

### Shape B — flat links array (default for cards)

One result doc with `count` and a flat `links[]` — one scroll of pasteable permalinks, no per-row sub-objects to expand. See the Visibility example above.

### Shape A — per-row

N separate result docs, one per match. Use when per-row context columns or per-row filtering in Compass matters, or for a `.forEach(...)` loop in mongosh.

````markdown
```javascript
[
  { $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: { $gte: ISODate("2026-04-01T00:00:00.000Z"), $lte: ISODate("2026-05-01T00:00:00.000Z") }
  }},
  { $project: {
      _id: 0, booking_id: 1, transaction_id: 1, date_added: 1,
      log_id: { $toString: "$_id" },
      link: { $concat: [
        "https://reservations.voyagesalacarte.ca/debug-logs/log-group/", "$transaction_id", "#", { $toString: "$_id" } ]}
  }},
  { $sort: { date_added: -1 } }
]
```
````

**Compass-ready:** `ISODate("…")` for date bounds, unquoted field names, always starts with `$match`. For `optimizer_logs`, swap `Response` for `errors` (and adjust the permalink base URL if the target tool differs); everything else is identical.

**Regex in `Response`:** prefer a short distinctive substring. Escape `.` when literal. For exact JSON tail matches (e.g. `"message":"Failed to reprice"}` only), single-quoted `$regex` in mongosh avoids brittle escaping: `$regex: '"message":"Failed to reprice"}'`.

### smartCard URLs (ResPro / Trello / inline-rendered links)

When an example URL is a ResPro booking page, a Trello card, or anything Trello renders as a smartCard, put the bare URL on its own line — nothing after it. Do not append `(gds=…, cancel_reason=…, booking_date=…, task_id=…)` parentheticals; the smartCard already exposes those fields. One short line under the URL is fine only if a specific task ID or flag is the point of the example.

## Where to pull queries from

- [`bookability`](../../bookability/SKILL.md) — MySQL rates / surfer / recovery + Mongo permalink harvest.
- [`db_access`](../../db_access/SKILL.md) — find the right table, document a newly understood one.
- Repo scripts: `.cursor/skills/db_access/scripts/mysql_query.py`, `clickhouse_query.py`, `mongo_query.py`.

Keep runnable text inside Visibility / Details. Do not paste post-query runbook prose ("Scope (counts):", "reuse the same `$match`", "append `{ $count: … }`") on the card; counting mechanics stay in skills, not on Trello.
