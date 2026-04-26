# Automation cards (separate board)

When the user asks to add or file a card for **new Automation functionality** (any agent, automation, AI pipeline, internal tool to automate a workflow), put it on the **Content Integration - AI Automation** board, not the Content Integration board this skill otherwise targets.

| Item | ID |
|------|-----|
| Board **Content Integration - AI Automation** ([link](https://trello.com/b/pIpbeOvU/content-integration-ai-automation)) | `69eb6abd2401830e634500b8` |
| List **NEW** (intake — agent files new cards here) | `69eb6b008e21e4b4960d8537` |
| List **SOON** | `69ecfe3922c658441d699159` |
| List **LATER** | `69ecfe4188ad121de040d28a` |
| List **TODO** (groomed work the agent can pick up) | `69ecfe4662c5aabcb61708fa` |
| List **IN PROGRESS** (work the agent is actively driving) | `69ed0aeb004434fb27407d06` |
| List **FIXES NEEDED** | `69ecfe5520ac67b75b95aef6` |
| List **QA** (agent-completed work awaiting human verification) | `69ecfe6d22049cdc94e4faf0` |
| List **DONE** (human-verified and closed — the human moves cards here, not the agent) | `69ecfe62f99eec631efd148d` |

Use the **user-trello** MCP. `set_active_board` with the board ID above, then `add_card_to_list` on the **NEW** list (or `move_card` for lifecycle transitions).

## Card style

Keep it short and human-written. No `⊙` headings, no rigid templates, no AI footer. Write like a teammate filing a quick note. Skip the dedup pass and grooming machinery in [`SKILL.md`](./SKILL.md) — those rules apply to the Content Integration board only.

## Required sections

Three plain markdown headings, in this order:

```markdown
## Summary
One or two sentences: what the automation does and why we want it.

## Implementation plan
Three to six bullets. The actual steps, in plain language.

## Requirements
What needs to exist or be decided before we start (data, access, owners, dependencies).
```

If a section has nothing real to say, write one honest sentence ("No external dependencies." / "TBD — need to confirm with X.") rather than padding.

## Working a card the user pointed you at

When the user points you at a card on this board (`/c/<shortLink>` or `https://trello.com/c/...`) and asks you to do the task on it, use `get_card` (with `includeMarkdown: true`) to read the description, then drive the work. Lifecycle transitions are mandatory, not optional — the user reads the board state, not the agent transcript, to know whether something is done. Skipping a move, a comment, or the per-card branch hides finished work from them.

### One card, one branch, one PR

Every card is its own unit of review. Do not pile two cards' worth of work onto the same branch — even when the topics feel related. The reviewer should be able to look at any single card and read exactly the diff that closes it, nothing more.

- **Branch off the repo's default branch** (typically `main`) at the start of every card. Confirm with `git remote show origin | grep 'HEAD branch'` if unsure. If the user explicitly tells you to branch off something else (e.g. a long-running umbrella feature branch like `feature/<area>_agent`), branch off that instead — but still create a fresh branch per card.
- **Branch name:** `automation/<shortLink>-<slug>` where `<shortLink>` is the Trello card's `shortLink` (the bit after `/c/` in the URL — e.g. `j12DeeXG`) and `<slug>` is a short kebab-case summary (e.g. `respro-selectors`). The shortLink prefix means anyone looking at `git branch` can map a branch back to its card without guessing.
- **One PR per card.** When the work is done, push the branch and open a PR whose title carries the card prefix (`SOURCE: …` style, matching the card title) and whose body opens with `Closes https://trello.com/c/<shortLink>` so the card and PR are linked in both directions. Keep the PR scope tight to that card.
- **Mid-task scope creep:** if the work uncovers an unrelated change you'd be tempted to bundle in, file a follow-up card on TODO (per [Tracking child cards on the parent](#tracking-child-cards-on-the-parent)) and leave it for its own branch + PR. The exception is in-scope incidental fixes the card description already implies (a typo in a doc you're rewriting, a lint that lights up in a file you're already editing) — those land on the same PR.
- **Honor explicit user overrides.** If the user says "just push this fix on the current branch" or "don't open a PR yet", do that. The rule above is the default, not a hard gate.

### When you start working

Two things, in this order, before any tool call that touches files or DBs:

1. **Cut the per-card branch.** Use the convention from [One card, one branch, one PR](#one-card-one-branch-one-pr): `git switch <default-branch> && git pull --ff-only && git switch -c automation/<shortLink>-<slug>`. If the working tree has uncommitted changes from a prior task, stop and surface that to the user — do not silently carry them onto the new branch.
2. **Move the card to IN PROGRESS** (`69ed0aeb004434fb27407d06`) via `move_card`. One card in IN PROGRESS per active agent task — leaving it parked in TODO while you're already running tools makes the board lie to anyone else looking at it. If the card sits in **NEW** / **SOON** / **LATER**, only move it once the user has explicitly told you to start it now.

If the user explicitly tells you to keep the card in its current list, or to work on the existing branch, honour that and skip the corresponding step.

### When you finish (mandatory closing ritual)

Before you tell the user you're done, **all three** of the following must happen, in this order:

1. **Open the PR.** Push the per-card branch (`git push -u origin HEAD`) and open the PR via `gh pr create`. PR title carries the card prefix; PR body opens with `Closes https://trello.com/c/<shortLink>` followed by a 1–3 bullet summary and a short test plan. Capture the PR URL — it goes in the card comment in step 2.

2. **Add a comment** to the card via `add_comment` describing what shipped. Use this structure (skip a section only when there is genuinely nothing to put in it):

   ```markdown
   Done. <one-line outcome — what now works that didn't before>.

   PR: <pr-url>

   **Flow exercised**
   - <the actual commands / scenarios you ran, with concrete IDs / artefacts so a reviewer can re-run or eyeball the evidence>

   **Findings** (only if you discovered something the card description didn't anticipate — selector rot, env-specific bug, false positive in earlier runs, etc.)
   - <one-bullet-per-finding, with the file path or DB row that proves it>

   **Changes**
   - `<path/to/file>` — <one-line of what changed and why>
   - …

   **Follow-ups** (only if you intentionally left work for later — these must also exist as a `Follow-ups` checklist item on the parent, see [Tracking child cards on the parent](#tracking-child-cards-on-the-parent))
   - Filed `<shortUrl>` — <one-line of what's deferred>

   **Evidence**
   - <scenario dirs, screenshots, log files, query outputs — paths or links a reviewer can open>
   ```

   The comment is the human's read of what changed; do not rely on the description, the chat transcript, or the diff alone. Concrete IDs (booking IDs, transaction IDs, scenario dir paths) and the PR URL belong here, not in the description.

3. **Move the card to QA** (`69ecfe6d22049cdc94e4faf0`) via `move_card`. **The agent never moves cards into DONE** — DONE is the human's signal that they verified the work and merged the PR. If the human asks you to move directly to DONE, do it, but otherwise stop at QA.

If the work uncovered a blocker that you can't resolve in this turn, still open a draft PR (or skip the PR if no code shipped), move the card to **FIXES NEEDED** (`69ecfe5520ac67b75b95aef6`) instead of QA, and the comment's first paragraph names what's blocking and what you'd need to proceed.

If the user has explicitly waived the PR step ("don't open a PR yet", "I'll review the diff locally first"), still do the comment + list move, and call out in the comment that the diff lives on `<branch-name>` waiting to be pushed.

### Verifying the move actually landed

`move_card` returns the card body with the new `idList`. After calling it, verify `idList` matches the target list ID (or `list.name` matches the target list name) before reporting success to the user. Trello UIs occasionally lag, so the API response is the source of truth — quote the new list name back to the user so they can refresh with confidence.

### Tracking child cards on the parent

Whenever a card has child cards — whether **planned** (an epic decomposed into per-domain subtasks at intake) or **spawned mid-task** (deferred work the agent splits off while working a card) — the parent↔child relationship must be visible on **both** cards. The link is bidirectional by construction: the parent gets a checklist item pointing down at the child; the child gets a Trello-card attachment pointing up at the parent. Without both legs, opening one card from outside the other's context makes the other invisible.

Two checklist names on the parent, picked by intent:

- **`Child cards`** — planned decomposition. Use on epics and on any card whose description was authored knowing it would split into N sibling cards. Each item represents a sibling unit of in-scope work.
- **`Follow-ups`** — mid-task deferred work. Use when the agent is working a card and discovers something out of scope that deserves its own card later (e.g. "Summit selectors are too generic, file as separate"). Each item represents a deliberate scope-cut that the agent wants the human to track.

The mechanics are the same for both names. Whenever you file (or discover an existing) child card:

1. **Find or create the checklist on the parent.** Use `get_checklist_by_name` (`name: "Child cards"` or `"Follow-ups"`, `cardId: <parent>`); if it returns nothing, call `create_checklist` with the same name and `cardId`. Always use the exact name so subsequent invocations append to the same checklist instead of stacking duplicates.
2. **Add the child as a checklist item** with `add_checklist_item` (`checkListName: <one of the two names>`, `cardId: <parent>`, `text: "<child shortUrl> — <one-line of what the child covers>"`). Putting the `shortUrl` first makes the item clickable in the Trello UI and parseable by other agents.
3. **Attach the parent card to the child.** Call `attach_file_to_card` on the child (`cardId: <child>`, `fileUrl: <parent shortUrl>`, `name: "Parent: <parent name>"` — keep the `Parent:` prefix so anyone scanning the child's Attachments can spot it instantly). Trello recognises a `trello.com/c/...` URL and renders the attachment as a clickable linked-card chip; combined with the parent's checklist item this gives bidirectional navigation without text references that drift. Verify by checking `badges.attachmentsByType.trello.card >= 1` on the child after the call. **Children with no parent attached are non-conforming — backfill them whenever you encounter one, even if it's not the card you were asked to work on.**
4. **Don't maintain a parallel markdown list in the description.** If the description currently has a `## Child cards` / `## Follow-ups` block (on the parent) or a `## Parent` block (on the child), replace it with a one-line pointer to the checklist / attachment (e.g. "Tracked on the **Child cards** checklist on this card." / "Parent: see Attachments.") and stop.
5. **Mirror Follow-ups in the closing comment.** For the `Follow-ups` checklist specifically, also list the same items in the closing comment's `**Follow-ups**` section — the checklist is canonical for at-a-glance progress, the comment is the narrative snapshot at hand-off. (Epic `Child cards` checklists don't get a closing comment, since the epic itself is rarely closed by the agent.)

**Where the child card lands.** Both planned and spawned children go on the **TODO** list (`69ecfe4662c5aabcb61708fa`), not NEW — they are pre-groomed (the parent's description gives you the context to write a tight implementation plan) and skipping the SOON/LATER staging avoids duplicating triage. Each child gets its own branch + PR when someone picks it up — never tack it onto the parent card's branch.

**Do not auto-tick items.** Leave checklist items `incomplete` until the child card lands in DONE — same policy as the parent card itself: the agent never moves cards into DONE, and by extension never marks the matching checklist item complete. The human ticks the item when they verify and merge the child's PR. (The `update_checklist_item` tool exists for cases where the user explicitly asks the agent to tick an item, e.g. when the child got cancelled or rolled into a different card; otherwise leave it alone.)

**Reading progress on demand.** When the user asks "what's left on card X?" or "what children of the epic are done?", call `get_checklist_items` with the parent's `cardId` and report the `incomplete` ones with their text. That's the cheapest way to surface in-flight child work without rebuilding it from comments.
