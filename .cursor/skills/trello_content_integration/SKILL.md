---
name: trello-content-integration
description: >-
  Use when creating or updating Trello cards on the Content Integration board,
  filing backlog items for content sources, GDS integrations, bookability,
  optimizer, or payhub—or when the user mentions Trello, CI board, or backlog
  tickets for those areas.
---

# Trello: Content Integration board

Use the **user-trello** MCP server. **Before each tool call**, read that tool’s JSON schema under `mcps/user-trello/tools/`. Prefer `set_active_board` once per session, then omit `boardId` where the API allows.

## Board and list (fixed)

| Item | ID |
|------|-----|
| Board **Content Integration** | `61d5cf784c6396541499e7ce` |
| List **Backlog** | `6509c593087340dfdd332b0a` |

**New cards:** always create with `add_card_to_list` on list `6509c593087340dfdd332b0a` (Backlog). Do not place new agent-created cards in Ready for Dev, In Progress, or other lists unless the user explicitly overrides.

**Updates:** use `update_card_details`, `move_card`, checklists, labels, and comments as needed. When updating, keep the card on its current list unless the user asks to move it.

## Deduplication and related cards (before creating)

**Do not add a new card** until you have checked the board for work that already tracks the **same change or fix**.

1. `set_active_board` (this board), then `get_lists`.
2. Fetch cards from every **active-work** list: **Backlog**, **Ready for Dev**, **In Progress**, **Blocked**, **Staging**, **Fixes needed**, **Ready for Deployment**, **QA**, **QA Tracking 👀**, **Parking**, **On hold**, **Done**, and **Archive**. Skip **INFORMATION** (dashboard/meta). Use `get_cards_by_list_id` per list.
3. **Match using:** same or obvious alias **title prefix** (e.g. `AMADEUS`, `RESPRO`), core keywords, carrier/office/GDS named in the request, booking ID, hash, or error text—compare both **card names** and, for candidates, `get_card` **descriptions** (`includeMarkdown`: true when useful).
4. **Outcomes:**
   - **Same change / duplicate:** Do **not** create a new card. Tell the user which card(s) already cover it (use each card’s `shortUrl` / `url`). Offer to **add** the user’s new examples, queries, or links via **`add_comment`** on that card or **`update_card_details`** on the description, instead of opening a duplicate.
   - **No duplicate but similar / overlapping:** Create the card (still Backlog) **and** note overlaps as **one or two bullets** under `⊙ **Numbers/ quantity/ Examples:**` (e.g. `Related: [title](shortUrl) — same office, different error`). Do **not** add a large standalone “Related cards” section unless the user asks.
   - **No related cards found:** Proceed with creation; omit a “none found” line unless it helps the team.

When the user explicitly wants a **new** card even though a close duplicate exists (e.g. split scope), note the duplicate **under Numbers/ Examples** and explain the split in one short bullet.

## Card title (naming)

Match titles already used on this board:

- **`SOURCE_OR_AREA: Short concrete summary`** — `SOURCE` is usually the GDS / integration / product prefix in **ALL CAPS** (e.g. `AMADEUS`, `RESPRO`, `TRAVELFUSION`, `FLXNDC`, `PAYHUB`, `BOOKABILITY`, `WORDSPAN`, `DIDA`, `OPTIMIZATION`, `MULTI TICKETS`).
- Use a **colon and space** after the prefix.
- For investigations without a fix yet, mirror existing patterns: `(Investigation Pending) SOURCE: …`
- Keep the part after the colon specific (symptom or desired outcome), not vague.

Before finalizing a title, use the **Deduplication and related cards** pass above; among non-duplicates, align wording with existing titles on the same **source or topic**.

## Description templates (copy structure)

**Always keep the description body short.** The **entire** description (before the AI footer) must use **only these two sections**, in this order—**no** extra `⊙` headings, **no** multi-section “investigation” layouts, **no** exceptions:

1. `⊙ **Summary**`
2. `⊙ **Numbers/ quantity/ Examples:**`

