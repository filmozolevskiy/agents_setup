---
name: qa-strategy
description: >-
  Use when the user wants a QA strategy, test plan, or staging/post-deploy
  checklist derived from a Trello card and its linked PR — trigger phrases:
  "QA strategy for this card", "generate a test plan for", "what should we
  test for this PR", "staging checklist for <card>", "post-deploy checks for
  <card>", "what to QA on <card link>". Reads the card description and PR
  diff via GitHub MCP, then produces a two-section plan (Staging + Post-
  deployment) framed **entirely in terms of what the end user sees on the
  storefront, what the internal FH / JF agent sees in admin tools, and what
  the debug / optimizer logs look like** — never in terms of internal code
  classes, methods, or DTOs. Covers the Content Integration - AI Automation
  board; works for any card that has a linked PR on mventures/genesis (or a
  user-supplied repo).
---

# QA Strategy Generator

Given a Trello card and its linked PR, produce a structured QA strategy — what to test on staging before merging, and what to watch in production after deploy.

## Core principle

**Read the code. Test the functionality.**

Reading the PR (or the branch diff) is **mandatory** — the agent cannot write a useful plan without seeing what changed. But the diff is read to answer one question only: *what behaviour will a human or a log query notice differently after this change?* The output plan is written in terms of UI flows, internal screens, emails, and log shapes that QA can observe directly. Every checklist item must be something a human (end user or internal FH / JF agent) or a log query can verify without opening the codebase.

If a change has no user-visible, agent-visible, or log-visible effect (pure refactor, internal renames, comment-only edits), the plan says so explicitly and is short — it does not invent code-coverage checks to fill space.

### Scope discipline

Every checklist item must trace to the specific behaviour the PR changes. If the PR only touches the availability-check step, do **not** add checks for the confirmation page, the confirmation email, baggage selection, or seat selection just because they sit downstream — those belong on a plan for a PR that actually changes them. Drop any item you cannot tie to a file in the diff **and** a user / agent / log touchpoint that the diff modifies.

### No code-level red flags in the output

If the diff contains obvious code-quality concerns unrelated to behaviour QA can test (debug toggles flipped on, unconditional bypasses, commented-out guards, leftover `dd()` / `var_dump`), **do not** add this to the plan. The plan is QA workflow content, not code review. 

### No staging fixtures — lean on production cases for negative paths

The Staging section is reserved for flows that can be driven from a fresh search on staging without fabricated data. If staging cannot exercise a particular failure mode, say so explicitly in the plan.

We do not maintain staging fixtures for malformed, stale, or otherwise contrived inputs. Andy checkt that verify specific logic (price not available, "no seats" ...) should be first found in prod DB and if possible, reproduced on staging. Otherwise, it should be the Post-deployment section, where real production traffic supplies the case naturally, and frame it as: "watch prod for sessions where <natural condition>; if such a session occurs, confirm the user saw <expected message> and the log shape is <expected>. If no such case is observed in the watch window, mark as 'not observed' — do not block on it."

### A short "Why:" line under each non-trivial check

Every checklist item that is not a one-line smoke check gets a short *Why:* line immediately under the bold name and above the numbered steps. The *Why:* explains, in one or two plain-language sentences, what would break or what specific behaviour-change makes this test worth running. It must tie back to the PR's diff — "this is the line of code the PR changed", "this is the back-fill the PR removed", "this is the new short-circuit the PR introduced", "this is shared code that runs for every supplier" — phrased in plain user / agent / log terms, no code names.

### Every query is verified before it ships

This applies to **every** query that appears in the plan, regardless of where it sits — "find a case" locators inside a staging check, monitoring queries in the Post-deployment section, prod-watching queries for negative paths. No copy-pasting column names from memory or pattern-matching against other skills. The minimum bar before pasting any query into a plan, a Notion page, or a Trello card:

1. Open the table / collection's doc under `.cursor/skills/db_access/db-docs/<store>/<name>.md` and confirm every column / field referenced by the query exists with the expected type. If the doc is missing, write it (per the `db_access` skill) before continuing.
2. Confirm the literal values you filter on (`gds = 'dida'`, `booking_step = '...verifyPriceOperation()'`, etc.) by running a tiny `SELECT DISTINCT col LIMIT 50` (or Mongo equivalent) against the live store via the `db_access` CLI (`scripts/clickhouse_query.py`, `scripts/mysql_query.py`, `scripts/mongo_query.py`).
3. Run the query itself against a recent window. The result must come back non-empty and shaped as expected. Paste a one-line verification stamp next to the query in the plan: `-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.`

If a query cannot be verified (store unreachable, table missing, no recent data), do not include it in the plan. State the limitation in prose and recommend what to add once data is available.

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

## Tooling

