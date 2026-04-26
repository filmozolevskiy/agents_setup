---
name: trello-content-integration
description: >-
  Use when creating or updating Trello cards on the Content Integration board,
  filing backlog items for content sources, GDS integrations, bookability,
  optimizer, or payhub; when the user asks to prep grooming / produce a
  grooming report / list what each dev has in flight (developer-centric
  in-flight report across Ready for Dev, In Progress, Blocked, Staging,
  Fixes needed, Ready for Deployment); OR when the user points you at any
  Trello card (`/c/<shortLink>` URL on either the Content Integration or the
  Content Integration - AI Automation board) and asks you to work the task
  described on it — read this skill so you get the lifecycle rules
  (in-progress / QA / done transitions, mandatory closing comment, one
  card → one branch → one PR) right.
---

# Trello: Content Integration board

Use the **user-trello** MCP server. Before each tool call, read that tool's JSON schema under `mcps/user-trello/tools/`. Prefer `set_active_board` once per session, then omit `boardId` where the API allows.

## Board and list (fixed)

| Item | ID |
|------|-----|
| Board **Content Integration** | `61d5cf784c6396541499e7ce` |
| List **Backlog** | `6509c593087340dfdd332b0a` |

**Different board for Automation cards.** When the user asks to file a card for new Automation functionality (agents, AI pipelines, internal tools that automate a workflow), follow [`automation_cards.md`](./automation_cards.md) instead — different board, short human-written description, none of the dedup / `⊙` / footer machinery below applies.

**New cards:** always create with `add_card_to_list` on list `6509c593087340dfdd332b0a` (Backlog). Do not place new agent-created cards in Ready for Dev, In Progress, or other lists unless the user explicitly overrides.

**Updates:** use `update_card_details`, `move_card`, checklists, labels, and comments as needed. Keep the card on its current list unless the user asks to move it.

**Archiving:** use `archive_card`. Add a descriptive comment first (e.g. "Project stopped", "Duplicate of X") before archiving.

## Deduplication and related cards (before creating)

Do not add a new card until the board has been checked for existing work covering the same change or fix.

1. `set_active_board` (this board), then `get_lists`.
2. Fetch cards from every active-work list: **Backlog**, **Ready for Dev**, **In Progress**, **Blocked**, **Staging**, **Fixes needed**, **Ready for Deployment**, **QA**, **QA Tracking 👀**, **Parking**, **On hold**, **Done**, **Archive**. Skip **INFORMATION** (dashboard / meta). Use `get_cards_by_list_id` per list.
3. **Filter reliably.** Large boards produce huge JSON. Use the repo script instead of shell pipelines.
   - Script: `.cursor/skills/trello_assistant/scripts/filter_cards.py`
   - Parses real JSON (`json.load`). Pass MCP output files or pipe via stdin.
   - **Explicit files (preferred):**
     ```bash
     python3 .cursor/skills/trello_assistant/scripts/filter_cards.py \
       --terms "keyword1" "keyword2" \
       --exclude "listID1" "listID2" \
       -- path/to/cards_backlog.json path/to/cards_ready_for_dev.json
     ```
   - **Stdin:** `... filter_cards.py --terms "keyword" < cards.json`
   - Accepts a top-level array or an object wrapping it.
   - Output: one line per card, `name | url`, deduped, sorted by name.
   - Prefers `url` (slug-bearing) over `shortUrl`; falls back to `shortUrl` only if `url` is absent.
4. **Match using:** title prefix (e.g. `AMADEUS`, `RESPRO`), core keywords, carrier / office / GDS named in the request, booking ID, hash, error text. Compare card names and — for candidates — `get_card` descriptions (`includeMarkdown`: true when useful).
5. **Outcomes:**
   - **Duplicate:** do not create a new card. Tell the user which card(s) already cover it (use `shortUrl` / `url`). Offer to add new examples, queries, or links via `add_comment` or `update_card_details` on that card.
   - **Similar / overlapping but not duplicate:** create the card (Backlog) and note overlaps as one or two bullets under `⊙ **Numbers/ quantity/ Examples:**` (e.g. `Related: [title](shortUrl) — same office, different error`). Do not add a separate "Related cards" section unless the user asks.
   - **Nothing related:** create. Omit a "none found" line unless it helps the team.