Target shape (which **fields** to use, not how long the text must be): [#2676 DTT: Passenger type or count…](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error). For **tone and lean Numbers**, prefer [#2679 DTT: NDC-1348…](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc): **short Summary**, then **Scale** + **Examples:** + **MongoDB Query** without long runbook bullets unless the user asks for depth.

Put anything that would have been “Describe the situation”, investigation narrative, repro steps, QA notes, or proposed solutions **inside** `⊙ **Numbers/ quantity/ Examples:**` as **compact bullets**—do **not** add separate `⊙` blocks for those topics.

### `⊙ **Summary**`

- **Tone:** **human-readable and calm**—write like you are explaining the ticket to a teammate in one breath. Prefer **short sentences** and **everyday verbs** (*we get*, *it looks like*, *booking fails*) over dense stack-speak. **Do not** pack the Summary with acronyms (**PTC**, **NDC** field names, **HTTP** minutiae, “dated marketing segment”, long supplier quotes, or multi-clause technical one-liners). Name the **integration or flow** in plain words when it helps (e.g. “in **BookFlight**”, “on **Downtowntravel**”). One **error code or short phrase** is fine if it anchors the card.
- **Length:** often **1–3 sentences** (~**25–80 words**); use up to **2–5 sentences** (~**40–120 words**) only when the *what / where* truly needs it. No multi-line logs here.
- **Content:** answer *what fails*, *where* (which flow or integration), and *why we are tracking it* in plain language—**hypothesis-level** (“looks like we map X wrong on our side”) is OK; **proof** (permalink, query, histogram) stays in **Numbers/ Examples**.

```markdown
⊙ **Summary**

We get this error NDC-1348 INVALID_AGE_FOR_PAX_TYPE in BookFlight. It looks like we map the passenger age incorrectly on our side.
```

(Adjust names/codes to the actual card; keep this **density** unless the user asks for a more formal runbook style.)

### `⊙ **Numbers/ quantity/ Examples:**`

Default to a **lean** layout readers can scan in seconds. Put **heavy** detail (collection names, `context`, regex rationale, MySQL/Mongo correlation essays, histograms, “count only” mongosh tips, long **Related** notes) here **only when the user requests it**—otherwise the **query + a few links** are enough.

**Preferred order (match [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) style):**

1. **Scale** — **one short line**, plain language. State **how often** and the **window** (and **distinct `transaction_id`** when you have it).  
   - Good: `Scale - 93 times in 30d; 39 distinct transaction_id in 30d`  
   - Avoid by default: long preambles (`ota.debug_logs`, `context …`, `Response matching …`) in the Scale line—the **MongoDB Query** encodes that.
2. **`Examples:`** — on its own line, then **a handful** of **full** debug permalinks (`https://…/debug-logs/log-group/<transaction_id>#<log_id>`). Use **bullet lines** per link; add **one short** inline note after a link when it disambiguates (e.g. key supplier fields). **Do not** paste dozens of permalinks; the aggregation is for harvesting more.
3. **`MongoDB Query`** — on its own line (this label, not “mongosh — …” essay), then **one** fenced block (`javascript` or plain) with the pipeline. Run in **mongosh** / **Compass** / **pymongo** with real dates. Template and variants (**dedupe per `transaction_id`**, full `links` array, `$count`) live in **`bookability_analysis`** → [Aggregation: harvest debug log permalinks](../bookability_analysis/SKILL.md#aggregation-harvest-debug-log-permalinks-mongosh--compass). Adjust **`$match`** (`context`, `date_added`, `Response` regex) to the incident.

**Optional extras** (add only if useful; keep each to **one line**):

- **Breakdown** — e.g. parsed counts from `Response` (age vs PTC buckets).
- **Correlation** — e.g. `transaction_id` ↔ MySQL `search_hash` / `bookability_*`.
- **Related:** `[title](shortUrl)` — one line when dedup or scope needs it.
- **Second query** — e.g. MySQL or a second Mongo pipeline; **at most two** fenced blocks total unless the user asks for more.
- **`IN (...)` hash lists** — keep **verbatim** when they are evidence; do not trim.

If there are no examples yet, say so and still give the **MongoDB Query** (or SQL) that finds cases.

**Where to pull queries from:** **`bookability_analysis`** (MySQL + **Mongo permalink harvest**); **`explore_tables`** / **`document_table`**; repo scripts (`scripts/mysql_query.py`, `scripts/clickhouse_query.py`, `scripts/mongo_query.py`). Keep runnable text **inside** this section.

````markdown
⊙ **Numbers/ quantity/ Examples:**

Scale - 93 times in 30d; 39 distinct transaction_id in 30d

Examples:

- https://reservations.voyagesalacarte.ca/debug-logs/log-group/…#… — short note if needed

MongoDB Query

```javascript
[
  { $match: { … } },
  …
]
```
````

(Use the same **MongoDB Query** label for other DBs only when the fenced block is Mongo; for SQL use a clear one-line label such as **MySQL**.)

## Mandatory fields (do not ship the card without these)

1. `⊙ **Summary**` — short paragraph as above: **plain language first** (always this heading, not `## Summary`).
2. `⊙ **Numbers/ quantity/ Examples:**` — **lean by default:** one-line **Scale**, **`Examples:`** + permalinks, **`MongoDB Query`** (or SQL) fenced block; optional one-line extras only when needed; related-card line only when dedup requires it.
3. **AI attribution footer** — exact block at the end (see below).

## Labels

After `get_board_labels` for this board, map the user’s intent to existing names, for example:

- **Bugs & Fixes** — defects, regressions, wrong fees, errors.
- **Optimization** — optimizer, routing, contestant eligibility, performance of flows.
- **New Integration** — new source or major integration slice.
- **Injection** — injection-related work.
- **Investigation / Assesment** — unclear root cause, assessment-first.

Use label **names** consistently with board practice; pass the correct label **IDs** to `add_card_to_list` / `update_card_details`.

## MCP workflow (minimal)

1. `set_active_board` with board `61d5cf784c6396541499e7ce`.
2. **New card:** run **Deduplication and related cards** fully. Only if not duplicate: `add_card_to_list` on **Backlog** (`6509c593087340dfdd332b0a`) with `name` per **Card title**, `description` = `⊙ **Summary**` + `⊙ **Numbers/ quantity/ Examples:**` + **AI footer**, optional `labels`.
3. **Structure reference:** field layout—[#2676](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error); **Summary + lean Numbers**—[#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc). Optionally `get_card` (`includeMarkdown`: true) for layout—**do not copy private or unrelated content verbatim**.
4. **Edits:** `update_card_details` / `move_card` / checklist tools as needed. If the description gains substantial new scope, refresh `⊙ **Summary**` so it still matches the card.

## AI agent footer (required)

Append this as the **last lines** of every **description** the agent writes (new or updated), with no text after it:

```markdown
---

_Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
```

## What not to do

- Do not create new cards outside **Backlog** unless the user explicitly asks.
- Do not skip the **deduplication** pass before creating a card.
- Do not invent booking IDs, hashes, or log URLs.
- Do not **trim** real `IN (...)` hash lists, SQL filters, or Mongo bounds **inside Numbers/ Examples** just to shorten the card—those lists are often the reproducible slice.
- Do not omit `⊙ **Numbers/ quantity/ Examples:**` when there are examples, queries, or patterns—put them there (compact).
- Do not bury related-card context in a long standalone section; use **one or two bullets** under **Numbers/ Examples** unless the user asked for more.
- Do not omit `⊙ **Summary**` or replace it with only the card title.
- Do not write a **jargon-heavy Summary** (long technical sentences, stacked acronyms, supplier payload walkthroughs)—put that under **Numbers/ Examples** with permalinks and queries.
- Do not **pad Numbers/ Examples** with long **Scale** preambles, correlation essays, histograms, or extra mongosh tips when a **short Scale + Examples + MongoDB Query** already reproduces the issue—add those only when they change decisions.
- Do not **edit an existing card** the user pointed to as a **reference-only** example—unless they explicitly ask to update that card; create **new** content using the same style instead.
- Do not add extra description sections (`Describe the situation`, `What investigation was done`, `How to reproduce`, `Documentation`, `QA`, `Solution`, `## Summary` blocks, optimization-only multi-`⊙` layouts, etc.)—fold everything into the two allowed sections.
