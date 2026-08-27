---
name: trello-content-integration
description: >-
  Use when creating or updating a Trello card on the Content Integration board —
  filing a backlog item, logging a bug, drafting a card for a content-source /
  GDS / bookability / optimizer / payhub issue, posting a comment, splitting a
  fat card into sibling cards, or working a card the user pointed at with a
  `/c/<shortLink>` URL. Use for Automation-board cards too (short human-written
  intake) — different board, lighter template. Covers investigation before
  create, splitting one shippable outcome per card (per-supplier when each
  supplier needs its own change), grouping siblings with the Project custom
  field plus Similar/relevant links (no parent cards), dedup before creating,
  an approval gate that shows every card write in chat for sign-off before
  sending, card title and the H3 `⊙` description template (mandatory Short
  description / Details / Visibility / Definition of Done; optional Possible
  solution / Credentials / QA notes / Similar-relevant cards; debuggable CTE /
  Shape A/B Mongo pipelines), mandatory members (Filipp + QA team Maryna and
  Alexander) and AI footer rules.
---

# Trello: Content Integration board

Use the **user-trello** MCP server. Before each tool call, read that tool's JSON schema under `mcps/user-trello/tools/`. Prefer `set_active_board` once per session, then omit `boardId` where the API allows.

## When to use vs when not to

| Want to | Read |
|---|---|
| Create a Content Integration card | this file + [`references/dedup.md`](references/dedup.md) + [`references/card_anatomy.md`](references/card_anatomy.md) + [`references/split_and_group.md`](references/split_and_group.md) |
| Split a fat request / group sibling cards | [`references/split_and_group.md`](references/split_and_group.md) |
| Update an existing Content Integration card | this file + [`references/card_anatomy.md`](references/card_anatomy.md) |
| Respond to a TODO on a card | [`references/todo_responses.md`](references/todo_responses.md) |
| File an Automation-board card | [`automation_cards.md`](automation_cards.md) — different board, different template, **none of this file's rules apply** |
| Pick an owner / reviewer / `@mention` | [`roles.md`](roles.md) |

## Board and list (fixed)

| Item | ID |
|------|-----|
| Board **Content Integration** | `61d5cf784c6396541499e7ce` |
| List **Backlog** | `6509c593087340dfdd332b0a` |

**New cards:** always `add_card_to_list` on Backlog. Never place new agent-created cards in TODO, In Progress, or any other list unless the user explicitly overrides.

**Updates:** `update_card_details`, `move_card`, checklists, labels, comments. Keep the card on its current list unless the user asks to move it.

**Archiving:** `archive_card`. Add a descriptive comment first (e.g. "Project stopped", "Duplicate of X") before archiving.

## Approval gate (every card write)

Before any Trello write — create, update, move, label, member change, comment, archive, custom-field change, or a new Project option — **show the full proposed change in the chat and wait for the user's explicit approval.** Only call the write tool after they say go.

- **New card:** post the title + the full description body (the exact markdown you would send) in the chat. Then wait.
- **Split (N sibling cards):** one proposal. Show the Project option (reuse vs new name) plus every sibling title and full body. Then wait. That approval covers the option create, the N cards, Project values, and the later Similar/relevant backfill. See [`references/split_and_group.md`](references/split_and_group.md).
- **Update:** name the card and show what changes — the new or edited section text, the label / member / list change. For a body rewrite, show the full new body. Then wait.
- **Comment / archive:** show the comment text, or state what you are archiving and why. Then wait.
- Read-only steps (dedup search, `get_board_members`, fetching a card, `get_board_custom_fields`) need no approval — run them first so the proposal is complete.
- Approval is per change. A new instruction is a new change; re-propose and wait again. Do not batch several unrelated writes behind one approval. A proposed split is one change.

## Investigation before create

Do not file a Content Integration card until investigation in this session has produced: a known shippable outcome, a known split, real Definition of Done lines, and a Visibility query that shows the wrong behaviour. Investigation is not a Trello card. Full bar, split rules, and Project grouping: [`references/split_and_group.md`](references/split_and_group.md).

Do not create `(Investigation Pending)` cards or `* DoD1: _TO BE DONE_`. Exception: the user says “skip investigation, file a pending card.”

## MCP workflow (minimal)