When the user explicitly wants a new card even though a close duplicate exists (e.g. split scope), note the duplicate under Numbers/ Examples and explain the split in one short bullet.

## Card title (naming)

Match titles already used on this board:

- **`SOURCE_OR_AREA: Short concrete summary`** — `SOURCE` is the GDS / integration / product prefix in **ALL CAPS** (e.g. `AMADEUS`, `RESPRO`, `TRAVELFUSION`, `FLXNDC`, `PAYHUB`, `BOOKABILITY`, `WORDSPAN`, `DIDA`, `OPTIMIZATION`, `MULTI TICKETS`).
- Colon and space after the prefix.
- Investigations without a fix yet: `(Investigation Pending) SOURCE: …`.
- The part after the colon: concrete symptom or outcome, not vague.

Run the deduplication pass first. Among non-duplicates, align wording with existing titles on the same source or topic.

## Description templates (copy structure)

Keep the description body short. The entire description (before the AI footer) uses **only these two sections**, in this order. No extra `⊙` headings, no multi-section "investigation" layouts, no exceptions:

1. `⊙ **Summary**`
2. `⊙ **Numbers/ quantity/ Examples:**`

Field-shape reference: [#2676 DTT: Passenger type or count…](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error). For tone and lean Numbers: [#2679 DTT: NDC-1348…](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) — short Summary, then Scale + some examples + mongo_query. For several distinct error signatures on the same flow: [#2677 DTT: VerifyPrice errors](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors) — one example block per signature; do not mash unrelated regexes into a single list.

Anything that would have been "Describe the situation", investigation narrative, repro steps, QA notes, or proposed solutions goes inside `⊙ **Numbers/ quantity/ Examples:**` as compact bullets. Do not add separate `⊙` blocks for those topics.

### `⊙ **Summary**`

- **Tone:** plain, calm, like explaining the ticket to a teammate in one breath. Short sentences. Everyday verbs (*we get*, *it looks like*, *booking fails*). Do not pack the Summary with acronyms (PTC, NDC field names, HTTP minutiae, "dated marketing segment", long supplier quotes, or multi-clause technical one-liners). Name the integration or flow in plain words (e.g. "in **BookFlight**", "on **Downtowntravel**"). One error code or short phrase is fine if it anchors the card.
- **Length:** usually 1–3 sentences (~25–80 words). Up to 2–5 sentences (~40–120 words) only if the *what / where* needs it. No multi-line logs.
- **Content:** *what fails*, *where* (flow or integration), *why we are tracking it*. Plain language. Hypothesis ("looks like we map X wrong on our side") is OK. Proof (permalink, query, histogram) goes in Numbers/ Examples.

```markdown
⊙ **Summary**

We get this error NDC-1348 INVALID_AGE_FOR_PAX_TYPE in BookFlight. It looks like we map the passenger age incorrectly on our side.
```

(Adjust names / codes to the actual card. Keep this density unless the user asks for a more formal runbook style.)

### `⊙ **Numbers/ quantity/ Examples:**`

Lean by default — readers scan in seconds. Add heavy detail (collection names, `context`, regex rationale, MySQL / Mongo correlation essays, histograms, long Related notes) only when the user asks. The query plus a few links is usually enough.

**Prevalence / counts:** put totals in the **Scale** line only (e.g. log-line count and distinct `transaction_id` for the stated window). Do not add a prose runbook after `mongo_query:` explaining how to derive counts. No "Scope (counts): reuse the same `$match`…", "append `{ $count: … }`", or "move the `date_added` window as needed." Those instructions live in `bookability_analysis` and agent context, not on the card.

**Order — card-level (optional one line, then example blocks):**

1. **Scale** — one short line, plain language (optional if not measured yet). How often and the window (and distinct `transaction_id` when known).
   - Good: `Scale - 93 times in 30d; 39 distinct transaction_id in 30d`
   - Avoid: long preambles — the `mongo_query` block encodes filters.
2. **Setup** (only when useful, one line): e.g. database `ota`, collection `debug_logs`, `context:` `…`; run pipelines in mongosh or Compass (`ISODate`).

**Per error signature (one block per distinct pattern — see [#2677](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors)):**

1. **Title line:** `**SOURCE_OR_CODE — Short label — example: debug log**` (e.g. `**325 — No available solution — example: debug log**`).
2. Blank line, then `some examples` on its own line.
3. Blank line, then full permalinks — one URL per line (`https://…/debug-logs/log-group/<transaction_id>#<log_id>`). Bullets are OK. Plain lines match board style. Add rows until the slice is representative. Use `mongo_query` to harvest more when the card would get too long.
4. Blank line, then `mongo_query:` on its own line (this label, not "MongoDB Query" or a prose runbook).
5. **Fenced `javascript`** block: full aggregation that pastes directly into MongoDB Compass's Aggregation tab — `ISODate("…")` for date bounds, unquoted field names, always starts with `$match` (`context`, `date_added` bounds, regex on the collection's payload text field — `Response` on `debug_logs`, `errors` on `optimizer_logs`). Pick one of the two canonical output shapes below. Swap only the `$match` for each signature.
   - **Shape B — flat links array (default for cards).** `$sort: { date_added: -1 }` (optional — chronological), `$project` returns just `link` via `$concat` with the base URL, `$group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } }`, final `$project: { _id: 0, count: 1, links: 1 }`. One result doc with `count` and a flat `links[]` — one scroll of pasteable permalinks, no per-row sub-objects to expand. Default for cards. Matches harvest templates in [`bookability_analysis/references/harvest_permalinks.md`](../bookability_analysis/references/harvest_permalinks.md).
   - **Shape A — per-row.** `$project` returns one document per match with `booking_id`, `transaction_id`, `date_added`, `log_id`, and the `link`; end with `$sort: { date_added: -1 }`. N separate result docs. Use when per-row context columns or per-row filtering in Compass matters, or for a `.forEach(...)` loop in mongosh.

**Single-signature cards** (e.g. [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc)): one block after Scale. `some examples` + `mongo_query:` labels still preferred. The long `**… — example: debug log**` title is optional if the card title already names the error; keep it for scanability otherwise.

**Counts / deduped permalinks:** agents use `bookability_analysis` (or DB tools) to compute prevalence, then write the result in Scale. Do not paste "how to count" steps on the card. For harvest pipelines, see the same skill's permalink variants when retries inflate line count.

**Optional extras** (add only if useful; keep each to one line):

- **Breakdown** — parsed counts from `Response` (e.g. age vs PTC buckets).
- **Correlation** — `transaction_id` ↔ MySQL `search_hash` / `bookability_*`.
- **Related:** `[title](shortUrl)` — one line when dedup or scope needs it.
- **Second query** — MySQL or a second `mongo_query:` block. At most two fenced blocks per signature unless the user asks; multi-signature cards have one pipeline per block.
- **`IN (...)` hash lists** — keep verbatim when they are evidence. Do not trim.

If there are no examples yet, say so and still give `mongo_query:` (or MySQL) that finds cases.

**Where to pull queries from:** `bookability_analysis` (MySQL + Mongo permalink harvest); `table_analysis` (find the right table, or write up a newly understood one); repo scripts (`scripts/mysql_query.py`, `scripts/clickhouse_query.py`, `scripts/mongo_query.py`). Keep runnable text inside this section.

**Query structure — always debuggable (mandatory):** every MySQL / ClickHouse aggregation or example query uses a CTE that defines the slice (filters, window, joins) once, and an outer statement that is either an aggregate (`COUNT(...)`, `SUM(...)`) or an example `SELECT ... LIMIT N`. Include the counterpart as a commented-out outer `SELECT` from the same CTE so reviewers can swap count ↔ examples without re-validating the filter. For Mongo, the leading `$match` stage plays the same role — name the slice there, then branch between aggregation (`$group` with `$sum` / `$addToSet` etc.) and one of the two permalink output shapes: **Shape B** (default — `$sort: { date_added: -1 }` → `$project: { _id: 0, link: … }` → `$group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } }` → `$project: { _id: 0, count: 1, links: 1 }`, single doc with a flat links array) or **Shape A** (`$project` with context columns → `$sort: { date_added: -1 }`, N separate docs). Either shape is card-safe. The Mongo pipeline must paste directly into Compass's Aggregation tab — `ISODate("…")` for date bounds, unquoted field names, same permalink base URL as the examples.

````markdown
⊙ **Numbers/ quantity/ Examples:**

Scale - 93 times in 30d; 39 distinct transaction_id in 30d

**NDC-1348 — INVALID_AGE_FOR_PAX_TYPE — example: debug log**

some examples

https://reservations.voyagesalacarte.ca/debug-logs/log-group/…#…
https://reservations.voyagesalacarte.ca/debug-logs/log-group/…#…

mongo_query (Shape B — flat links array, default for cards):

```javascript
[
  { $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
  }},
  { $sort: { date_added: -1 } },
  { $project: {
      _id: 0,
      link: { $concat: [
        "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
        "$transaction_id", "#", { $toString: "$_id" }
      ]}
  }},
  { $group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } } },
  { $project: { _id: 0, count: 1, links: 1 } }
]
```

mongo_query (Shape A — per-row; same slice, no `$group`):

```javascript
[
  { $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
  }},
  { $project: {
      _id: 0,
      booking_id: 1,
      transaction_id: 1,
      date_added: 1,
      log_id: { $toString: "$_id" },
      link: { $concat: [
        "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
        "$transaction_id", "#", { $toString: "$_id" }
      ]}
  }},
  { $sort: { date_added: -1 } }
]
```

Pick one shape per `mongo_query:` block, not both. Use the same label (`mongo_query:`) without the `(Shape …)` suffix on the card; the suffix here is only for this template. For `optimizer_logs`, swap `Response` for `errors` (and adjust the permalink base URL if the target tool differs); everything else is identical.
````

(For SQL, use a clear one-line label such as **MySQL:** instead of `mongo_query:`.)

**Regex in `Response`:** prefer a short distinctive substring. Escape `.` when literal. For exact JSON tail matches (e.g. `"message":"Failed to reprice"}` only), a single-quoted `$regex` in mongosh avoids brittle escaping: `$regex: '"message":"Failed to reprice"}'`.

## Mandatory fields (do not ship the card without these)

1. `⊙ **Summary**` — short paragraph, plain language first (always this heading, not `## Summary`).
2. `⊙ **Numbers/ quantity/ Examples:**` — lean by default: optional **Scale** + one or more blocks each with `some examples` (permalink lines) + `mongo_query:` fenced pipeline (or **MySQL:**); optional one-line extras only when needed; related-card line only when dedup requires it.
3. **AI attribution footer** — exact block at the end (see below).

## Grooming prep report (weekly)

When the user asks to **prep grooming** / produce a **grooming report** / list **what each dev has in flight**, produce the canonical developer-centric in-flight report. Do not invent a different layout; users review it the same way every week.

**What the report is:**

- Developers only, per [`roles.md`](./roles.md) § Developers. Everyone else (QA, analysts, specialists, manual agent team) is excluded.
- **Every card currently sitting in the 6 in-flight lists**, regardless of recent activity:
  1. `In Progress` — `61d5cfd748343984d1dd4fc3`
  2. `Ready for Dev` — `61d5cfd1ffca1f891a0fd237`
  3. `Blocked` — `679d612a6f880eb62c672aa1`
  4. `Staging` — `68de85f3a35d950e37cefc8b`
  5. `Fixes needed` — `65563ff118d482065927fa4b`
  6. `Ready for Deployment` — `68e7ce249a3c3f669f04399b`
- If any list ID above 404s / returns empty unexpectedly, run `get_lists` against the board and refresh the mapping — admins occasionally rename or recreate a list.
- Cards idle for 14+ days carry a `**STALE 14d+**` marker. A card can appear under multiple devs; counts are lines, not unique board cards.

**Procedure:**

1. `set_active_board` with `61d5cf784c6396541499e7ce` once per session, then `get_cards_by_list_id` for each of the 6 lists above. Save each response as a JSON array to a file (one per list) — the MCP response body is already a JSON array.
2. Run the script:

   ```bash
   python3 .cursor/skills/trello_assistant/scripts/grooming_report.py \
     --list "In Progress:/abs/path/in_progress.json" \
     --list "Ready for Dev:/abs/path/ready_for_dev.json" \
     --list "Blocked:/abs/path/blocked.json" \
     --list "Staging:/abs/path/staging.json" \
     --list "Fixes needed:/abs/path/fixes_needed.json" \
     --list "Ready for Deployment:/abs/path/ready_for_deployment.json" \
     --out reports/grooming_devs_inflight_$(date -u +%F).md
   ```

3. Summarize to the user: per-list volumes, biggest in-flight queues, and any stale cards worth flagging. Link to the generated file in `reports/`.

**Keep the developer mapping honest.** The script hard-codes Trello member IDs → display names in `DEVELOPERS`. When someone joins or leaves the dev team, update both [`roles.md`](./roles.md) § Developers **and** `DEVELOPERS` in `scripts/grooming_report.py`. A missing entry silently drops that dev's cards from the report.

**What not to do:**

- Do not filter by `dateLastActivity` window. The report is "everything in flight", not "touched this week".
- Do not include non-dev roles, even if they have cards in the in-flight lists.
- Do not include `QA`, `QA Tracking 👀`, `Done`, `Parking`, or any other list. Only the 6 in-flight lists above.
- Do not re-order the per-dev sub-buckets. Always `In Progress → Ready for Dev → Blocked → Staging → Fixes needed → Ready for Deployment`.
- Do not drop the `**STALE 14d+**` flag or change the 14d threshold without the user asking.

## Team roles

See [`roles.md`](./roles.md) for the current mapping of team members to roles (developers, QA, analysts, ancillaries, post-ticketing, manual agent team). Consult it when suggesting an owner, reviewer, or `@mention` for a card. Do not auto-assign. Propose a person based on the role mapping and let the user confirm.

**Mandatory member — Filipp (delivery manager):** every card the agent creates or updates must include Filipp as a member. No exceptions. When creating a card, pass Filipp's member ID in `idMembers` on `add_card_to_list`. When updating, if he is not already on the card, add him via `update_card_details` (or the member-add tool). If Filipp's Trello member ID is unknown, fetch board members first (e.g. `get_board_members`) and cache the ID for the session.

## Labels

After `get_board_labels` for this board, map the user's intent to existing names, e.g.:

- **Bugs & Fixes** — defects, regressions, wrong fees, errors.
- **Optimization** — optimizer, routing, contestant eligibility, flow performance.
- **New Integration** — new source or major integration slice.
- **Injection** — injection-related work.
- **Investigation / Assesment** — unclear root cause, assessment-first.

Use label names consistent with board practice. Pass the correct label IDs to `add_card_to_list` / `update_card_details`.

## MCP workflow (minimal)

1. `set_active_board` with board `61d5cf784c6396541499e7ce`.
2. **New card:** run the deduplication pass. Only if not duplicate: `add_card_to_list` on **Backlog** (`6509c593087340dfdd332b0a`) with `name` per **Card title**, `description` = `⊙ **Summary**` + `⊙ **Numbers/ quantity/ Examples:**` + AI footer, optional `labels`.
3. **Structure reference:** field layout — [#2676](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error); Summary + lean Numbers — [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc); multi-signature `some examples` + `mongo_query:` — [#2677](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors). Optionally `get_card` (`includeMarkdown`: true) for layout. Do not copy private or unrelated content verbatim.
4. **Edits:** `update_card_details` / `move_card` / checklist tools as needed. If the description gains substantial new scope, refresh `⊙ **Summary**` so it still matches the card.

## Responding to TODOs / direct requests on an existing card

When the card description or user leaves a TODO (e.g. `TODO: Write a query to verify this`) or asks for a specific artefact on an existing card, deliver exactly that — no more:

- "Write a query" → the reply is the query. Paste query output only when the TODO explicitly asks for numbers or examples.
- Do not expand into a verification essay. No multi-section narratives, runbook prose, dev-work notes, code-path pointers, affiliate / content-source provenance, multi-week trend tables, architectural clarifications, glossary reminders — unless the TODO explicitly asks.
- One short lead sentence naming the slice (window, filter) is fine. The rest is the artefact and, when asked, a small result sample.
- If you notice something important outside the ask, mention it in one line at the end (`Side note: …`). Never grow it into another section.
- Same rule for comments and description updates: match the scope of the ask, not the breadth of your investigation.

**Confirm the data grain before querying.** The card title prefix (`OPTIMIZER:`, `BOOKABILITY:`, `PAYHUB:` …) reflects product area, not data grain. Do not let it steer the table choice. For multi-ticket "find the combination of CARRIER_A + CARRIER_B" TODOs the grain is `ota.bookability_contestant_attempts` (master/slave self-joined on `search_hash`) even on `OPTIMIZER:`-titled cards — several low-cost carriers (e.g. Flair / F8) do not surface in `optimizer_candidates` the same way, and optimizer-side queries silently return zero. See [`../bookability_analysis/SKILL.md#multi-ticket-pair-audits`](../bookability_analysis/SKILL.md#multi-ticket-pair-audits). Treat it as the default starting point for these TODOs.

**Aggregation / example queries on a card are CTEs (mandatory).** Apply the **Query structure — always debuggable** rule:

- MySQL / ClickHouse: `WITH <slice_name> AS (SELECT … WHERE …) SELECT …`. The outer `SELECT` is the aggregate or an example row listing (`ORDER BY … LIMIT N`). Put the counterpart as a commented-out `SELECT` from the same CTE so readers can swap it in.
- Mongo: the pipeline starts with an explicit `$match` stage encoding the slice once (context, date bounds, payload regex — `Response` on `debug_logs`, `errors` on `optimizer_logs`). The rest branches between aggregation (`$group` with `$sum` / `$addToSet` etc.) and one of the two canonical permalink output shapes: **Shape B** — `$sort: { date_added: -1 }` → `$project: { _id: 0, link: … }` → `$group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } }` → `$project: { _id: 0, count: 1, links: 1 }` (single doc with a flat `links[]`, default for cards — one scroll of pasteable permalinks, no per-row sub-objects to expand); or **Shape A** — `$project` with context columns → `$sort: { date_added: -1 }` (N docs, one per match; useful for per-row columns, per-row filtering in Compass, or a `.forEach` loop in mongosh). Pick one per block. Must paste directly into Compass's Aggregation tab — `ISODate("…")` for date bounds, unquoted field names.
- Never ship two separately-filtered queries (one for counts, one for examples) on a card — reviewers cannot trust they describe the same slice.

## AI agent footer (required)

Append as the last lines of every description the agent writes (new or updated). No text after it:

```markdown
---

_Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
```

## What not to do

- Do not create new cards outside Backlog unless the user explicitly asks.
- Do not skip the deduplication pass before creating a card.
- Do not ship a card (new or updated) without Filipp (delivery manager) as a member.
- Do not invent booking IDs, hashes, or log URLs.
- Do not trim real `IN (...)` hash lists, SQL filters, or Mongo bounds inside Numbers/ Examples just to shorten the card — those lists are often the reproducible slice.
- Do not omit `⊙ **Numbers/ quantity/ Examples:**` when there are examples, queries, or patterns.
- Do not bury related-card context in a long standalone section; use one or two bullets under Numbers/ Examples unless the user asks for more.
- Do not omit `⊙ **Summary**` or replace it with only the card title.
- Do not write a jargon-heavy Summary (long technical sentences, stacked acronyms, supplier payload walkthroughs). Put that under Numbers/ Examples with permalinks and queries.
- Do not pad Numbers/ Examples with long Scale preambles, correlation essays, histograms, or extra mongosh tips when Scale + some examples + mongo_query: already reproduces the issue. Add those only when they change decisions.
- Do not add post-query runbook prose after `mongo_query:` (e.g. "Scope (counts):", "reuse the same `$match`", "append `{ $count: … }`", "distinct transactions", "adjust `date_added`"). Put measured numbers in Scale instead; counting mechanics stay in skills, not on Trello.
- Do not edit an existing card the user pointed to as a reference-only example unless they explicitly ask.
- Do not add extra description sections (`Describe the situation`, `What investigation was done`, `How to reproduce`, `Documentation`, `QA`, `Solution`, `## Summary` blocks, optimization-only multi-`⊙` layouts). Fold everything into the two allowed sections.
- Do not expand a narrow TODO or direct request (e.g. "write a query", "add the hashes", "paste the permalink") into a multi-section verification essay. Deliver the artefact asked for. See [Responding to TODOs / direct requests on an existing card](#responding-to-todos--direct-requests-on-an-existing-card).
- Do not write aggregation or example queries without a CTE (MySQL / ClickHouse) or without a leading `$match` stage (Mongo). The slice must live in one named place so the query is debuggable and the outer statement can be swapped between count and examples without re-validating the filter.
