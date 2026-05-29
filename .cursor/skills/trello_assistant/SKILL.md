---
name: trello-content-integration
description: >-
  Use when creating or updating a Trello card on the Content Integration board —
  filing a backlog item, logging a bug, drafting a card for a content-source /
  GDS / bookability / optimizer / payhub issue, posting a comment, or working a
  card the user pointed at with a `/c/<shortLink>` URL. Also use when the user
  asks to "prep grooming", "produce a grooming report", "what does <dev> have
  in flight", "what's in flight", "stale cards", or any developer-centric
  in-flight roll-up across Ready for Dev / In Progress / Blocked / Staging /
  Fixes needed / Ready for Deployment. Use for Automation-board cards too
  (short human-written intake) — different board, lighter template. Covers
  dedup before creating, card title and two-section description templates
  (Summary + Numbers/Examples with debuggable CTE / Shape A/B Mongo pipelines),
  mandatory Filipp-as-member and AI footer rules, weekly grooming roll-up, and
  the one-card → one-branch → one-PR lifecycle.
---

# Trello: Content Integration board

Use the **user-trello** MCP server. Before each tool call, read that tool's JSON schema under `mcps/user-trello/tools/`. Prefer `set_active_board` once per session, then omit `boardId` where the API allows.

## When to use vs when not to

| Want to | Read |
|---|---|
| Create a Content Integration card | this file + [`references/dedup.md`](references/dedup.md) + [`references/card_anatomy.md`](references/card_anatomy.md) |
| Update an existing Content Integration card | this file + [`references/card_anatomy.md`](references/card_anatomy.md) |
| Respond to a TODO on a card | [`references/todo_responses.md`](references/todo_responses.md) |
| Run the weekly grooming report | [`references/grooming.md`](references/grooming.md) |
| File an Automation-board card | [`automation_cards.md`](automation_cards.md) — different board, different template, **none of this file's rules apply** |
| Pick an owner / reviewer / `@mention` | [`roles.md`](roles.md) |

## Board and list (fixed)

| Item | ID |
|------|-----|
| Board **Content Integration** | `61d5cf784c6396541499e7ce` |
| List **Backlog** | `6509c593087340dfdd332b0a` |

**New cards:** always `add_card_to_list` on Backlog. Never place new agent-created cards in Ready for Dev, In Progress, or any other list unless the user explicitly overrides.

**Updates:** `update_card_details`, `move_card`, checklists, labels, comments. Keep the card on its current list unless the user asks to move it.

**Archiving:** `archive_card`. Add a descriptive comment first (e.g. "Project stopped", "Duplicate of X") before archiving.

## MCP workflow (minimal)