- **Trello REST API** — `GET /1/cards/<id>?attachments=true&actions=commentCard` to read description and comments.
  - Credentials: `TRELLO_API_KEY` and `TRELLO_TOKEN` from `.env`.
  - Base URL: `https://api.trello.com/1/`
- **GitHub MCP** (`GitHub` server) — `get_pull_request`, `get_pull_request_files`, `get_pull_request_diff` (for PRs ≤ 50 files). Reading the diff content (not just file paths) is **mandatory** for small / medium PRs — that is how the agent understands what behaviour changed.

## Workflow

### Step 1 — Read the card

Call `GET /1/cards/<shortLink>?actions=commentCard&fields=name,desc,url` with credentials from `.env`.

Extract:
- Card title and description (the "what was built" context).
- PR URLs from the description and from `actions[].data.text` (comments). Match `github.com/.+/pull/\d+`.

If no PR URL is found: ask the user to paste the PR URL before proceeding. Do not guess.

### Step 2 — Read the PR / branch (mandatory)

This step cannot be skipped or shortcut. Reading the PR is the only way to know what behaviour changed; without it, the plan degrades into generic boilerplate.

For each linked PR (limit to 3; flag if more):

```
get_pull_request(owner, repo, pull_number)
get_pull_request_files(owner, repo, pull_number)
get_pull_request_diff(owner, repo, pull_number)   # PRs ≤ 50 files
```

For larger PRs (> 50 files), skip `get_pull_request_diff` and rely on `get_pull_request_files` plus targeted reads of the most-changed files via the `codebase_access` skill.

If the user supplies a branch name instead of a PR (work-in-progress), run `compare_commits(owner, repo, base, head)` on the GitHub MCP and read the resulting diff the same way.

Capture:
- PR title, body, labels.
- Changed files list (path + additions / deletions).
- The **substantive code changes** — not the file paths alone. Skim the diff hunks to answer: which user inputs, screens, emails, supplier calls, or log fields are now produced / consumed / formatted differently?

Then **translate the diff into a user / agent / log surface**. For every meaningful cluster of changed files, answer three questions and discard the file paths once you have the answers:

1. **What does the end user see differently?** (search page, fare card, checkout step, confirmation page, confirmation email, error message, fallback behaviour)
2. **What does the internal FH / JF agent see differently?** (admin order view, ticketing console, refund / exchange screens, agent error banners, queue / status fields)
3. **What does the log shape change?** (new / removed fields in `ota.debug_logs` or `ota.optimizer_logs`, supplier request / response payload diffs, new ClickHouse error codes, new MySQL row states)

Use this surface table when classifying. If a changed file does not map to any user / agent / log touchpoint, it does not generate a checklist item — code-only refactors are not in scope.

| User / agent / log touchpoint | What QA observes |
|-------------------------------|------------------|
| Search results / fare details | Storefront search page, sort + filter, fare card price, baggage / refundability badges, total breakdown |
| Checkout flow | Pax form, seat / baggage / insurance selection, fare-on-hold behaviour, payment step, price-change modal |
| Confirmation | Order confirmation page, confirmation email body, booking reference shown to user |
| Internal agent UI | FH / JF admin order detail, ticketing view, refund / exchange UI, queue / status badges |
| Debug / optimizer logs | `ota.debug_logs` document shape, `ota.optimizer_logs` shape, supplier request / response payloads |
| ClickHouse / MySQL signals | `jupiter_booking_errors_v2` error codes, MySQL booking-row state transitions visible to ops |
| Emails / external comms | Confirmation, voiding, refund, schedule-change emails |

### Step 3 — Derive the strategy

Map the user / agent / log surface to test scenarios. Every checklist item describes something a human or a log query can directly observe; **never name a class, method, abstract base, factory, or DTO**.

**Staging section** — checks before the PR is merged or deployed to production. Only includes flows that can be driven from a fresh search on staging or reproduced from a real prod case; negative paths that cannot be reached either way move to Post-deployment (see "No staging fixtures" above).

When a check needs a **specific** input — a particular carrier on a particular content source, a fare basis with a specific tag, a route that historically returned no ancillaries, a session that hit a specific error — do not handwave it. Include a concrete prod-DB query in the check's steps that finds a real example, so QA can pick one and reproduce the same search/route on staging. Anchor on whatever table or collection actually carries the dimension you need:

| What you need to find | Where to query | Joinable to |
|-----------------------|----------------|-------------|
| A booked itinerary on carrier X with content source Y | MySQL `booking_contestants` (filter on `validating_carrier`, `content_source`, `booking_status = 'BOOKED'`) | `search_hash` → MongoDB `debug_logs.transaction_id` for the full session |
| A session that hit a specific supplier error | ClickHouse `jupiter.jupiter_booking_errors_v2` (filter on `gds`, `booking_step`, `error_message`) | `search_id` → MongoDB `debug_logs.transaction_id` |
| A session whose supplier response had / lacked a specific field | MongoDB `ota.debug_logs` (`$match` on `context`, then check `Response` / `response`) | `transaction_id` → MySQL `booking_contestants.search_hash` |

