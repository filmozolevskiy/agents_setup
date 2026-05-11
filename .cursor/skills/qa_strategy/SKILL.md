---
name: qa-strategy
description: >-
  Use when the user wants a QA strategy, test plan, or staging/post-deploy
  checklist derived from a Trello card and its linked PR — trigger phrases:
  "QA strategy for this card", "generate a test plan for", "what should we
  test for this PR", "staging checklist for <card>", "post-deploy checks for
  <card>", "what to QA on <card link>". Reads the card description and PR
  diff via GitHub MCP, then produces a two-section plan (Staging + Post-
  deployment). Covers the Content Integration - AI Automation board; works
  for any card that has a linked PR on mventures/genesis (or a user-supplied
  repo).
---

# QA Strategy Generator

Given a Trello card and its linked PR, produce a structured QA strategy — what to test on staging before merging, and what to watch in production after deploy. No hardcoded flows; every checklist item derives from the actual PR diff and card scope.

## When to use

- User points at a Trello card and asks for a test plan, QA strategy, staging checklist, or post-deploy checks.
- Another skill (e.g. `trello_assistant` closing ritual) needs a ready-made test plan to attach to a card.

## When NOT to use

- The user wants to **run** a test booking end-to-end → use `qa_assistant` instead.
- The user wants to verify a deploy is working in production over time → use `post_deploy_tracker`.
- There is no card and no PR; the user is asking generically about QA practices.

## Inputs

| Input | How to get it |
|-------|--------------|
| Trello card URL or shortLink | Required — from the user or caller |
| GitHub repo | Default `mventures/genesis`; accept override |
| `--mode comment` flag | Optional — when present, post the finished strategy to the card via `add_comment` |

## Tooling

- **Trello REST API** — `GET /1/cards/<id>?attachments=true&actions=commentCard` to read description and comments.
  - Credentials: `TRELLO_API_KEY` and `TRELLO_TOKEN` from `.env`.
  - Base URL: `https://api.trello.com/1/`
- **GitHub MCP** (`GitHub` server) — `get_pull_request`, `get_pull_request_files`.

## Workflow

### Step 1 — Read the card

Call `GET /1/cards/<shortLink>?actions=commentCard&fields=name,desc,url` with credentials from `.env`.

Extract:
- Card title and description (the "what was built" context).
- PR URLs from the description and from `actions[].data.text` (comments). Match `github.com/.+/pull/\d+`.

If no PR URL is found: ask the user to paste the PR URL before proceeding. Do not guess.

### Step 2 — Read the PR

For each linked PR (limit to 3; flag if more):

```
get_pull_request(owner, repo, pull_number)
get_pull_request_files(owner, repo, pull_number)
```

Capture:
- PR title, body, labels.
- Changed files list (path + additions/deletions).

Derive the **change surface** — group changed files by area:

| Area | Signal |
|------|--------|
| DB migration / schema | `db/`, `migrate/`, `schema`, `*.sql` |
| Content-source logic | `app/models/content_sources/`, `lib/content_sources/` |
| Booking / checkout flow | `app/models/booking*`, `app/controllers/booking*` |
| Optimizer / candidates | `app/models/optimizer*`, `lib/optimizer*` |
| Config / feature flags | `config/`, `*.yml`, `*.env*` |
| API / routes | `config/routes.rb`, `app/controllers/api/` |
| Background jobs | `app/jobs/`, `app/workers/` |
| Front-end / views | `app/views/`, `app/assets/`, `*.html.erb` |

### Step 3 — Derive the strategy

Map the change surface to test scenarios. Do not invent checks unrelated to the changed files.

**Staging section** — checks before the PR is merged or deployed to production:

- **Smoke tests**: the simplest possible exercise of each changed flow (one search, one book, one API call).
- **Happy-path flows**: end-to-end scenarios the card description implies should now work.
- **Edge cases**: inputs that exercise the boundary of the fix (e.g. if the fix is for a passenger-age mapping, test infant + adult combo; if it's a DB migration adding a NOT NULL column, test the rollback path).
- **Regression risks**: other flows that touch the same files or DB tables — list them so QA knows what else to poke.

**Post-deployment section** — checks after the fix is live in production:

- **Production checks**: quick manual verifications (e.g. open one live booking that previously failed, confirm the error is gone).
- **Monitoring queries**: copy-pasteable MySQL / ClickHouse / Mongo snippets that measure the fix's impact. Use a 1-hour or 24-hour window; label the window and timezone.
- **Rollback signals**: concrete conditions that indicate the fix made things worse (error rate increase, new error type appearing, broken downstream flow). One sentence each.
- **Watch window**: recommend how long to monitor before closing the card (default: 24 h for booking-path changes, 4 h for config-only changes).

### Step 4 — Output the strategy

Emit the strategy as a structured markdown block:

```markdown
## QA Strategy — <Card title>

**PR:** <pr_url>
**Changed areas:** <comma-separated list from step 2>

---

### Staging

**Smoke tests**
- [ ] <concrete step>

**Happy-path flows**
- [ ] <concrete step>

**Edge cases**
- [ ] <concrete step>

**Regression risks**
- [ ] <area to recheck> — <one-line why>

---

### Post-deployment

**Production checks**
- [ ] <concrete step>

**Monitoring queries**

```sql
-- <label, window, timezone>
<query>
```

**Rollback signals**
- <condition> → revert / escalate

**Watch window:** <N hours>
```

If `--mode comment` is set, post this block to the Trello card via:

```bash
curl -s -X POST "https://api.trello.com/1/cards/<id>/actions/comments" \
  -d "key=$TRELLO_API_KEY" \
  -d "token=$TRELLO_TOKEN" \
  --data-urlencode "text=<strategy markdown>"
```

## What not to do

- Do not invent test cases for files not in the PR diff. Every checklist item must trace back to a changed file or a card-described flow.
- Do not hardcode staging URLs. Reference the environment by name (e.g. "staging", "UAT") and let the QA engineer supply the host.
- Do not post the strategy as a comment unless `--mode comment` is explicitly set or the user asks.
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not skip Step 1 — the card description is required context; a PR diff alone does not capture the intent.
- Do not call `get_pull_request_diff` for large PRs (>50 files); rely on `get_pull_request_files` for the file list and the PR body for intent.

## References

- GitHub MCP schema: inspect via `list_tools` on the `GitHub` server at session start if tool names are uncertain.
- Trello credentials and board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
- Monitoring query patterns (MySQL bookability, ClickHouse errors): `.cursor/skills/bookability/SKILL.md`.
- Post-deploy monitoring loop (for longer tracking): `.cursor/skills/post_deploy_tracker/SKILL.md`.
