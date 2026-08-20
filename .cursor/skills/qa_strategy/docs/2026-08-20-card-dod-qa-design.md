# QA strategy: publish on the Trello card after DoD

Date: 2026-08-20
Skill: `qa_strategy`
Status: approved in chat (shape B, post-deploy C, republish keeps marks)

Supersedes the **Log to open slot** and **PASS:** lines in [`2026-08-13-log-to-open-design.md`](2026-08-13-log-to-open-design.md). Harvest rules and the secondary-surface order in that doc still apply; they now write into the observe line. Test bodies are short: at most two numbered lines before **EXPECT:** (action, then observe).

Specimen format: [TRAVELFUSION: Inform customer of card surcharge before payment](https://trello.com/c/Yh7NNBY6/3139-travelfusion-inform-customer-of-card-surcharge-before-payment) — DoD on the card, nested tests in comments.

## Problem

QA strategies publish to a Notion page. The Trello card only gets a link. QA already works in the card description, next to **Definition of Done**. The Notion page is a second place to maintain.

The plan shape (Smoke / Happy-path / **PASS:** / **Log to open** slot) does not match how QA records results: DoD# parents (`DoD1`, `DoD2`) with nested tests, and a visible pass / fail / unknown mark.

## Decision

Publish the strategy into the Trello card `desc`, immediately after **Definition of Done**. Stop creating and updating Notion pages from this skill.

Two `⊙` sections only:

| Section | When it ships |
|---------|----------------|
| `### ⊙ **QA Strategy**` | Always, when DoD has real items, or when the PR yields a test that does not map to DoD. |
| `### ⊙ **Post Deployment tracking**` | Only when it has at least one watch. Drop the heading when empty. |

No **Additional tests** section. No Notion render. No `**QA Strategy:** <notion_url>` line in `desc`.

## Published shape

Chat preview equals what is written onto the card. Do not publish: `## QA Strategy — …`, **PR:** / **What changes for QA** / **Notes for QA** / **Baseline**, or **Smoke tests** / **Happy-path** / **Edge cases** / **Regression risks**. Put **What changes for QA**, **Notes for QA**, and code red flags in the chat reply outside the plan block. The agent may still group checks as smoke / happy-path / edge while deriving; those labels never appear on the card.

```markdown
### ⊙ **QA Strategy**

- [ ] DoD1
  - Test 1: <short name> ✅❌❓
    *Why:* <one or two sentences>
    1. Drive the checkout / booking. Note `search_id`.
    2. Open `<context>` (`_scopes` `<scope>`). Confirm Request `<field>`.
    **EXPECT:** <observable condition>
- [ ] DoD2
  - No test: <reason>.
- [ ] <PR check that does not map to a DoD item> ✅❌❓
  *Why:* …
  1. …
  **EXPECT:** …

### ⊙ **Post Deployment tracking**

- [ ] <short watch line> ✅❌❓
  **Find the attempts:**
  ```sql
  -- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
  <query>
  ```
  **EXPECT:** <observable condition>
```

Heading strings are exact. Parse and replace by these strings, including bold.

## Rules

### DoD# parents

- Write one `- [ ] DoD<n>` line into **QA Strategy** for every real DoD item. `n` matches the `DoD<n>` prefix under **Definition of Done**. Do not paste the DoD sentence. Do not put ✅❌❓ on that line.
- Under a coverable item, nest `Test 1`, `Test 2`, … Each test heading ends with ✅❌❓ on first publish.
- Under an uncoverable item, nest exactly `No test: <reason>.` Do not invent a check. Do not put ✅❌❓ on a `No test:` line.
- If DoD is only `DoD1 _TO BE DONE_` (or a legacy `- [ ] _TO BE DONE_`), write no DoD# lines. Ship **QA Strategy** only when the PR still yields tests that do not map to DoD.
- If a card still uses `- [ ]` / `- [x]` under Definition of Done, number those 1-based in order (legacy).

### Tests that do not map to DoD

- New `- [ ]` lines in **QA Strategy**, after every DoD# item.
- ✅❌❓ goes on that `- [ ]` line.
- Same *Why:* / action + observe / **EXPECT:** body as a nested test. No wrapper section. At most two numbered lines before **EXPECT:**.

### Post Deployment tracking

- Short watch line + ✅❌❓ + optional **Find the attempts:** / monitoring query + **EXPECT:**.
- No numbered log lines. No *Why:*. No **Log to open**.
- Omit the whole section when there is zero watches.

### Status marks

- First publish: every test heading and every extra / post-deploy `- [ ]` line ends with `✅❌❓` (no spaces between the three).
- QA deletes the two marks that do not apply and keeps one.
- Meaning: ✅ pass, ❌ fail, ❓ not run / not observed.

### EXPECT, not PASS

- The last observable line is `**EXPECT:**`. Never `**PASS:**`.

### Short test body

QA already knows how to search, pick a seat, and open a debug log. A test is not a how-to tutorial.

- At most two numbered lines before **EXPECT:**: action (drive the condition; note the id in the same sentence), then observe (named log) when a log is required.
- Skip the observe line when the check produces no debug log group.
- If the proof is a query, put the query next to **EXPECT:**. Do not add a "Run this query" numbered line.
- Never a separate "Note the `search_id`" line. Never click-by-click.

### Logs live in the observe line

- Staging booking / checkout / search checks still run the harvest from the 2026-08-13 design (context, `_scopes` when needed, Request/Response field, before permalink when the field changed, secondary surface when the body did not change).
- Write the harvest into the observe line (the second numbered line). Do not emit a **Log to open** slot, a `This log does not show the logic change` labelled line, or an **Also watch:** labelled line.
- When the field changed: the observe line names the context, `_scopes` if needed, the field, and the before permalink (`https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>`). **EXPECT:** includes the new shape. Do not invent an after permalink.
- When the body is unchanged: the observe line says the supplier Request/Response is the same and names the first secondary surface that moves (same priority list as 2026-08-13). **EXPECT:** is that surface. If none move, drop the check; say so in the chat reply, not on the card.
- Post-deploy watches do not name logs this way.
- Omit the observe line on checks that produce no debug log group. Do not invent a fake context.
- When several observations share one booking, each observation that needs a log names that log in its own observe line. Two contexts are two tests. The same context+field is not repeated.

### Queries

Unchanged: every query is verified before it ships. Locator queries sit under the test that needs them. Monitoring queries sit under the matching post-deploy watch.

## Publish workflow

1. Propose the card markdown in chat. End with: *Approve and publish?*
2. Iterate until approval.
3. On approval, `GET` the card `desc`, then `PUT` the new `desc`. Never call Notion create or update from this skill.
4. Strip any `**QA Strategy:** <url>` line and the `---` immediately above it. Leave the Notion page on disk; do not delete it.
5. Insert **QA Strategy** immediately after the **Definition of Done** section (heading + its checklist), before the next `### ⊙` section (**Similar / relevant cards**, **QA notes**, **Credentials / access**) and before the AI footer.
6. Insert **Post Deployment tracking** immediately after **QA Strategy** when that section has items. If an older copy of either section exists elsewhere in `desc`, remove it as part of the same write so only one copy remains, in this order.
7. `trello_assistant` may keep these two sections on a card edit. It does not create them. It does not fold them into Details. **QA notes** stays a separate optional section; do not merge the two.
8. If the Trello write fails, or the new `desc` would exceed Trello's description limit (16384 characters), paste the error or the size in chat and stop. Do not truncate. Do not publish anywhere else.

## Republish — keep marks

Replace the bodies of **QA Strategy** and **Post Deployment tracking** on every republish.

Preserve marks as follows:

1. Strip trailing `✅` / `❌` / `❓` from the new heading. That stripped text is the match key.
2. Find the same stripped heading in the existing section.
3. If it exists, copy its trailing mark suffix as-is:
   - one mark (`✅` or `❌` or `❓`) → keep that one
   - all three `✅❌❓` → write `✅❌❓`
   - two marks (QA mid-edit) → keep those two
4. If it does not exist (new test), write `✅❌❓`.
5. Headings that disappeared from the new plan are dropped, marks and all.

Do not preserve `- [x]` vs `- [ ]` on DoD# lines. Those reset to `- [ ]`. Only the three emoji marks are preserved. On a republish that switches an old verbatim DoD parent to `DoD<n>`, match tests by their `Test n:` heading; do not try to match the old DoD sentence to `DoD<n>`.

## Skill and file impact

| File | Change |
|------|--------|
| `.cursor/skills/qa_strategy/SKILL.md` | Step 4 template = the two `⊙` sections. Step 5 = Trello `desc` write. Delete Notion create/update, Notion render rules, and the desc-link algorithm. **PASS:** → **EXPECT:**. Harvest stays in Step 2; output goes into the observe line. Test body: at most two numbered lines before **EXPECT:**. |
| `.cursor/skills/qa_strategy/references/log_to_open.md` | Worked examples use action + observe, **EXPECT:**, and ✅❌❓. No slot. No tutorial steps. |
| `.cursor/skills/qa_strategy/evals/evals.json` | Expected output: DoD# parents (`DoD1`, `DoD2`), `No test:`, extra tests after DoD# items, ✅❌❓, **EXPECT:**, at most two numbered lines, logs in the observe line, no Notion, no **Log to open** slot, no **Additional tests**. |
| `.cursor/skills/trello_assistant/SKILL.md` and `references/card_anatomy.md` | Allowed optional `⊙` sections after DoD: **QA Strategy**, **Post Deployment tracking**. Preserve on edit. Do not create. Do not migrate away. |
| Notion pages already created | Leave in place. |

## What not to do

- Do not publish to Notion.
- Do not add an **Additional tests** section.
- Do not emit a **Log to open** slot.
- Do not write **PASS:**.
- Do not put ✅❌❓ on a DoD# line (`- [ ] DoD1`) or on a `No test:` line.
- Do not restate a Definition of Done sentence under **QA Strategy**. Write `- [ ] DoD1`, `- [ ] DoD2`, … only.
- Do not invent a test for an uncoverable DoD item.
- Do not nest an extra PR check under a DoD item it does not cover.
- Do not name logs on post-deploy watches.
- Do not write a third numbered line, a click-by-click tutorial, a separate "Note the `search_id`" line, or a "Run this query" numbered line.
- Do not reset a heading's marks back to `✅❌❓` when that heading still exists with a different suffix.
- Do not create **QA Strategy** from `trello_assistant` when filing a card.

## Out of scope

- Changing `post_deploy_tracker`.
- Deleting old Notion QA pages.
- Auto-flipping ✅ / ❌ after a staging booking.
- Glossary changes. `debug log`, `checkout page`, `ResPro page` stay as they are.
- Trello checklists or comments as the publish target.
