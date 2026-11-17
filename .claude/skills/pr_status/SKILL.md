---
name: pr-status
description: >-
  Use when the user gives a GitHub pull request link or a Trello card link and
  asks where the PR stands — "PR status for <link>", "what's the status of this
  PR", "status of the PR on this card", "who is reviewing <PR>", "are the
  comments resolved", "is this PR ready to merge", "why is this PR stuck",
  "who are we waiting on", "when was it submitted for review". Also use when
  another skill (qa_strategy, post_deploy_tracker, trello_assistant) needs to
  know whether a card's PR is open, approved, merged, or blocked. Read-only:
  covers submission time, reviewers and their states, who commented and when,
  resolved vs unresolved review threads, CI checks, and merge state. Defaults
  to `mventures/genesis`; any repo the `gh` CLI can read works.
---

# PR Status

Report where one pull request stands: when it went up for review, who reviews
it, what they said, which comments are still open, and who owes the next move.
Read-only. The skill never comments, approves, resolves threads, or edits the
Trello card.

## When to use

- The user pastes a PR URL (`https://github.com/<owner>/<repo>/pull/<N>`),
  `owner/repo#N`, or a bare genesis PR number and asks for status.
- The user pastes a Trello card (`https://trello.com/c/<shortLink>`) and asks
  about "the PR" on it.
- Another skill needs the merge state or reviewer picture before it plans
  staging or post-deploy checks.

## When NOT to use

- Reviewing the code itself against team standards → [`code_review`](../code_review/SKILL.md).
- Finding which merged PR caused a regression → [`deploy_blamer`](../deploy_blamer/SKILL.md).
- Building a test plan from the PR → [`qa_strategy`](../qa_strategy/SKILL.md).

## Inventory

| Item | Value |
|------|-------|
| Fetch script | `.claude/skills/pr_status/scripts/pr_status.py` |
| Data source | `gh api graphql` (one call per PR; uses the user's `gh` login) |
| Default repo | `mventures/genesis` (for bare numbers) |
| Trello read | Trello MCP `get_card` (description + attachments) |
| Output folder | `reports/pr_status/<repo>-<N>.md` (gitignored) |

GraphQL is required because only GraphQL exposes `isResolved` on review
threads. The GitHub MCP (`get_pull_request_comments`) cannot tell resolved
from open, so do not use it for this skill.

## Workflow

### 1. Resolve the input to PR URLs

- **PR link / `owner/repo#N` / number** → use it as is.
- **Trello card** → call Trello MCP `get_card` with the shortLink. Collect
  every `https://github.com/<owner>/<repo>/pull/<N>` URL from the card
  description and attachments. If none, say so and stop. If several, report
  each one.

### 2. Check `gh` access

Run `gh auth status`. If it is not logged in, tell the user to run
`gh auth login` and stop. Do not look for tokens elsewhere.

### 3. Fetch

```bash
python3 .claude/skills/pr_status/scripts/pr_status.py <pr_url> \
  > reports/pr_status/<repo>-<N>.md
```

Add `--json` for the normalised data (every review, thread, and check, with
URLs) when you need detail the Markdown hides — for example the full bot
review list or exact check URLs.

### 4. Report in chat

Paste the script's Markdown into chat as is. It is the agreed layout
(per reviewer, chosen on 2026-11-16 from four prototypes):

1. **Header** — PR link and title; state, opened time, ready-for-review
   time, author (and merged / closed time when set).
2. **One block per human reviewer** — icon (✅ approved, ⛔ changes
   requested, ⏳ pending, 💬 commented), requested time, latest state and
   time, `⚠ approved before the last commit` when it applies, thread count.
   Under it, each **open** thread, oldest first: the time the comment was
   added, file link, `(outdated)` flag, first 90 characters, and a second
   line with who owes the reply:
   - `🔴 needs author (no reply for <age>)` — the reviewer spoke last.
   - `🟡 <author> replied <time>` — the author replied; the reviewer must
     answer or resolve.
3. **🤖 Bots** — one line per bot: state and thread counts.
4. **PR conversation** — human PR-level comments with times.
5. **Footer** — CI, mergeable, review decision, last commit time, and any
   failing checks with links.

After the report, add one line: **Next move** — who must act, and what.
For PRs with more than ~20 open human threads, paste the header, the
blocks that hold a 🔴 thread, and the footer; link the full report for the
rest. Write the report path as a full absolute path.

### 5. Read thread text when asked

The report shows only the first 90 characters of each thread. When the user
asks what a reviewer meant, or whether a reply addressed it, read the full
thread from `--json` output or open the thread URL with `gh api` before
answering. Do not judge "addressed" from the snippet.

## How to read the signals

| Signal | Meaning |
|--------|---------|
| `resolved` | Someone pressed "Resolve conversation". The only hard "done" signal. |
| `open` + `outdated` | The code under the comment changed, but nobody resolved the thread. Likely addressed; confirm before saying so. |
| 🔴 `needs author` | Reviewer spoke last (or the thread has no reply). The author owes a reply or a fix. |
| 🟡 `<author> replied` | The author replied last. The reviewer owes a reply or a resolve. |
| `PENDING (re-requested)` | The author asked this reviewer again after their last review. |
| `DISMISSED` | An earlier review was dismissed (often a bot re-running). Ignore it unless it is the latest human state. |
| `review decision: REVIEW_REQUIRED` | Branch protection still wants approvals. |

## What not to do

- Do not post comments, resolve threads, approve, or re-request reviewers.
- Do not say a comment is "addressed" because the thread is outdated. Say
  "outdated, not resolved" and link it.
- Do not count the author's own replies as reviews.
- Do not use the GitHub MCP comment tools for resolution state — they do not
  return it.
