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
  dedup before creating, an approval gate that shows every card write in chat
  for sign-off before sending, card title and the H3 `⊙` description template
  (mandatory Short description / Details / Visibility; optional Possible
  solution / Credentials / QA notes / Similar-relevant cards; debuggable CTE /
  Shape A/B Mongo pipelines), mandatory Filipp-as-member and AI footer rules,
  weekly grooming roll-up, and the one-card → one-branch → one-PR lifecycle.
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

## Approval gate (every card write)

Before any Trello write — create, update, move, label, member change, comment, archive — **show the full proposed change in the chat and wait for the user's explicit approval.** Only call the write tool after they say go.

- **New card:** post the title + the full description body (the exact markdown you would send) in the chat. Then wait.
- **Update:** name the card and show what changes — the new or edited section text, the label / member / list change. For a body rewrite, show the full new body. Then wait.
- **Comment / archive:** show the comment text, or state what you are archiving and why. Then wait.
- Read-only steps (dedup search, `get_board_members`, fetching a card) need no approval — run them first so the proposal is complete.
- Approval is per change. A new instruction is a new change; re-propose and wait again. Do not batch several writes behind one approval unless the user approved the batch.

## MCP workflow (minimal)

1. `set_active_board` with `61d5cf784c6396541499e7ce`.
2. **New card:** run the dedup pass per [`references/dedup.md`](references/dedup.md). Only if not duplicate: draft the body (the three mandatory `⊙` sections — `Short description` + `Details` + `Visibility` — plus any applicable optional sections + AI footer; template in [`references/card_anatomy.md`](references/card_anatomy.md)), **show it for approval (see Approval gate)**, then on approval `add_card_to_list` on Backlog with `name` per the title rule, optional `labels`, **`idMembers` includes Filipp**.
3. **Edits:** draft the change, **show it for approval**, then `update_card_details` / `move_card` / checklist tools. Refresh the body to match current scope. Migrate legacy cards (`⊙ **Summary**` / `⊙ **Numbers/ quantity/ Examples:**`, or bare-`⊙` non-H3 headings) to the current layout unless the user asks to keep the old shape.
4. **Layout references:** [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) (lean lead + evidence), [#2746](https://trello.com/c/Nfg1JVNy) (trend / breakdown table).

## Card-description sections (3 mandatory + 4 optional)

Headings are **H3 with the `⊙` marker** (`### ⊙ **Short description**`). **No blank line after a heading** — content sits directly under it; **one blank line after each section's content** separates the sections. **Plain, ESL-friendly language** — short common words, one idea per sentence ("sometimes" not "intermittently", "in some cases" not "on a share of attempts", "real users on the front end are not affected" not "does not surface on the storefront flow"). Each section does one job; keep content in its own section. Full templates, Mongo shapes, formatting, plain-language table, and glossary rules in [`references/card_anatomy.md`](references/card_anatomy.md).

**Section order (mandatory + optional interleaved):**

1. **`### ⊙ Short description`** *(mandatory)* — one sentence: what fails + where, plain language. The triage TL;DR. No stacked acronyms, no counts.
2. **`### ⊙ Details`** *(mandatory)* — the flow explained end to end, why it breaks, the hypothesis. Debug-log permalinks embedded **inline at the step they prove** (one URL per line). All narrative lives here. **What changed, not how to fix it.** No code paths, no line ranges, no class / method / DTO names in the prose. No "things we still need to figure out" sub-lists — open questions either fold into Possible solution as one line, or stay out of the card.
3. **`### ⊙ Possible solution / expected behavior`** *(optional, when known)* — what should happen instead, in one or two short sentences. State the outcome, not the implementation. **No numbered developer to-do lists** ("1. verify X, 2. add handling for Y, 3. keep error branch"); leave the implementation to the dev. If the upstream change is already live on a staging / sandbox / test environment, name that environment in one line so the dev knows where to test, and attach any supplier confirmation (Slack screenshot, email) as a card attachment.
4. **`### ⊙ Visibility`** *(mandatory)* — how we track it: one debuggable query (Mongo leading `$match` / MySQL CTE) + the measured count + window when known (omit the count line if not measured — never fabricate). *OR* a fenced breakdown table — never both. Scale lives here only.
5. **`### ⊙ Credentials / access`** *(optional — new-integration cards only)* — labeled placeholder the card owner fills by hand. Not on bug / error cards — put any access note in Details there. The agent never fabricates office codes / PCCs / logins.
6. **`### ⊙ QA notes`** *(optional)* — only when there is a shipped fix to verify; omit by default. Staging repro + post-deploy signal, observable by a human or a log query.
7. **`### ⊙ Similar / relevant cards`** *(optional)* — cards that **directly inform** this one (same code path, same supplier behavior, same root cause, or known overlap of fix). One `[title](shortUrl) — short note on the overlap` per line. Drop neighbouring-area cards that only share the supplier. Omit when nothing relevant.

**Glossary:** use [`GLOSSARY.md`](../../../GLOSSARY.md) terms — "ResPro page" (never "Voyages a la carte ResPro"), "the user" / "the agent", "search results page", "content source". No class / method / file-path names in prose.

**Footer (mandatory):** AI attribution block as the last lines, after a `---` rule. No text after it.

## Mandatory rules (no card ships without these)

1. **Title** — `SOURCE_OR_AREA: short concrete summary`, source prefix ALL CAPS. Short — one concrete clause (≤ ~10 words after the prefix), no trailing qualifiers. `(Investigation Pending)` prefix when there is no fix yet. Details in [`references/card_anatomy.md`](references/card_anatomy.md#title).
2. **Three mandatory `⊙` sections** — `### ⊙ **Short description**` + `### ⊙ **Details**` + `### ⊙ **Visibility**`, as H3 headings with a blank line after each. **Order:** Short → Details → (optional Possible solution / expected behavior, when present) → Visibility → remaining optional sections. Optional sections (`Possible solution / expected behavior`, `Credentials / access`, `QA notes`, `Similar / relevant cards`) only when they apply — never empty stubs. No other `⊙` blocks; fold extra investigation / repro prose into Details. Migrate legacy cards on edit unless told otherwise.
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

- Do not call any Trello write tool (`add_card_to_list`, `update_card_details`, `move_card`, `add_comment`, checklist / label / member tools, `archive_card`) before showing the proposed change in the chat and getting the user's explicit approval. See [Approval gate](#approval-gate-every-card-write).
- Do not batch several card writes behind one approval unless the user approved the batch; a new instruction needs a fresh proposal.
- Do not create new cards outside Backlog unless the user explicitly asks.
- Do not skip the dedup pass before creating a card.
- Do not ship a card (new or updated) without Filipp (delivery manager) as a member.
- Do not invent booking IDs, hashes, or log URLs.
- Do not add a `⊙ **Credentials / access**` section to a bug / error card — it is for new-integration cards only. When present, never fabricate a value; write placeholder prompt lines and let the card owner fill office codes, PCCs, and logins by hand.
- Do not include optional sections (`Possible solution / expected behavior`, `Credentials / access`, `QA notes`, `Similar / relevant cards`) as empty stubs. Omit a section that has nothing real to say. The three mandatory sections always ship.
- Do not draft `⊙ **QA notes**` speculatively — include it only when there is a shipped fix to verify.
- Do not use bare `⊙ **…**` lines, `## `, or H1/H2 for section headings. Section headings are H3: `### ⊙ **…**` with the content directly under each heading (**no blank line after the heading**) and **one blank line after each section** to separate them.
- Do not use heavy or formal words a non-native reader would trip on. Write plainly ("sometimes", "in some cases", "real users are not affected") — see the plain-language table in [`references/card_anatomy.md`](references/card_anatomy.md). Error codes and supplier names stay as-is.
- Do not write "Voyages a la carte ResPro" or other off-glossary terms; use [`GLOSSARY.md`](../../../GLOSSARY.md) wording ("ResPro page", "the user" / "the agent", "search results page", "content source").
- Do not write a long title with trailing qualifiers — keep it one concrete clause after the ALL-CAPS prefix. Supplier operation names (`VerifyPrice`, `BookFlight`, `OrderCreate`, `PNR_AddMultiElements`, etc.) are allowed in the title when they anchor the card better than a plain-language paraphrase — the body still stays plain.
- Do not prescribe implementation steps to developers on a card. Cards say **what should change**, not **how to ship it**. No numbered "1. verify X, 2. add handling for Y, 3. keep the error branch" lists in `Possible solution / expected behavior`. One or two short sentences stating the outcome is enough.
- Do not paste code paths, file names, or line ranges (`Dida.php:305`, `AbstractResponse.php:25-40`, `src/Supplier/Foo/Bar.php`) in Details or any other prose section. Code citations belong in the PR description / commit message, not on the card. Reference the behavior (the debug log, the supplier operation, the user-visible symptom) instead.
- Do not include "things we still need to figure out" sub-lists in Details ("Two things still need our attention: 1) confirm X end to end, 2) handle Y"). Open questions either collapse into a one-liner in `Possible solution / expected behavior`, or stay in the chat — not on the card.
- Do not trim real `IN (...)` hash lists, SQL filters, or Mongo bounds inside Visibility / Details just to shorten the card — those lists are often the reproducible slice.
- Do not put scale / counts anywhere but Visibility. Short description and Details state no numbers.
- Do not dump debug-log permalinks in a trailing block — embed them inline in Details at the step each one proves.
- Do not write a jargon-heavy Short description (long technical sentences, stacked acronyms, supplier payload walkthroughs). One sentence; proof goes to Details.
- Do not pad any section with correlation essays, histograms, or extra mongosh tips when the query + count already reproduce the issue.
- Do not duplicate a breakdown table's totals in a prose count line above it. When a per-day / per-bucket fenced text table is present, the table IS the count.
- Do not append row-metadata parentheticals (`gds=`, `cancel_reason=`, `booking_date=`, task IDs, …) after a ResPro / Trello / other smartCard-rendered URL.
- Do not add post-query runbook prose after a query ("Scope (counts):", "reuse the same `$match`", "append `{ $count: … }`"). Put measured numbers in Visibility instead; counting mechanics stay in skills, not on Trello.
- Do not edit an existing card the user pointed to as a reference-only example unless they explicitly ask.
- Do not add `⊙` sections beyond the six defined (`Describe the situation`, `What investigation was done`, `How to reproduce`, `Documentation`, `## Summary` blocks). Fold extra prose into Details.
- Do not expand a narrow TODO or direct request into a multi-section verification essay. See [`references/todo_responses.md`](references/todo_responses.md).
- Do not write aggregation or example queries without a CTE (MySQL / ClickHouse) or without a leading `$match` stage (Mongo).

## References

- [`references/card_anatomy.md`](references/card_anatomy.md) — title, the 3 mandatory + 4 optional `⊙` sections, H3 / blank-line formatting, glossary terms, Shape A vs B Mongo pipelines, debuggable-CTE rule, smartCard URL rules.
- [`references/dedup.md`](references/dedup.md) — pre-create dedup pass + `filter_cards.py`.
- [`references/grooming.md`](references/grooming.md) — weekly developer-centric in-flight report.
- [`references/todo_responses.md`](references/todo_responses.md) — narrow TODO / direct-request scope rules.
- [`automation_cards.md`](automation_cards.md) — Automation-board template (different board).
- [`roles.md`](roles.md) — developer / QA / analyst mapping for ownership suggestions.
- Scripts: [`scripts/filter_cards.py`](scripts/filter_cards.py), [`scripts/grooming_report.py`](scripts/grooming_report.py), [`scripts/mcp_trello.sh`](scripts/mcp_trello.sh).