Every such query carries a verification stamp per *Every query is verified before it ships* (Core principle). The point is to hand QA a real booking / route to replay, not to ask them to "find one yourself".

- **Smoke tests**: the simplest end-to-end exercise of each changed user-visible flow (one search → one book → one confirmation; one supplier per content source affected).
- **Happy-path flows**: scenarios the card description implies should now work, written as the user / agent journey (e.g. "search MTL→YYZ, add 1 checked bag, pay, confirm the bag appears on the ResPro page").
- **Edge cases**: inputs that exercise the boundary of the fix and can be reached either from a fresh search or by replaying a real prod case (see the query table above). Edge cases that cannot be reached either way go to Post-deployment instead.
- **Regression risks (user-visible only)**: other user / agent flows that touch the same UI surface, the same supplier, the same log shape, or the same ResPro page area. Frame each as the symptom the user or agent would see if it broke ("a non-baggage Dida booking still confirms and the totals on the ResPro page match the previous deploy"), never as the code path. When the regression needs a specific carrier / supplier combination, embed the query that finds one. If you cannot phrase a regression in user / agent / log terms, drop it.

**Post-deployment section** — checks after the fix is live in production. This is also where negative paths live when staging cannot reproduce them (stale flights, malformed identifiers, supplier outages). Each such check waits for real prod traffic to hit the case and confirms the observable response is the expected one; if no case is observed in the watch window, mark as "not observed" rather than blocking.

- **Production checks**: quick manual verifications observable to a human (open one live booking that previously failed, confirm the error is gone on the ResPro page).
- **Monitoring queries**: copy-pasteable MySQL / ClickHouse / Mongo snippets that measure the fix through user-visible symptoms — booking success rates, error-code counts, debug-log document shape, supplier response shape. Use a 1-hour or 24-hour window; label the window and timezone.

  Every query carries a verification stamp per *Every query is verified before it ships* (Core principle).
- **Rollback signals**: concrete conditions a human or a log query can spot — error rate climb, a new user-facing error string, missing field on the confirmation email, a debug-log document that no longer carries an expected key. One sentence each.
- **Watch window**: recommend how long to monitor before closing the card (default: 24 h for booking-path changes, 4 h for config-only changes).

### Step 4 — Output the strategy

Emit the strategy as a structured markdown block. **Every checklist item is formatted as a short bold name followed by a *Why:* line (skip only for one-line obvious smoke checks) and a numbered list of concrete steps** — never a single-line bullet, never a paragraph. The name reads like a test-case title (3–6 words). The *Why:* line is one or two plain-language sentences tying the check to the PR's diff. The steps are imperative, one action per line, and end with what a human or log query observes to mark the check pass.

```markdown
## QA Strategy — <Card title>

**PR:** <pr_url>
**Trello card:** <card_url>
**What changes for QA:** <one to three plain-language sentences. Describe the user-visible behaviour change, then list the surfaces QA should watch (search results page, checkout page, ResPro page, debug log for the checkout step, etc.). No code terms.>

**Note on fixtures:** Link to the staging if it's found in the Trello card or in the comments. 

---

### Staging

**Smoke tests**

- [ ] **<Short name>**
  1. <step>
  2. <step>
  3. <observable pass condition>

**Happy-path flows**

- [ ] **<Short name>**
  *Why:* <one or two sentences tying this check to the specific behaviour the PR changes — what would break if this check fails.>
  1. <step>
  2. <observable pass condition>

**Edge cases** (reachable from a fresh search or replayed from a real prod case)

- [ ] **<Short name>**
  *Why:* <…>
  *Find a case:* (only when the check needs a specific carrier / supplier / error / route — otherwise omit)
  ```sql
  -- e.g. find a recently booked itinerary on validating_carrier X, content_source Y
  -- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
  <query>
  ```
  1. Pick one row from the query above; note `route`, `departure_date`, `validating_carrier`, `content_source`.
  2. Reproduce the same search on staging.
  3. <observable pass condition>

**Regression risks (user-visible only)**

- [ ] **<Short name>**
  *Why:* <one or two sentences explaining why this journey could be affected — same supplier, same shared code, same surface — phrased in user / agent / log terms.>
  *Find a case:* (when the regression needs a specific carrier / supplier / route)
  ```sql
  -- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
  <query>
  ```
  1. <step>
  2. <observable pass condition that ties the journey back to the changed surface in plain user terms>

---

### Post-deployment

**Production checks**

- [ ] **<Short name>**
  *Why:* <…>  (skip for the generic "open one live booking and spot-check" check)
  1. <step>
  2. <observable pass condition>

- [ ] **<Negative-path check that needed a fixture on staging>**
  *Why:* <explain the new failure mode this PR introduces or surfaces, why staging can't reproduce it, and what observable behaviour we want to confirm when prod traffic hits it.>
  1. After deploy, watch prod logs for <natural condition that produces the case>.
  2. If such a case occurs, confirm <observable user / agent / log symptom>.
  3. If no such case is observed in the watch window, mark this check as "not observed" — do not block on it.

**Monitoring queries**

```sql
-- <label, window, timezone>
-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
<query>
```

```javascript
// <label, window>
// Field shape verified <YYYY-MM-DD> on live <collection>: <fields used and what they look like>.
// Run from mongosh.
<pipeline>
```

**Rollback signals**
- <user-visible or log-visible condition> → revert / escalate

**Watch window:** <N hours>
```