1. `set_active_board` with `61d5cf784c6396541499e7ce`.
2. **New card:** run the dedup pass per [`references/dedup.md`](references/dedup.md). Only if not duplicate: `add_card_to_list` on Backlog with `name` per the title rule, `description` = `⊙ **Summary**` + `⊙ **Numbers/ quantity/ Examples:**` + AI footer (template in [`references/card_anatomy.md`](references/card_anatomy.md)), optional `labels`, **`idMembers` includes Filipp**.
3. **Edits:** `update_card_details` / `move_card` / checklist tools. Preserve the card's existing first-section heading (older cards use `⊙ **Describe the situation in detail**:`; do not rename on edits). Refresh the body to match current scope.
4. **Layout references:** [#2676](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error) (field layout), [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) (lean Summary + Numbers), [#2677](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors) (multi-signature), [#2746](https://trello.com/c/Nfg1JVNy) (trend / breakdown table).

## Card-description areas (mental checklist before drafting)

Every description covers these areas across the two `⊙` sections. Full templates and Mongo shapes in [`references/card_anatomy.md`](references/card_anatomy.md).

**`⊙ Summary` — plain language, 1–3 sentences (~25–80 words):**

1. **What fails** — short clause, everyday verbs.
2. **Where** — flow / integration / supplier in plain words.
3. **Why we are tracking it** — impact, hypothesis, or trend signal.

**`⊙ Numbers/ quantity/ Examples:` — lean by default:**

4. **Scale** — one short line (how often + window + distinct `transaction_id`) *OR* a fenced **breakdown text table** (per-day / per-bucket). Never both.
5. **Evidence** — `some examples` block with full permalinks.
6. **Reproduction** — `mongo_query:` / `MySQL:` block, debuggable CTE / leading `$match`, Shape A or B chosen explicitly.
7. **Related work** — one line `[title](shortUrl)` only when dedup or scope split requires it.
8. **Optional one-liners** (each ≤ 1 line, only when they change a decision) — correlation hint, breakdown buckets, second query, regex rationale, `IN (...)` hash list verbatim.

**Footer (mandatory):**

9. AI attribution block as the last lines. No text after it.

## Mandatory rules (no card ships without these)

1. **Title** — `SOURCE_OR_AREA: Short concrete summary`, source prefix ALL CAPS. `(Investigation Pending)` prefix when there is no fix yet. Details in [`references/card_anatomy.md`](references/card_anatomy.md#title).
2. **Two `⊙` sections only** — `⊙ **Summary**` (or whatever first-section heading the card already uses) + `⊙ **Numbers/ quantity/ Examples:**`. No extra `⊙` blocks for investigation, repro, QA, solution; fold into Numbers/Examples.
3. **Filipp on every card** — every card the agent creates or updates includes Filipp (delivery manager) as a member. On create, pass his member ID in `idMembers`. On update, add him via `update_card_details` if not already a member. If his ID is unknown, fetch board members first (`get_board_members`) and cache for the session.
4. **AI attribution footer** — appended as the last lines, no text after.

   ```markdown
   ---

   _Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
   ```

5. **Dedup pass before create** — see [`references/dedup.md`](references/dedup.md). No exceptions.
6. **Debuggable CTE / leading `$match`** — every aggregation or example query on a card has the slice in one named place so the outer statement is swappable between count and examples without re-validating the filter. Never two separately-filtered queries (one for counts, one for examples) on the same card. Full rule + Shape A/B templates in [`references/card_anatomy.md`](references/card_anatomy.md#query-structure--always-debuggable-mandatory).

## Labels

After `get_board_labels` for this board, map the user's intent to existing names:

- **Bugs & Fixes** — defects, regressions, wrong fees, errors.
- **Optimization** — optimizer, routing, contestant eligibility, flow performance.
- **New Integration** — new source or major integration slice.
- **Injection** — injection-related work.
- **Investigation / Assesment** — unclear root cause, assessment-first.

Pass the label IDs to `add_card_to_list` / `update_card_details`. Do not invent label names.

## What not to do

- Do not create new cards outside Backlog unless the user explicitly asks.
- Do not skip the dedup pass before creating a card.
- Do not ship a card (new or updated) without Filipp (delivery manager) as a member.
- Do not invent booking IDs, hashes, or log URLs.
- Do not trim real `IN (...)` hash lists, SQL filters, or Mongo bounds inside Numbers/Examples just to shorten the card — those lists are often the reproducible slice.
- Do not omit `⊙ **Numbers/ quantity/ Examples:**` when there are examples, queries, or patterns.
- Do not bury related-card context in a long standalone section; use one or two bullets under Numbers/Examples.
- Do not omit the first-section heading or replace it with only the card title; preserve the heading the card already uses (`⊙ **Summary**` / `⊙ **Describe the situation in detail**:` / etc.) when editing.
- Do not write a jargon-heavy Summary (long technical sentences, stacked acronyms, supplier payload walkthroughs). Put that under Numbers/Examples with permalinks and queries.
- Do not pad Numbers/Examples with long Scale preambles, correlation essays, histograms, or extra mongosh tips when Scale + some examples + `mongo_query:` already reproduces the issue.
- Do not duplicate a breakdown table's totals in a prose `Scale - …` line above it. When a per-day / per-bucket fenced text table is present, the table IS the Scale.
- Do not append row-metadata parentheticals (`gds=`, `cancel_reason=`, `booking_date=`, task IDs, …) after a ResPro / Trello / other smartCard-rendered example URL.
- Do not add post-query runbook prose after `mongo_query:` ("Scope (counts):", "reuse the same `$match`", "append `{ $count: … }`"). Put measured numbers in Scale instead; counting mechanics stay in skills, not on Trello.
- Do not edit an existing card the user pointed to as a reference-only example unless they explicitly ask.
- Do not add extra description sections (`Describe the situation`, `What investigation was done`, `How to reproduce`, `Documentation`, `QA`, `Solution`, `## Summary` blocks, optimization-only multi-`⊙` layouts). Fold everything into the two allowed sections.
- Do not expand a narrow TODO or direct request into a multi-section verification essay. See [`references/todo_responses.md`](references/todo_responses.md).
- Do not write aggregation or example queries without a CTE (MySQL / ClickHouse) or without a leading `$match` stage (Mongo).

## References

- [`references/card_anatomy.md`](references/card_anatomy.md) — title, Summary tone, Numbers/Examples structure, Shape A vs B Mongo pipelines, debuggable-CTE rule, smartCard URL rules.
- [`references/dedup.md`](references/dedup.md) — pre-create dedup pass + `filter_cards.py`.
- [`references/grooming.md`](references/grooming.md) — weekly developer-centric in-flight report.
- [`references/todo_responses.md`](references/todo_responses.md) — narrow TODO / direct-request scope rules.
- [`automation_cards.md`](automation_cards.md) — Automation-board template (different board).
- [`roles.md`](roles.md) — developer / QA / analyst mapping for ownership suggestions.
- Scripts: [`scripts/filter_cards.py`](scripts/filter_cards.py), [`scripts/grooming_report.py`](scripts/grooming_report.py), [`scripts/mcp_trello.sh`](scripts/mcp_trello.sh).
