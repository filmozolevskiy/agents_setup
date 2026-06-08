# Card anatomy — title and sections

Everything a Content Integration card carries. **Three mandatory sections, up to three optional ones, then the AI footer.**

Mandatory, in order:

1. `### ⊙ **Short description**` — one sentence, the scannable TL;DR.
2. `### ⊙ **Details**` — the flow explained, with debug-log permalinks inline to verify.
3. `### ⊙ **Visibility**` — how we track it: the debuggable query + count/window.

Optional — include only when they apply:

4. `### ⊙ **Possible solution / expected behavior**` — what we think should happen or how to fix it.
5. `### ⊙ **Credentials / access**` — **new-integration cards only**; a labeled placeholder the card owner fills by hand.
6. `### ⊙ **QA notes**` — only when there is a shipped fix to verify; omit by default.
7. `### ⊙ **Similar / relevant cards**` — related cards the dedup pass or scope overlap turned up.

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

No class / method / DTO / file-path names in card prose — those belong only inside query blocks.

## Title

Format: **`SOURCE_OR_AREA: short concrete summary`**. Keep it short — one concrete clause, roughly ≤ 10 words after the prefix. Drop trailing qualifiers ("…and never confirms", "…on a share of searches", "…over the last 14 days").

- `SOURCE` prefix in ALL CAPS: `AMADEUS`, `RESPRO`, `TRAVELFUSION`, `FLXNDC`, `PAYHUB`, `BOOKABILITY`, `WORDSPAN`, `DIDA`, `OPTIMIZATION`, `MULTI TICKETS`.
- Colon + space after the prefix.
- Investigations with no fix yet: `(Investigation Pending) SOURCE: …`.
- Concrete symptom after the colon, not vague.
- Align wording with existing titles on the same source after the dedup pass.

Good: `RESPRO: Downtowntravel booking fails at payment`. `OPTIMIZATION: FLX NDC optimizer misses a cheaper contestant fare`. `AMADEUS: NO FARE FOR CLASS on BookFlight office YYZAA38AA`.

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

The flow explained end to end so a developer understands what happens and why it breaks. The only section that carries narrative.

- Walk the flow: what the user / agent does, what we send, where the response goes wrong, the hypothesis for why.
- Embed **debug-log permalinks inline** at the step they illustrate, so the reader verifies each claim as they read — not a permalink dump at the bottom. One URL per line.
  - Debug logs: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>`
  - Optimizer logs: swap the base for the optimizer-log tool URL.
- Every factual claim has a link or query behind it. No artefact → mark it `Assumption:` and say what would prove it.
- Related cards go in the optional `Similar / relevant cards` section, not inline here.

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
- State the measured result on one line: how often + window + distinct `transaction_id` when known. *OR* a fenced per-day / per-bucket breakdown text table (see [#2746](https://trello.com/c/Nfg1JVNy)) — never both. The table IS the count.
- When no count has been measured yet, omit the count line — the query stands on its own. Do not write "count pending" / "run the query to fill in". Never fabricate a number.
- Scale lives here only. Do not restate counts in Short description or Details.

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

Include when there is a concrete hypothesis for the fix or a clear statement of what should happen instead. Plain language, no code identifiers.

```markdown
### ⊙ **Possible solution / expected behavior**
Expected: the class we book matches the class still sold at book time. Likely fix: re-check class availability at BookFlight and re-price if it changed, instead of forwarding the search-time class blind.
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

When the dedup pass or scope overlap turns up related cards. One per line: `[title](shortUrl) — short note on the overlap`. Omit when nothing relevant. This is where related-card links live — keep them out of Details.

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
