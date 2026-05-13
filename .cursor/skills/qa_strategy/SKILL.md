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

Reading the PR (or the branch diff) is **mandatory** — the agent cannot write a useful plan without seeing what changed. But the diff is read to answer one question only: *what behaviour will a human or a log query notice differently after this change?* The output plan is written in terms of UI flows, agent screens, emails, and log shapes that QA can observe directly. Every checklist item must be something a human (end user or internal FH / JF agent) or a log query can verify without opening the codebase.

If a change has no user-visible, agent-visible, or log-visible effect (pure refactor, internal renames, comment-only edits), the plan says so explicitly and is short — it does not invent code-coverage checks to fill space.

## Scope (fixed)

| In scope | Out of scope |
|----------|--------------|
| What the **end user** sees: storefront search results, fare card, baggage / ancillary badges, checkout form, payment step, confirmation page, confirmation email | Internal class names, method names, abstract bases, DTOs, factories, refactor risks framed in code terms |
| What the **internal agent** sees: FH / JF admin order view, ticketing console, refund / exchange UI, agent-facing error banners | Whether a non-changed code path "shares a file" or "shares a parent class" with the change |
| What the **logs** show: `ota.debug_logs`, `ota.optimizer_logs`, supplier request / response payloads, ClickHouse error events, MySQL booking row state | Code-coverage-style sweeps ("re-test every caller of X") |
| Supplier / GDS behaviour as observed through logs and the agent UI (PNR shape, fare basis, baggage tags, ticket numbers) | API consumer contracts framed as "DTO X must not break consumers" — phrase those as the user/agent symptom instead |

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

**Staging section** — checks before the PR is merged or deployed to production:

- **Smoke tests**: the simplest end-to-end exercise of each changed user-visible flow (one search → one book → one confirmation; one supplier per content source affected).
- **Happy-path flows**: scenarios the card description implies should now work, written as the user / agent journey (e.g. "search MTL→YYZ, add 1 checked bag, pay, confirm the bag appears on the confirmation page and on the agent order view").
- **Edge cases**: inputs that exercise the boundary of the fix as seen by the user or agent (e.g. infant + adult mix on the pax form, currency mismatch shown to the user, supplier returning zero ancillaries shown as "no bags available").
- **Regression risks (user-visible only)**: other user / agent flows that touch the same UI surface, the same supplier, the same log shape, or the same agent screen. Frame each as the symptom the user or agent would see if it broke ("a non-baggage Dida booking still confirms and the confirmation email shows the same totals"), never as the code path. If you cannot phrase a regression in user / agent / log terms, drop it.

**Post-deployment section** — checks after the fix is live in production:

- **Production checks**: quick manual verifications observable to a human (open one live booking that previously failed, confirm the error is gone on the agent order view and the user confirmation page).
- **Monitoring queries**: copy-pasteable MySQL / ClickHouse / Mongo snippets that measure the fix through user-visible symptoms — booking success rates, error-code counts, debug-log document shape, supplier response shape. Use a 1-hour or 24-hour window; label the window and timezone.
- **Rollback signals**: concrete conditions a human or a log query can spot — error rate climb, a new user-facing error string, missing field on the confirmation email, a debug-log document that no longer carries an expected key. One sentence each.
- **Watch window**: recommend how long to monitor before closing the card (default: 24 h for booking-path changes, 4 h for config-only changes).

### Step 4 — Output the strategy

Emit the strategy as a structured markdown block:

```markdown
## QA Strategy — <Card title>

**PR:** <pr_url>
**User / agent / log surface that changed:** <comma-separated list of touchpoints from the Step 2 table — e.g. "checkout (baggage selection), confirmation email, agent order view, debug_logs ancillary block">

---

### Staging

**Smoke tests** (one end-to-end pass per affected supplier / content source)
- [ ] <concrete user-visible step>

**Happy-path flows** (the journey the card promises)
- [ ] <concrete user / agent journey, with what to verify on screen and in the email>

**Edge cases** (boundary inputs as the user / agent sees them)
- [ ] <concrete user / agent step>

**Regression risks (user-visible only)** (other journeys that share the same UI surface, supplier, agent screen, or log shape)
- [ ] <user / agent symptom to confirm is unchanged> — <one-line why this journey could be affected, phrased in user / agent / log terms>

---

### Post-deployment

**Production checks** (observable by a human on real bookings)
- [ ] <concrete user-facing or agent-facing verification>

**Monitoring queries** (measure user-visible symptoms via logs / DB)

```sql
-- <label, window, timezone>
<query>
```

**Rollback signals** (what a human or a log query would notice)
- <user-visible or log-visible condition> → revert / escalate

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

- **Do not write checklist items in code terms.** No class names, method signatures, abstract bases, factories, DTOs, namespaces, or file paths in the output. The agent reading the plan must be able to execute every item without opening the repo. Counter-examples (forbidden phrasing):
  - "`Mv_Ota_Air_Booker::createAncillaryServices()` — re-test existing factory-loaded baggage flow."
  - "`OptimizationResponseDto` must not break existing consumers."
  - "`Provider/Dida.php` shared abstract changes — spot-check one non-baggage Dida call."
  - "Older catalogue version `Service_StandaloneCatalogue_15_1` — confirm unaffected."

  Replace each with the user / agent / log symptom it would produce — e.g. "book one non-baggage Dida itinerary end-to-end; confirm the confirmation page totals and the agent order view match the previous deploy", "search a fare that historically used the older Amadeus catalogue and confirm baggage badges still render".
- Do not invent test cases for files not in the PR diff. Every checklist item must trace back to a changed file **and** a user / agent / log touchpoint.
- Do not list a "regression risk" you cannot phrase as a user-visible, agent-visible, or log-visible symptom. If it only matters to a developer reading code, drop it.
- Do not hardcode staging URLs. Reference the environment by name (e.g. "staging", "UAT") and let the QA engineer supply the host.
- Do not post the strategy as a comment unless `--mode comment` is explicitly set or the user asks.
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not add ownership / assignment fields to the output. No `QA owner`, `Assignee`, `Tester`, `Reviewer`, `Due date`, or similar header lines. Plan is workflow content only; ownership lives on the Trello card itself.
- Do not skip Step 1 — the card description is required context; a PR diff alone does not capture the intent.
- Do not skip Step 2 either. Reading the PR / branch diff is mandatory — the agent has to know what behaviour changed before writing the plan. "I'll just trust the card description" produces generic, useless plans.
- Do not write the plan from the file path list alone. Read the diff hunks (or, for large PRs, read the most-changed files via `codebase_access`) so the plan reflects actual behaviour change, not guessed intent.
- Do not call `get_pull_request_diff` for large PRs (>50 files); rely on `get_pull_request_files` plus targeted file reads via `codebase_access`.

## References

- GitHub MCP schema: inspect via `list_tools` on the `GitHub` server at session start if tool names are uncertain.
- Trello credentials and board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
- Reading genesis code for context on a large PR: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- Monitoring query patterns (MySQL bookability, ClickHouse errors): `.cursor/skills/bookability/SKILL.md`.
- Post-deploy monitoring loop (for longer tracking): `.cursor/skills/post_deploy_tracker/SKILL.md`.