### Step 5 — Propose, wait for approval, then publish

The plan is **always proposed in chat first** and only published after the user approves. Never auto-publish, never skip the proposal.

1. **Propose.** Emit the full Step 4 markdown block in chat. End with one short question: "Approve and publish?" Do not pre-empt the user with edits, do not start publishing.
2. **Wait.** If the user requests changes, iterate in chat. Re-emit the full updated block each round so the latest version is the one they approve. Do not publish partial / interim versions.
3. **Publish (on approval).** Run two steps in order:
   1. **Create a Notion page** via the `notion_assistant` skill. Parent: Flighthub QA root (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`). Title: `QA Strategy — <card title> (PR #<number>)`. Body: the approved markdown block. Capture the page URL returned by `notion-create-pages`.
   2. **Append the Notion link to the bottom of the Trello card description** via the Trello REST API. Read the card's current `desc` first, then `PUT /1/cards/<id>` with `desc=<existing>\n\n---\n**QA Strategy:** <notion_url>`. The link goes in the description (not as a comment) so it lives with the card metadata and stays discoverable as comments accumulate.

      ```bash
      EXISTING=$(curl -s "https://api.trello.com/1/cards/<id>?fields=desc&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq -r .desc)
      curl -s -X PUT "https://api.trello.com/1/cards/<id>" \
        -d "key=$TRELLO_API_KEY" \
        -d "token=$TRELLO_TOKEN" \
        --data-urlencode "desc=${EXISTING}

---
**QA Strategy:** <notion_url>"
      ```

      Before appending, check the existing description for an existing `**QA Strategy:**` line; if one is already there, replace it in place rather than stacking duplicates.

4. **Report.** In chat, hand back the Notion URL and confirm the Trello card was updated.

If either publish step fails, surface the error verbatim and stop — do not attempt cleanup or retry on a different surface without explicit user direction.

## What not to do

Concrete rules not already stated by the Core principle, the Workflow steps, or `GLOSSARY.md`:

- **Forbidden-phrasing examples** (illustrating the glossary's "no code identifiers in prose" rule):
  - "`Mv_Ota_Air_Booker::createAncillaryServices()` — re-test existing factory-loaded baggage flow."
  - "`OptimizationResponseDto` must not break existing consumers."
  - "`Provider/Dida.php` shared abstract changes — spot-check one non-baggage Dida call."
  - "Older catalogue version `Service_StandaloneCatalogue_15_1` — confirm unaffected."

  Each one is replaced by the user / agent / log symptom it would produce.
- Do not hardcode staging URLs. Reference the environment by name (e.g. "staging", "UAT") and let the QA engineer supply the host.
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not create a Notion page outside the Flighthub QA root. Pass the root ID (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`) explicitly to `notion_assistant`; do not rely on its default.
- Do not post the Notion link as a Trello comment. It goes in the card `desc` (Step 5), de-duped against any prior `**QA Strategy:**` line.

## References

- GitHub MCP schema: inspect via `list_tools` on the `GitHub` server at session start if tool names are uncertain.
- Trello credentials and board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
- Reading genesis code for context on a large PR: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- Monitoring query patterns (MySQL bookability, ClickHouse errors): `.cursor/skills/bookability/SKILL.md`.
- Post-deploy monitoring loop (for longer tracking): `.cursor/skills/post_deploy_tracker/SKILL.md`.
- DB CLIs and schema docs (required for the query-verification step): [`../db_access/SKILL.md`](../db_access/SKILL.md) and `.cursor/skills/db_access/db-docs/<store>/`.
- Notion delivery (writes pinned to the Flighthub QA root): [`../notion_assistant/SKILL.md`](../notion_assistant/SKILL.md).