1. `set_active_board` with `61d5cf784c6396541499e7ce`.
2. **New card:** meet the investigation bar. Decide the split per [`references/split_and_group.md`](references/split_and_group.md). Run the dedup pass per [`references/dedup.md`](references/dedup.md). Only if not duplicate: draft the body (the four mandatory `⊙` sections — `Short description` + `Details` + `Visibility` + `Definition of Done` — plus any applicable optional sections + AI footer; template in [`references/card_anatomy.md`](references/card_anatomy.md)), **show it for approval (see Approval gate)**. On a split, one proposal lists every sibling plus the Project option. On approval: `add_card_to_list` on Backlog with `name` per the title rule and optional `labels` (label IDs array). **`add_card_to_list` does not accept members** — immediately after creation, call `assign_member_to_card` once per member: Filipp (delivery manager) first, then the two QA team members, Maryna and Alexander (Alex). Then set Project and backfill Similar/relevant per [`references/split_and_group.md`](references/split_and_group.md).
3. **Edits:** draft the change, **show it for approval**, then `update_card_details` / `move_card` / checklist tools. Do not use checklist tools on the native checklists named **QA Strategy** or **Post Deployment tracking** — `qa_strategy` owns those. `update_card_details` accepts `labels` but **not** members — use `assign_member_to_card` / `remove_member_from_card` for membership changes. Refresh the body to match current scope. Migrate legacy cards (`⊙ **Summary**` / `⊙ **Numbers/ quantity/ Examples:**`, or bare-`⊙` non-H3 headings) to the current layout unless the user asks to keep the old shape.
4. **Schema check before any write.** If a write tool returns an empty `idLabels` / `idMembers` array, or silently drops a parameter you passed, the parameter name was wrong for that tool. Read the JSON schema under `mcps/project-0-agents_setup-trello/tools/<tool>.json` and retry with the correct shape — do **not** keep retrying the same call hoping the field name works this time.
5. **Layout references:** [#2679](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) (lean lead + evidence), [#2746](https://trello.com/c/Nfg1JVNy) (trend / breakdown table).

## Card-description sections (4 mandatory + 4 optional)

Headings are **H3 with the `⊙` marker** (`### ⊙ **Short description**`). Content sits directly under each heading, except **QA Strategy** and **Post Deployment tracking**, which keep one blank line after the heading. On edit, do not close that gap. **One blank line after each section's content** separates the sections. **Plain, ESL-friendly language** — short common words, one idea per sentence ("sometimes" not "intermittently", "in some cases" not "on a share of attempts", "real users on the front end are not affected" not "does not surface on the storefront flow"). Each section does one job; keep content in its own section. Full templates, Mongo shapes, formatting, plain-language table, and glossary rules in [`references/card_anatomy.md`](references/card_anatomy.md).

**Section order (mandatory + optional interleaved):**

1. **`### ⊙ Short description`** *(mandatory)* — one sentence: what fails + where, plain language. The triage TL;DR. No stacked acronyms, no counts.
2. **`### ⊙ Details`** *(mandatory)* — the flow explained end to end, why it breaks, the hypothesis. Debug-log permalinks embedded **inline at the step they prove** (one URL per line). All narrative lives here. **What changed, not how to fix it.** No code paths, no line ranges, no class / method / DTO names of *our* code in the prose; **supplier API operation names (`OfferPrice`, `PriceUpsellWithoutPNR`, `VerifyPrice`, `BookFlight`, `OrderCreate`, …) are allowed inline** when they anchor the specific call site. No "things we still need to figure out" sub-lists — open questions either fold into Possible solution as one line, or stay out of the card.
3. **`### ⊙ Possible solution / expected behavior`** *(optional, when known)* — what should happen instead, in one or two short sentences. State the outcome, not the implementation. **No numbered developer to-do lists** ("1. verify X, 2. add handling for Y, 3. keep error branch"); leave the implementation to the dev. If the upstream change is already live on a staging / sandbox / test environment, name that environment in one line so the dev knows where to test, and attach any supplier confirmation (Slack screenshot, email) as a card attachment.
4. **`### ⊙ Visibility`** *(mandatory)* — how we track it: one debuggable query (Mongo leading `$match` / MySQL CTE) + the measured count + window when known (omit the count line if not measured — never fabricate). *OR* a fenced breakdown table — never both. Scale lives here only.
5. **`### ⊙ Definition of Done`** *(mandatory, always present)* — numbered outcome items that define "done" for this card. **Write the items yourself as plain outcome statements** — each item is a done-state stated as a fact ("The ResPro page shows a Unififi order link for Unififi bookings."), derived from the card's expected behavior. One asterisk bullet per outcome: `* DoD1: <text>`. No `- [ ]` checkbox. Keep it short (one to three items), happy path first, then any regression guard. More than three items means split — see [`references/split_and_group.md`](references/split_and_group.md). Do not write `* DoD1: _TO BE DONE_` except when the user explicitly skipped investigation. A prose paragraph is not allowed.
6. **`### ⊙ **QA Strategy**`** *(preserve-only — never create)* — written by the `qa_strategy` skill after Definition of Done. On edit, leave the section body as-is except when the user asked to change it. Keep one blank line after the heading. Do not draft it when filing a card. Also leave the native Trello checklist named **QA Strategy** alone — do not create, rename, tick, add, or delete its items.
7. **`### ⊙ **Post Deployment tracking**`** *(preserve-only — never create)* — written by `qa_strategy`. Same preserve rule and heading gap. Same rule for the native checklist named **Post Deployment tracking**.
8. **`### ⊙ Credentials / access`** *(optional — new-integration cards only)* — labeled placeholder the card owner fills by hand. Not on bug / error cards — put any access note in Details there. The agent never fabricates office codes / PCCs / logins.
9. **`### ⊙ QA notes`** *(optional)* — only when there is a shipped fix to verify; omit by default. Staging repro + post-deploy signal, observable by a human or a log query.
10. **`### ⊙ Similar / relevant cards`** *(optional on a lone card; **mandatory on every sibling**)* — cards that **directly inform** this one (same code path, same supplier behavior, same root cause, or known overlap of fix), **plus every sibling** from a split. One `[title](shortUrl) — short note on the overlap` per line. Sibling note: `same change, different supplier` or `same program, different outcome`. Drop neighbouring-area cards that only share the supplier. Omit on a lone card when nothing relevant.

These two sit after Definition of Done on a card that already has them. When this skill rewrites `desc`, splice them back after DoD, before Credentials / QA notes / Similar, matching whatever order `qa_strategy` last wrote (QA Strategy then Post Deployment tracking). Native checklists named **QA Strategy** and **Post Deployment tracking** stay on the card; do not copy their items into `desc`, do not delete them, and do not add a "tick the checklist" line.

**Glossary:** use [`GLOSSARY.md`](../../../GLOSSARY.md) terms — "ResPro page" (never "Voyages a la carte ResPro"), "the user" / "the agent", "search results page", "content source". No class / method / file-path names of *our* code in prose; supplier API operation names are allowed inline when they anchor the specific call site.

**Footer (mandatory):** AI attribution block as the last lines, after a `---` rule. No text after it.

## Mandatory rules (no card ships without these)

1. **Title** — `SOURCE_OR_AREA: short concrete summary`, source prefix ALL CAPS. Short — one concrete clause (≤ ~10 words after the prefix), no trailing qualifiers. Do not prefix `(Investigation Pending)` on agent-created cards unless the user skipped investigation. On a sibling set, align the clause after the colon across suppliers. Details in [`references/card_anatomy.md`](references/card_anatomy.md#title) and [`references/split_and_group.md`](references/split_and_group.md).
2. **Four mandatory `⊙` sections** — `### ⊙ **Short description**` + `### ⊙ **Details**` + `### ⊙ **Visibility**` + `### ⊙ **Definition of Done**`, as H3 headings with content directly below. **Order:** Short → Details → (optional Possible solution / expected behavior, when present) → Visibility → Definition of Done → preserve-only QA Strategy → preserve-only Post Deployment tracking → remaining optional sections. `Definition of Done` always ships — write real items as `* DoD1: <text>` bullets (each a done-state stated as a fact) derived from the card's expected behavior. Do not write `* DoD1: _TO BE DONE_` except when the user skipped investigation. Do not write `- [ ]` on those lines. Optional sections (`Possible solution / expected behavior`, `Credentials / access`, `QA notes`, `Similar / relevant cards`) only when they apply — never empty stubs. `Similar / relevant cards` is mandatory on siblings. No other `⊙` blocks except the two preserve-only sections `### ⊙ **QA Strategy**` and `### ⊙ **Post Deployment tracking**` (written by `qa_strategy`, never by this skill). On edit, keep those two sections in place with one blank line after each heading — do not fold them into Details, rename them, delete them, or close the heading gap. Fold any other unknown investigation / repro prose into Details. Migrate legacy cards on edit unless told otherwise. When **Definition of Done** still uses `- [ ]` / `- [x]`, bare `DoD1` lines, or `- DoD1` dashes, rewrite those lines to `* DoD1: <text>` in the same order, keeping the sentence.
3. **Filipp + QA team on every card** — every card the agent creates or updates includes Filipp (delivery manager) **and both QA team members, Maryna and Alexander (Alex)**, as members. Call `assign_member_to_card` once per member right after `add_card_to_list` on create (Filipp first, then Maryna, then Alexander), and as separate calls when updating a card any of them is not on yet. `add_card_to_list` and `update_card_details` do not accept members — never try to pass `idMembers` / `memberIds` to them. If any ID is unknown, fetch board members first (`get_board_members`) and cache for the session.
4. **AI attribution footer** — appended as the last lines, no text after.

   ```markdown
   ---

   _Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
   ```

5. **Dedup pass before create** — see [`references/dedup.md`](references/dedup.md). No exceptions. Siblings in a planned split are not duplicates of each other.
6. **Debuggable CTE / leading `$match`** — every aggregation or example query on a card has the slice in one named place so the outer statement is swappable between count and examples without re-validating the filter. Never two separately-filtered queries (one for counts, one for examples) on the same card. Full rule + Shape A/B templates in [`references/card_anatomy.md`](references/card_anatomy.md#query-structure--always-debuggable-mandatory).
7. **Split and group** — one card = one shippable outcome. Per-supplier cards only when each supplier needs its own change. Shared code stays one card. No parent cards. Group siblings with the Project custom field and Similar/relevant links. See [`references/split_and_group.md`](references/split_and_group.md).

## Labels and Project

After `get_board_labels` for this board, map the user's intent to existing **type** names:

- **Bugs & Fixes** — defects, regressions, wrong fees, errors.
- **Optimization** — optimizer, routing, contestant eligibility, flow performance.
- **New Integration** — new source or major integration slice.
- **Injection** — injection-related work.
- **Investigation / Assesment** — only when the user skipped investigation and asked for a pending card. Do not put this label on a card that already has a known outcome.

Pass the label IDs to `add_card_to_list` / `update_card_details`. Do not invent label names. Do not use a new label as the sibling group key.

**Sibling group key is the Project custom field**, not a label. Fetch with `get_board_custom_fields`. Reuse an existing option when it covers the whole sibling set. Add a new option (shared-outcome name, no supplier prefix) only when none fits, via [`scripts/add_project_option.py`](scripts/add_project_option.py) after approval. Lone cards leave Project empty. Do not create a parent card. Mechanics in [`references/split_and_group.md`](references/split_and_group.md).

## What not to do

- Do not call any Trello write tool (`add_card_to_list`, `update_card_details`, `move_card`, `add_comment`, checklist / label / member tools, `archive_card`, `update_card_custom_field`) before showing the proposed change in the chat and getting the user's explicit approval. See [Approval gate](#approval-gate-every-card-write).
- Do not batch several unrelated card writes behind one approval; a new instruction needs a fresh proposal. A sibling split is one proposal.
- Do not create a parent / epic / tracker card on Content Integration. Do not add a `Child cards` checklist or a parent attachment to group work.
- Do not file a card before the investigation bar is met (known outcome, known split, real DoD, Visibility that shows the bug), unless the user skipped investigation.
- Do not create `(Investigation Pending)` cards or `* DoD1: _TO BE DONE_` unless the user skipped investigation.
- Do not silently file one fat card when more than one shippable outcome exists, or when each supplier needs its own change. Propose the split.
- Do not split shared code that several suppliers use into per-supplier cards.
- Do not split an existing board card unless the user asked to split it.
- Do not add a new Project option for a lone card, or when an existing option covers the sibling set. Do not name a new option after one supplier.
- Do not invent label names to group siblings.
- Do not create new cards outside Backlog unless the user explicitly asks.
- Do not skip the dedup pass before creating a card.
- Do not ship a card (new or updated) without Filipp (delivery manager) and both QA team members, Maryna and Alexander (Alex), as members.
- Do not invent booking IDs, hashes, or log URLs.
- Do not add a `⊙ **Credentials / access**` section to a bug / error card — it is for new-integration cards only. When present, never fabricate a value; write placeholder prompt lines and let the card owner fill office codes, PCCs, and logins by hand.
- Do not include optional sections (`Possible solution / expected behavior`, `Credentials / access`, `QA notes`, `Similar / relevant cards`) as empty stubs. Omit a section that has nothing real to say. The four mandatory sections always ship — write `Definition of Done` yourself as `* DoD1: <text>` bullets (done-states stated as facts). Do not write `* DoD1: _TO BE DONE_` except when the user skipped investigation. `Similar / relevant cards` is mandatory on siblings.
- Do not write `- [ ]` or `- [x]` under **Definition of Done**. Each item is `* DoD1: <text>`. Ticks belong on the native **QA Strategy** / **Post Deployment tracking** checklists that `qa_strategy` publishes, not here.
- Do not draft `⊙ **QA notes**` speculatively — include it only when there is a shipped fix to verify.
- Do not draft `⊙ **QA Strategy**` or `⊙ **Post Deployment tracking**` when filing a card. Those sections and the native checklists with those names come from `qa_strategy` after approval. On edit, do not delete the sections or those two checklists. Do not add, tick, or rewrite their items.
- Do not use bare `⊙ **…**` lines, `## `, or H1/H2 for section headings. Section headings are H3: `### ⊙ **…**` with the content directly under each heading and one blank line after each section. **QA Strategy** and **Post Deployment tracking** are the exceptions: keep one blank line after each of those headings, and do not close the gap on edit.
- Do not use heavy or formal words a non-native reader would trip on. Write plainly ("sometimes", "in some cases", "real users are not affected") — see the plain-language table in [`references/card_anatomy.md`](references/card_anatomy.md). Error codes and supplier names stay as-is.
- Do not write "Voyages a la carte ResPro" or other off-glossary terms; use [`GLOSSARY.md`](../../../GLOSSARY.md) wording ("ResPro page", "the user" / "the agent", "search results page", "content source").
- Do not write a long title with trailing qualifiers — keep it one concrete clause after the ALL-CAPS prefix. Supplier operation names (`VerifyPrice`, `BookFlight`, `OrderCreate`, `PNR_AddMultiElements`, etc.) are allowed in the title when they anchor the card better than a plain-language paraphrase — the body still stays plain.
- Do not prescribe implementation steps to developers on a card. Cards say **what should change**, not **how to ship it**. No numbered "1. verify X, 2. add handling for Y, 3. keep the error branch" lists in `Possible solution / expected behavior`. One or two short sentences stating the outcome is enough.
- Do not paste code paths, file names, or line ranges (`Dida.php:305`, `AbstractResponse.php:25-40`, `src/Supplier/Foo/Bar.php`) in Details or any other prose section. Code citations belong in the PR description / commit message, not on the card. Reference the behavior (the debug log, the supplier operation, the user-visible symptom) instead. Supplier API operation names (`OfferPrice`, `VerifyPrice`, `BookFlight`, …) are not code citations — they are the call sites we are describing — and are allowed inline.
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
- Do not ship a Visibility query that only enumerates the area ("all logs from supplier X in the last N minutes") without surfacing the wrong behaviour. The query must produce rows that demonstrate the bug — mismatched cabins, the supplier error in question, the missing `-` sign, etc. Discovery dumps belong in the chat, not on the card.
- Do not use pipe / markdown tables (`| col | col |` with a `|---|---|` separator) in card descriptions — Trello renders them as raw text. For tabular numbers, use a fenced text table (monospaced block, aligned with spaces). See the worked example in [`references/card_anatomy.md`](references/card_anatomy.md#-visibility-mandatory).

## References

- [`references/card_anatomy.md`](references/card_anatomy.md) — title, the 4 mandatory + 4 optional `⊙` sections, H3 / blank-line formatting, glossary terms, Shape A vs B Mongo pipelines, debuggable-CTE rule, smartCard URL rules.
- [`references/dedup.md`](references/dedup.md) — pre-create dedup pass + `filter_cards.py`.
- [`references/split_and_group.md`](references/split_and_group.md) — investigation before create, when to split, Project field, sibling cross-links, no parent cards.
- [`references/todo_responses.md`](references/todo_responses.md) — narrow TODO / direct-request scope rules.
- [`automation_cards.md`](automation_cards.md) — Automation-board template (different board).
- [`roles.md`](roles.md) — developer / QA / analyst mapping for ownership suggestions.
- Scripts: [`scripts/filter_cards.py`](scripts/filter_cards.py), [`scripts/add_project_option.py`](scripts/add_project_option.py), [`scripts/mcp_trello.sh`](scripts/mcp_trello.sh).
