# QA strategy: native Trello checklists plus description

Date: 2026-08-27
Skill: `qa_strategy`
Status: approved in chat (specimen [ACNDC: fare increase on OfferPrice is logged as flight_not_available_other](https://trello.com/c/xOSiOISk))

Supersedes the **publish target** in [`2026-08-20-card-dod-qa-design.md`](2026-08-20-card-dod-qa-design.md): markdown `- [ ]` ticks and `✅❌❓` marks in `desc`. Harvest rules, short test body, **EXPECT:** (not **PASS:**), DoD# parents, nested `Test n`, `No test:`, and post-deploy query embedding from that doc still apply.

## Problem

Markdown `- [ ]` in the card description is not a real Trello checkbox. `✅❌❓` on the same line is a second, unofficial mark. QA cannot tick a test on the card front. Queries, *Why:*, and **EXPECT:** still need the description (Trello checklist items are one plain-text line).

## Decision

Split the published plan:

| Surface | Holds | Does not hold |
|---------|--------|----------------|
| Native checklist **QA Strategy** | One tickable item per test (and per extra PR check) | *Why:*, steps, queries, `No test:` |
| Native checklist **Post Deployment tracking** | One tickable item per watch | Queries, full **EXPECT:** |
| Card `desc` sections `### ⊙ **QA Strategy**` and `### ⊙ **Post Deployment tracking**` | DoD# grouping, nested tests, *Why:*, **Find a case:** / **Find the attempts:**, steps, full **EXPECT:** | Markdown `- [ ]`, `✅❌❓`, a "tick the checklist" instruction line |

Specimen: [https://trello.com/c/xOSiOISk](https://trello.com/c/xOSiOISk).

## Native item shape

Trello checklists are **flat**. One item per test, never a DoD-only row. Several tests under one DoD are sibling items that share the `DoD<n>` prefix. Tests number **per DoD parent** (`DoD1 Test 1`, `DoD1 Test 2`, then `DoD2 Test 1`).

Plain text. No markdown, no backticks, no emoji marks.

```
DoD<n> Test <k>: <short name> — EXPECT <short observable>
<short extra-check name> — EXPECT <short observable>
<short watch line> — EXPECT <short observable>
```

The short **EXPECT** is a one-line reminder. The full **EXPECT:** stays in `desc`. Prefer under ~160 characters; shorten EXPECT before dropping the `DoD<n> Test <k>:` prefix.

No native item for `No test:` (nothing to tick). No native item when a DoD parent has only `No test:`.

Create a native checklist only when it would have at least one item. Exact names: `QA Strategy`, then `Post Deployment tracking`. Do not create a duplicate by a similar name.

## Description shape

No `- [ ]`, no `- [x]`, no `✅❌❓` under **QA Strategy** or **Post Deployment tracking**. Keep one blank line after each of those headings. Do not add a line that tells QA to tick the native checklist.

```markdown
### ⊙ **QA Strategy**

- DoD1
  - Test 1: <short name>
    *Why:* <one or two sentences>
    1. Drive the checkout / booking. Note `search_id`.
    2. Open `<context>` (`_scopes` `<scope>`). Confirm Request `<field>`.
    **EXPECT:** <observable condition>
  - Test 2: <short name>
    *Why:* …
    **EXPECT:** …
- DoD2
  - No test: <reason>.
- <PR check that does not map to a DoD item>
  *Why:* …
  **EXPECT:** …

### ⊙ **Post Deployment tracking**

- <short watch line>
  **Find the attempts:**
  ```sql
  -- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
  <query>
  ```
  **EXPECT:** <observable condition>
```

## Chat preview

Show **native checklist items first**, then the card-description markdown. End with *Approve and publish?* **What changes for QA**, **Notes for QA**, and code red flags stay outside the plan block.

## Publish (on approval)

1. `GET` `desc`. Strip any `**QA Strategy:** <url>` line and the `---` immediately above it. Leave the Notion page in place.
2. Replace the two `⊙` sections in `desc` (same insert-after-DoD order as 2026-08-20). New body has no markdown ticks and no `✅❌❓`.
3. If `desc` length > 16384, stop. Paste the length. Do not truncate. Do not publish anywhere else.
4. Sync native checklists (create if missing, exact name). Preserve `complete` on matching items (algorithm below). Delete items whose match key disappeared. If **Post Deployment tracking** has zero watches, delete that checklist (`DELETE /1/checklists/{id}` — MCP has no delete-checklist tool). If **QA Strategy** has zero tickable items, delete that checklist too.
5. `PUT` `desc`. If the write fails, paste the error and stop. Do not retry on Notion or a comment.

`trello_assistant` still does not create these `⊙` sections or these two native checklists. On edit it leaves both the sections and the checklists alone.

## Republish — keep ticks

Match key = text before ` — EXPECT`, after stripping markdown `- [ ]` / `- [x]`, backticks, and trailing `✅` / `❌` / `❓`.

1. Prefer an existing native item with the same match key. Keep its `complete` / `incomplete` state. Update the item name if the short EXPECT changed.
2. Else, if the old `desc` heading with the same `Test n:` / extra-check / watch match key ended with exactly `✅` (not `✅❌❓`), write `complete`.
3. Else `incomplete`.
4. New keys → new incomplete items. Dropped keys → delete those items.

Do not auto-tick from a staging booking. Do not reset a completed item back to incomplete because the EXPECT clause was rephrased.

## Skill and file impact

| File | Change |
|------|--------|
| `.cursor/skills/qa_strategy/SKILL.md` | Step 4 + Step 5 publish both surfaces. Drop `✅❌❓` / markdown ticks from templates. |
| `.cursor/skills/qa_strategy/references/log_to_open.md` | Worked examples match the description shape (no `- [ ]`, no `✅❌❓`). |
| `.cursor/skills/qa_strategy/evals/evals.json` | Expected output: native checklists + body without markdown ticks / `✅❌❓`. |
| `.cursor/skills/trello_assistant/SKILL.md` and `references/card_anatomy.md` | Preserve the two native checklists. Do not create, tick, add, or delete their items. |

## What not to do

- Do not put markdown `- [ ]` or `✅❌❓` under **QA Strategy** or **Post Deployment tracking**.
- Do not add a "tick progress on the checklist" (or similar) instruction line in `desc`.
- Do not put queries, *Why:*, or numbered steps in a native checklist item.
- Do not create a native item for `No test:` or for a DoD parent with no tests.
- Do not nest native items (Trello cannot).
- Do not post the strategy as a Trello comment or a file attachment.
- Do not publish to Notion.

## Out of scope

- Changing `post_deploy_tracker`.
- Deleting old Notion QA pages.
- Auto-flipping native items after a staging booking.
- Glossary changes.
