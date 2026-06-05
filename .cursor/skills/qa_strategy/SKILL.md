---
name: qa-strategy
description: >-
  Use when the user wants a QA strategy, test plan, or staging /
  post-deploy checklist derived from a Trello card and its linked PR —
  trigger phrases: "QA strategy for this card", "test plan for",
  "staging checklist", "post-deploy checks", "what to QA on <card
  link>".
---

# QA Strategy Generator

Given a Trello card and its linked PR, produce a structured QA strategy — what to test on staging before merging, and what to watch in production after deploy.

## Core principle

**Read the code. Test the functionality.**

Reading the PR (or branch diff) is **mandatory**. The diff is read to answer one question: *what behaviour will a human or a log query notice differently after this change?* The output plan is written in terms of UI flows, internal screens, emails, and log shapes QA can observe directly — every checklist item must be verifiable without opening the codebase. If a change has no user-visible, agent-visible, or log-visible effect, the plan says so explicitly and stays short.

### Brevity over completeness

The shorter the plan, the more likely QA reads and runs every item. Default to the minimum viable plan. Cut every check that does not change QA's next action. For a small change, three checks total can be the right answer — don't pad the optional sections to look thorough. If a section has nothing to add, drop the section header entirely.

### Plain ESL wording

Write the plan in short, plain sentences with everyday verbs. Prefer "we will not verify them manually" over "we do not sweep them by hand"; prefer "the log no longer fills with duplicate lines" over "the log stops repeating entries". No idioms, no metaphors ("sweep", "blast radius", "in flight", "land cleanly"), no Latin abbreviations, no playful phrasing.

### Scope discipline

Every checklist item traces to a file in the diff **and** a user / agent / log surface that file modifies. If the PR only touches the availability-check step, don't add checks for the confirmation page or seat selection just because they sit downstream. Drop anything you can't tie back.

### No code-level red flags in the plan

Debug toggles flipped on, unconditional bypasses, commented-out guards, leftover `dd()` / `var_dump` — surface those in the chat reply outside the plan block. The plan is QA workflow, not code review.

### No staging fixtures — lean on production cases or the package-transfer tool

We don't maintain staging fixtures for malformed, stale, or contrived inputs. Any check that needs a specific input (a particular carrier, a stale package, a specific error signature, a multi-passenger / multi-PNR shape) is reproduced on staging through one of two paths, **in this order**:

1. **Find a production case and replay the same search on staging.** The plan embeds a `**Find a case:**` query that returns a real prod row with the condition; the steps then describe how to drive the same search on staging.
2. **If a fresh search will not reproduce the condition** (a stale package, a different-price re-quote, an unavailable response, a specific package the user already chose), **use the package-transfer tool** at https://summit.flighthub.com/tools/package-transfer. Pick the prod row, transfer the package onto the staging environment, then walk through checkout. The supplier is called live against the transferred shape and exercises the changed code path.

Only when **both** paths fail — no representative prod row exists, and the package-transfer tool cannot recreate the condition — move the check to Post-deployment and frame it as: *"watch prod for sessions where <natural condition>; if such a session occurs, confirm <expected user / agent / log symptom>. If not observed in the watch window, mark as 'not observed' — do not block on it."* The post-deploy watch is the last resort, not the default.

### Each check must trigger the specific logic it claims to verify

Before writing the steps for any check, answer: *what condition does the changed code require to execute?* If the answer is "more than one passenger with a distinct PNR", "a stale package that re-quotes at a different price", "a fare with the `XYZ` tag", "an unavailable response from the supplier" — the steps must produce that condition. Never write "use the booking from the smoke test" for a check that only fires under a condition the smoke booking does not hit.

Apply the test: read the check's *Why:* line, then re-read its steps. If the steps could pass on a booking that does not satisfy the condition the *Why:* describes, the check is broken — either change the steps to drive the condition (prod-row replay or package-transfer), fold the check into another booking that already has the condition (see *Bundle checks that share a booking* below), or drop the check.

### Bundle checks that share a booking into one block

When several checks can be done with the same booking attempt present them as **one** booking with N ordered observations, never N separate bookings. QA runs one booking; the plan reads as a single block; nothing is duplicated.

Use a `**Booking and observations:**` block. The booking is described once at the top (driver / route / passengers / supplier / any condition the booking has to satisfy); each observation is a sub-bullet with its own *Why:* line and pass condition.

```markdown
- [ ] **<Short name for the bundle, e.g. "FR24 multi-PNR booking + post-issuance observations">**
  *Why:* <one or two sentences tying the bundle to the PR's diff — name the condition the booking must satisfy>
  **Booking and observations:**
  1. Drive one FR24 booking on staging94 with <route / passenger config / condition>. Note the booking_id.
  2. On the ResPro page for that booking, observe:
     - **<Observation 1 short name>** — *Why:* … — <observable pass condition>.
     - **<Observation 2 short name>** — *Why:* … — <observable pass condition>.
  3. In the debug log group for the booking_id, observe:
     - **<Observation 3 short name>** — *Why:* … — <observable pass condition / row-count expectation>.
  4. Open the confirmation email sent to the passenger address:
     - **<Observation 4 short name>** — *Why:* … — <observable pass condition>.
```

Only split into separate checks when the bookings must differ in a way the bundle cannot accommodate (different supplier, different passenger count when that *is* the condition under test, different staging environment). Two checks that need the same shape of booking are always a single bundle.

### A *Why:* line on each non-trivial check

Every checklist item that isn't a one-line smoke check carries a one-or-two-sentence *Why:* line under the bold name, tying the check to the PR's diff in plain user / agent / log terms — "this is the back-fill the PR removed", "this is the new short-circuit the PR introduced".

Describe the **behaviour change and the observable risk — never the code mechanics**. QA reads this line; phrases like "untyped writer", "push/pop in a try/finally", "closure-style scope helper", "memoized lookup", "early return", "backtrace", "request/response DTO" name *how the code was rewritten* and tell QA nothing to watch for. The "no code identifiers" rule (`GLOSSARY.md`) bans the names; this bans the jargon. Translate the mechanic into what it produces:

- Not "switched to a typed document writer that adds a backtrace" → "the supplier request/response is still logged, now with more diagnostic detail".
- Not "rewrote the call site as an explicit push/pop in a try/finally" → "the availability call was restructured — confirm its logs still open and close cleanly, with no scope left dangling".
- Not "the PR memoizes the ticket lookup" → "the ticket lookup now runs once instead of repeating — the log should stop filling with duplicate lines".

One carve-out: a supplier API operation name that literally appears in the debug-log context (the string QA sees in the log group) is a log-surface term — use it in backticks when it helps QA find the entry. A class that merely shares that name is not.

#### No method or class names in *Why:* lines

The "no code identifiers in prose" rule from `GLOSSARY.md` extends to *Why:* lines literally. Method names and class names cannot stand in for "what the PR changed", even when they feel concise. QA does not read code; a *Why:* line built around `getSegmentPnrs`, `isOnefly()`, `actionValidatePackageDeeply`, `hasTickets`, `Throwable` tells them nothing they can verify.

Translate the identifier into the observable it produces:

- Not "*Why:* this is the back-fill `getSegmentPnrs` adds" → "*Why:* the per-segment airline PNR row on the ResPro page is now populated when the supplier returned per-passenger PNRs".
- Not "*Why:* the `isOnefly()` gate keeps other suppliers out of the new path" → "*Why:* only Onefly checkouts hit the new check availability path; other suppliers are unchanged — a sanity booking on another supplier confirms its `debug_logs` group is the same shape as before the PR".
- Not "*Why:* this is the new scope the PR pushes around `actionValidatePackageDeeply`" → "*Why:* the deep re-check step on a non-Kiwi package routed through Kiwi now writes its debug-log entries with the `Deep Check Flights` scope attached".
- Not "*Why:* the `hasTickets` branch returns early when no tickets exist" → "*Why:* a booking issued seconds ago with no ticket numbers yet must still load on the ResPro page without an error banner".

The same rule applies to **pass conditions** under the numbered steps — a step ending in "confirm `getTickets()` returns the populated array" is wrong; "confirm the ResPro page shows the ticket number for each passenger" is right.

#### No code-path verbs in pass conditions

QA cannot verify that a code path *ran*; they can only verify what they *see*. Pass conditions and *Why:* lines built around code-path verbs are unobservable and let regressions through. **Banned verbs (and equivalents):** *exercises*, *enters*, *hits*, *runs through*, *executes*, *goes through*, *triggers the branch*, *reaches the code*, *invokes*, *calls into*. These describe execution, not a symptom QA can confirm on a page, in a log, in a row, or in an email.

Translate the execution into the observable it produces:

- Not "*Why:* one booking exercises the entry into the new branch" → "*Why:* the `debug_logs` group for the smoke `booking_id` contains exactly one entry whose `context` starts with `Onefly::check-availability` and ends in `::Success`".
- Not "pass: the request enters the new dispatcher" → "pass: the `debug_logs` entry for `<context>` shows `_scopes` containing `Check Availability` for this `search_id`".
- Not "pass: the call hits the updated wrapper" → "pass: the supplier response payload in the `<context>` entry now has the `<field>` key populated".
- Not "pass: the failure path triggers" → "pass: the `optimizer_candidates` row for the attempt shows `status='dropped'` and a sibling row with a different `candidate_id` was created".

If a check genuinely has no observable symptom — the change is internal and produces no user / agent / log surface — the check does not belong in the plan. Drop it, or rewrite it as a code-review concern in run-notes.

### Staging shares the data stores with production

ClickHouse, MySQL `ota`, and Mongo `ota` are shared across production and every staging environment. Treat this as ambient knowledge — **do not surface it in the plan output, do not add a "Shared databases" header, do not explain it to QA**. Instead, write queries that work correctly under that constraint:

- Any staging-side check that reads a shared store must be pinned to the concrete `search_id`, `booking_id`, `transaction_id`, or equivalent identifier produced by the staging action — never an aggregate over a time window. Capture the identifier as an explicit step in the checklist before the query runs.
- Aggregate / time-window queries are allowed only in the **Post-deployment** section, where production volume dominates and staging traffic is negligible.
- If a staging check genuinely needs an aggregate (e.g. "did supplier X get called at all on staging"), reframe it as a per-`search_id` row count instead.

### Every query is verified before it ships

Applies to every query in the plan — locator queries inside staging checks, monitoring queries, prod-watch queries. Before pasting any query into the plan, Notion page, or Trello card:

1. Open `.cursor/skills/db_access/db-docs/<store>/<name>.md` and confirm every referenced column / field exists with the expected type. If the doc is missing, write it (per the `db_access` skill) before continuing.
2. Confirm the literal filter values by running a tiny `SELECT DISTINCT col LIMIT 50` (or Mongo equivalent) via the `db_access` CLI scripts.
3. Run the query against a recent window. The result must come back non-empty and shaped as expected. Paste a stamp next to the query: `-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.`

   If no representative row exists in a recent window (the fixed condition is now rare or zero), confirm the schema and the literal filter values instead, then downgrade the stamp so the gap is explicit — never imply a populated result you did not see: `-- Schema-confirmed only <YYYY-MM-DD> against <table> (no representative row in last N days; <columns> + filter values verified).`

If verification fails (store unreachable, table missing, no recent data), drop the query and state the limitation in prose.

## When to use

- User points at a Trello card and asks for a test plan, QA strategy, staging checklist, or post-deploy checks.
- Another skill (e.g. `trello_assistant` closing ritual) needs a ready-made test plan to attach to a card.

## When NOT to use

- User wants to **run** a test booking end-to-end → use `qa_assistant`.
- User wants to verify a deploy over time → use `post_deploy_tracker`.
- No card and no PR; user is asking generically about QA practices.

## Inputs

| Input | How to get it |
|-------|---------------|
| Trello card URL or shortLink | Required |
| GitHub repo | Default `mventures/genesis`; accept override |

## Tooling

- **Trello REST API** — `GET /1/cards/<id>?attachments=true&actions=commentCard` to read the card. Credentials `TRELLO_API_KEY` / `TRELLO_TOKEN` from `.env`. Base URL `https://api.trello.com/1/`.
- **GitHub MCP** (`GitHub` server) — `get_pull_request`, `get_pull_request_files`, `get_pull_request_diff` (PRs ≤ 50 files). Reading diff content (not just file paths) is mandatory for small / medium PRs.
- **Package-transfer tool** — https://summit.flighthub.com/tools/package-transfer. Takes a real production package and re-issues it onto a staging environment as a **checkout state**. Use it to force conditions that a fresh staging search will not produce on the **check availability call**: a stale package (so the supplier returns a different price or "unavailable" on the staging check availability call), a specific carrier / fare basis / route, a multi-passenger configuration that staging traffic rarely creates. The transferred package keeps its production shape; checkout on staging then drives the live supplier with that shape against the changed code path.

  **Scope discipline — the tool produces a checkout, not a booking.** It drives the supplier on the check availability call only. It never creates a booking, never produces a `bookings` row, and cannot reproduce any state that exists only after booking submit or after ticketing — no post-issuance state, no `bookings.status='issued'`, no `booking_segments.control_number` shape, no confirmation email, no post-booking debug logs. Any check that needs a state past the checkout page must drive a real booking end-to-end on staging, or move to a Post-deployment watch on production.

## Workflow

### Step 1 — Read the card

`GET /1/cards/<shortLink>?actions=commentCard&fields=name,desc,url`. Extract title, description, and PR URLs from `desc` and `actions[].data.text` (match `github.com/.+/pull/\d+`).

Also capture any staging URL mentioned on the card or in comments — it goes into the plan header so QA doesn't have to hunt for it.

If no PR URL is found, ask the user to paste one before proceeding. Do not guess.

### Step 2 — Read the PR / branch (mandatory)

For each linked PR (no cap — the published page lists every PR the card carries on the header line, comma-separated; all linked PRs are read at this step too):

```
get_pull_request(owner, repo, pull_number)
get_pull_request_files(owner, repo, pull_number)
get_pull_request_diff(owner, repo, pull_number)   # PRs ≤ 50 files only
```

For PRs > 50 files: skip `get_pull_request_diff` and rely on `get_pull_request_files` plus targeted reads via `codebase_access`. For a branch with no PR yet, use `compare_commits(owner, repo, base, head)` and read the resulting diff the same way.

When the card links many PRs, read each one's diff at this step — there is no cap. If diff fetching across all of them blows the context window for a particular PR (e.g. a single PR > 50 files), apply the `get_pull_request_files`-only fallback to that PR alone; do not drop other PRs from the analysis.

Read the **substantive code changes**, not the file paths alone. For each meaningful cluster of changed files, answer three questions in canonical glossary terms (see `GLOSSARY.md`):

1. **What does the end user see differently?** (search results page, checkout page, the check availability call, confirmation page, confirmation email, error messages, fallback behaviour)
2. **What does the internal agent see differently on the ResPro page?** (order details, segments, fare basis, ticketing view, refund / exchange UI, queue / status fields)
3. **What does the log shape change?** (new / removed fields in `ota.debug_logs` or `ota.optimizer_logs`, supplier request / response payload diffs, new ClickHouse error codes, new MySQL row states)

If a changed file maps to none of these, it does not generate a checklist item — code-only refactors are out of scope.

#### Validate every pass condition against how the flow actually behaves

Before writing a check, confirm the *expected* user / agent / log outcome matches the real flow. The plan is wrong when it asserts behaviour the system does not have, even if the steps run cleanly. Known traps — re-check the code (via `codebase_access`) and the debug logs whenever a check touches any of these surfaces:

- **Check availability does not change the price shown or charged to the user.** The price agreed at search stands. A pass condition like "the new repriced total appears on checkout" is wrong — the user never sees a re-price. If the supplier returns a different price, the agent path is to drop the contestant and let the optimizer try another, not to re-prompt the user.
- **"Flight no longer available" does not block the booking.** On an unavailable response from check availability, the flow falls through to the optimizer and the original contestant is excluded from retry. A pass condition like "the user is blocked with an error" is wrong — the correct condition is "the original contestant is not retried; the optimizer attempts another contestant; the user either gets a different fare or, only after all contestants are exhausted, sees no-availability".
- **A failure before the `bookings` row is written does not show up in `bookings`.** Pre-booking failures (during contestant attempts) are visible only on the **contestant-attempts** surface. A check that watches `bookings` for "did the booking fail" will miss them — see Step 3 production checks.

When in doubt, open the relevant code path (`Mv/Ota/Air/Booker/Optimizer.php`, the check-availability dispatcher for the content source) or grep recent `debug_logs` to see the actual outcome shape. Phrase the pass condition in the words a QA reader would observe — the page they land on, the field they see on ResPro, the row count they expect from a log query.

### Step 3 — Derive the strategy

Map the diff-derived surface to test scenarios. When a check needs a **specific** input — a particular carrier on a particular content source, a fare basis with a tag, a session that hit a specific error — embed a concrete prod-DB query that finds a real example, so QA can pick one and reproduce on staging:

| What to find | Where to query | Joinable to |
|--------------|----------------|-------------|
| A booked itinerary on carrier X with content source Y | MySQL `booking_contestants` (`validating_carrier`, `content_source`, `booking_status = 'BOOKED'`) | `search_hash` → MongoDB `debug_logs.transaction_id` |
| A **contestant attempt** (success or pre-booking failure) on content source Y | MySQL `bookability_contestant_attempts` joined to `booking_contestants` (see `bookability` skill and `.cursor/skills/db_access/db-docs/mysql/bookability_contestant_attempts.md`) — captures attempts that never reached the `bookings` table | `search_hash` → MongoDB `debug_logs.transaction_id` |
| A session that hit a specific supplier error | ClickHouse `jupiter.jupiter_booking_errors_v2` (`gds`, `booking_step`, `error_message`) | `search_id` → MongoDB `debug_logs.transaction_id` |
| A session whose supplier response had / lacked a specific field | MongoDB `ota.debug_logs` (`$match` on `context`, then check `Response` / `response`) | `transaction_id` → MySQL `booking_contestants.search_hash` |

**Staging section** — only flows that can be driven from a fresh search on staging, replayed from a real prod case, or forced via the package-transfer tool. Apply the *Each check must trigger the specific logic it claims to verify* rule and the *Bundle checks that share a booking* rule from above before listing checks here:

- **Smoke tests** — one end-to-end per affected content source. If one of the checks below requires a specific booking shape (multi-PNR, multi-passenger, multi-ticket), make the smoke booking itself satisfy that shape and bundle the dependent checks as observations on it — don't write a generic smoke plus a separate "now do it again with multi-PNR" check.
- **Happy-path flows** — the journey the card promises.
- **Edge cases** — boundary inputs reachable from a fresh search, by replaying a prod case, or by transferring a prod package onto staging. Anything that none of those three paths can reach moves to Post-deployment.
- **Regression risks (user-visible only)** — other journeys sharing the same UI surface, supplier, log shape, or ResPro page area. Phrase each as a symptom; embed a locator query when a specific carrier / supplier is needed. If you can't phrase a regression in observable terms, drop it. A **broad "is everything else still fine" sweep** that exists only because the PR touches shared code (e.g. "confirm all other content sources still search and book") is not a checklist item — it is a blast-radius note. Put it in the **Notes for QA** header instead, so the agent treats it as context, not a test to run.

**Post-deployment section** — checks after the fix is live. Also where negative paths land when staging can't reproduce them:

- **Production checks** — human verifications observable on real bookings. A spot-check ("confirm the first real booking after deploy") must come with a query that surfaces recent **contestant attempts** on the affected surface — both successes and failures — so QA can see at a glance whether attempts are failing and pick a real attempt to validate. Read the **contestant-attempts** surface (MySQL `bookability_contestant_attempts` joined to `booking_contestants` — see the `bookability` skill for the canonical CTE), **not** `bookings` alone: a failure that happens *before* a `bookings` row is written (auth error, supplier 500 on price, malformed availability response) leaves nothing in `bookings` and is invisible to a `bookings`-only query. Never write "pick a booking" without the attempts query that finds it.
- **Monitoring queries** — copy-pasteable MySQL / ClickHouse / Mongo snippets, 1-hour or 24-hour window, label window + timezone. State the healthy vs unhealthy shape in the query comment (e.g. `-- healthy after deploy: 0 rows; any row = the fix did not land — revert / escalate`), so the revert signal travels with the query instead of in a separate section.

#### Cross-content-source coverage for shared log contexts

When the changed code path runs for more than one content source — e.g. a log context like `*::check-availability-response` or `*::check-availability-comparison-report` that fires for every supplier, a shared dispatcher, an abstract base — the plan **must** add an explicit verification case for at least one other content source, not just the supplier named on the card. The pass condition is the same observable shape; only the supplier filter changes. Skip this only when the diff is provably scoped to one supplier's adapter (e.g. `Provider/Kiwi.php` with no shared call site changed).

### Step 4 — Output the strategy

Every checklist item is **bold short name** (3–6 words) + (when not trivial) a *Why:* line + numbered concrete steps + an observable pass condition. No single-line bullets, no paragraphs.

When a check needs a specific real-world case (carrier / supplier / error / route), include a `**Find a case:**` block with a verification-stamped query, then refer to its output in the steps:

```markdown
- [ ] **<Short name>**
  *Why:* <one or two sentences tying this check to the PR's diff>
  **Find a case:** (only when needed — omit otherwise)
  ```sql
  -- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
  <query>
  ```
  1. Pick one row from the query above; note <fields>.
  2. Reproduce the same search on staging.
  3. <observable pass condition>
```

Full plan template (chat-preview shape — plain markdown only, no Notion-only decorations). This is what the reviewer sees during Step 5. The published Notion page applies the styling conventions in Step 5; **do not** include `<callout>`, `<details>`, `{toggle="true"}`, or `<span color=…>` tags in the preview.

```markdown
## QA Strategy — <Card title>

**PR:** <pr_url_1>, <pr_url_2>, …    ← every PR linked from the card, comma-separated; no cap
**Trello card:** <card_url>
**Staging:** <staging URL from card / comments — omit the line if none>

**What changes for QA:** <one to three plain-language sentences. List the surfaces to watch (search results page, checkout page, ResPro page, debug log, etc.). No code terms.>

**Notes for QA:** <optional — staging limitations and shared-code context that are NOT tests: "this PR touches shared code, so other content sources are in scope but we will not verify them manually", "multi-ticket cannot be reproduced on staging". Omit the line if there are none.>

**Baseline (<date>, <window>):** <optional one-liner — the current pre-deploy rate / count the fix is expected to move. Omit the line when there is no measurable baseline.>

---

### Staging

**Smoke tests**

- [ ] **<Short name>**
  1. <step>
  2. **PASS:** <observable pass condition>

**Happy-path flows**

- [ ] **<Short name>**
  *Why:* <one or two sentences tying this check to the PR's diff>
  1. <step>
  2. <step>
  3. **PASS:** <observable pass condition>
  📎 <optional label>: <debug-log permalink>

**Edge cases** (reachable from a fresh search, replayed from a real prod case, or forced via the package-transfer tool)

- [ ] **<Short name>** + *Why:* + optional **Find a case:** + steps + **PASS:** <observable pass condition>

**Regression risks (user-visible only)**

- [ ] **<Short name>** + *Why:* + optional **Find a case:** + steps + **PASS:** <observable pass condition>

---

### Post-deployment

**Production checks**

- [ ] **<Short name>** + (*Why:* unless it's a generic spot check) + steps + **PASS:** <observable pass condition>
  **Find the attempts:** (required for any "spot-check a real booking" item — reads `bookability_contestant_attempts`, not `bookings`, so pre-booking failures are visible)
  ```sql
  -- Recent contestant attempts on the affected surface — successes + failures — last N hours.
  -- Reads bookability_contestant_attempts joined to booking_contestants (see bookability skill).
  -- Verified <YYYY-MM-DD> against bookability_contestant_attempts, returned <N rows / shape summary>.
  <query that lists recent contestant attempts with their final status>
  ```
  1. Run the query; confirm attempts are not failing in bulk.
  2. Open the first successful attempt's booking on the ResPro page; confirm <observable pass condition>.
  3. Open one failed attempt (if any); confirm the failure reason matches an expected mode, not the change under test.

- [ ] **<Negative-path check that staging couldn't reach>**
  *Why:* <new failure mode, why staging can't reproduce, what observable behaviour to confirm>
  1. After deploy, watch prod for <natural condition>.
  2. If such a case occurs, confirm <observable symptom>.
  3. If not observed in the watch window, mark "not observed" — do not block.

---

### Monitoring queries

**<one-line title for the first query — what / window / timezone>**

```sql
-- <label, window, timezone>
-- healthy after deploy: <expected shape>; <unhealthy shape> → revert / escalate.
-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
<query>
```

**<one-line title for the next query>**

```javascript
// ota.debug_logs — Compass aggregation. Last 6h. UTC.
// Field shape verified <YYYY-MM-DD> against ota.debug_logs (context, date_added).
// healthy after deploy: <expected shape>; <unhealthy shape> → revert / escalate.
[
  { $match: {
      context: { $regex: "^Onefly::check-availability", $options: "i" },
      date_added: { $gt: new Date(Date.now() - 6*3600*1000) }
  } },
  { $group: { _id: "$context", c: { $sum: 1 } } },
  { $sort: { c: -1 } }
]
```
```

Mongo blocks stay **bare aggregation-pipeline arrays** so QA can paste them straight into MongoDB Compass — never `db.collection.aggregate(...)`, never `db.collection.find(...)`, no surrounding shell wrapper. State the target collection in the comment above the array. Window expressions like `new Date(Date.now() - N*3600*1000)` are fine because Compass evaluates them.

Section ordering is fixed: Staging → Post-deployment → Monitoring queries. Drop a whole section, or any subsection, when it has zero items. The plan never carries a Rollback signals section, a progress bar, or per-section counters — healthy-vs-unhealthy expectations live inside each monitoring query's comment header.

### Step 5 — Propose, wait for approval, then publish

The plan is **always proposed in chat first** and only published after approval. Never auto-publish.

1. **Propose.** Emit the Step 4 chat-preview markdown in chat. End with: *"Approve and publish?"* Do not pre-empt with edits. Do not include any Notion-only tags (`<callout>`, `<details>`, `{toggle="true"}`, `<span color=…>`) in the preview — those are applied at publish per the *Notion render rules* table below.
2. **Iterate.** If the user wants changes, update and re-emit the full chat-preview block.
3. **Publish (on approval).**

   1. **Find the target Notion page.** Fetch the current Trello card `desc` (`GET /1/cards/<id>?fields=desc`). If `desc` contains a `**QA Strategy:** <notion_url>` line, parse the page ID from the URL and call `notion-fetch` on it. If the fetch succeeds **and** the page's `parent` chain still leads back to the Flighthub QA root (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`), treat this as an in-place update. Otherwise (no prior line, fetch fails, or the page moved out of the QA root), treat this as a first publish.
   2. **Render the page body.** Convert the approved chat preview into the Notion-native form per the *Notion render rules* table below. The body **never** includes the `## QA Strategy — …` title line — Notion's `title` property carries it.
   3. **Publish.**
      - **First publish:** call `notion-create-pages` with `parent.page_id = 35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`, `properties.title = "QA Strategy — <card title>"`, `icon = "🧪"`, `content = <rendered body>`. Capture the page URL.
      - **In-place update:** call `notion-update-page` with `command = "replace_content"`, `page_id = <parsed id>`, `new_str = <rendered body>`. Page title and icon are left untouched. The full body is wiped and replaced — no carve-out for ticked `to_do` boxes or human-added comments. Notion's per-page revision history is the recovery surface; surface it explicitly when the user asks "where did my edits go?".
   4. **Refresh the Notion link in the Trello card `desc`** — never as a comment. The append is idempotent: any prior `**QA Strategy:** <url>` line (and its preceding `---` separator) is stripped before the new link is added.

      Algorithm:
      1. Fetch the current `desc` via `GET /1/cards/<id>?fields=desc`.
      2. Strip any existing `**QA Strategy:** <url>` line and the `---` separator immediately above it.
      3. Append `\n\n---\n**QA Strategy:** <notion_url>` to the cleaned desc.
      4. `PUT /1/cards/<id>` with the new `desc`.

      Reference shell:
      ```bash
      EXISTING=$(curl -s "https://api.trello.com/1/cards/<id>?fields=desc&key=$TRELLO_API_KEY&token=$TRELLO_TOKEN" | jq -r .desc)
      CLEANED=$(python3 -c 'import re,sys; d=sys.stdin.read(); print(re.sub(r"\n*---\n\*\*QA Strategy:\*\*[^\n]*\n?","",d).rstrip())' <<< "$EXISTING")
      curl -s -X PUT "https://api.trello.com/1/cards/<id>" \
        -d "key=$TRELLO_API_KEY" -d "token=$TRELLO_TOKEN" \
        --data-urlencode "desc=${CLEANED}

---
**QA Strategy:** <notion_url>"
      ```

4. **Report.** Hand back the Notion URL in chat. Say whether this was a first publish or an in-place update so the reviewer knows whether previous human edits were wiped from the live view (still recoverable from page history).

If any publish step fails, surface the error verbatim and stop. Don't retry on a different surface without user direction.

#### Notion render rules (publish-time decorations)

These are applied mechanically when the chat-preview markdown is converted into the Notion page body. The reviewer does not see them per-card; the conventions are pinned here.

| Preview element | Notion render |
|---|---|
| `## QA Strategy — <Card title>` (preview only) | Notion page `title` property + page icon `🧪`. **Not** written into the body. |
| `**PR:** <link>, <link>, …` / `**Trello card:** <link>` / `**Staging:** <link>` | three `paragraph` lines at the very top of the body, kept as bold-labelled rich text. Drop the Staging line if the preview omits it. |
| `**What changes for QA:** <text>` | `<callout icon="💡" color="blue_bg">` with **What changes for QA** as bold first line + the text body. |
| `**Notes for QA:** <text>` | `<callout icon="📝" color="gray_bg">` with **Notes for QA** as bold first line + the text body. Omit the callout entirely when the preview line is absent. |
| `**Baseline (…):** <text>` | `<callout icon="📊" color="yellow_bg">` with **Baseline (…)** as bold first line + the text body. Omit when absent. |
| `---` separator after the header | drop — the toggles below provide the visual break. |
| `### Staging` / `### Post-deployment` / `### Monitoring queries` (preview H3) | `## <Section> {toggle="true"}` — three peer top-level toggle headings, in this fixed order. |
| `**Smoke tests**` / `**Happy-path flows**` / `**Edge cases**` / `**Regression risks**` (preview bold lines under `### Staging`); `**Production checks**` (preview bold line under `### Post-deployment`) | `### <Subsection>` headings nested inside the parent toggle. Drop the subsection heading entirely when it has no items. |
| `- [ ] **<Short name>**` / `- [x] **<Short name>**` | `to_do` block (unchecked / checked) at the top of the check. |
| `*Why:* <text>` (nested under the to_do) | italic `paragraph` indented under the `to_do`. |
| Numbered steps (nested under the to_do) | `numbered_list_item` blocks indented under the `to_do`. |
| `**PASS:** <condition>` (final step's trailing clause) | wrap the trailing pass clause as `<span color="green_bg">**PASS:** <condition></span>` — applied to the pass text, not to the whole step. |
| `📎 <label>: <link>` (nested under the to_do) | plain `paragraph` under the `to_do`, the 📎 emoji kept literal. |
| Fenced ```` ```sql ```` / ```` ```javascript ```` block (under a check or under `### Monitoring queries`) | Notion `code` block with the same language. Notion supplies its own copy button and syntax highlighting; do not add a custom one. |
| `**<one-line monitoring query title>**` line above a code block (under `### Monitoring queries`) | `paragraph` with bold rich-text directly above the code block; no heading. |

Page title: `QA Strategy — <Card title>` — no PR suffix, no branch suffix, regardless of how many PRs the card carries.

Multi-PR header: every PR URL the card carries is listed on the `**PR:**` line, comma-separated. No cap. Order matches the order the PRs appear in the card's `desc` / comments.

## What not to do

Concrete rules not already stated by Core principle, Workflow, or `GLOSSARY.md`:

- **Forbidden-phrasing examples** (illustrating the glossary's "no code identifiers in prose" rule). Each is replaced by the user / agent / log symptom it would produce.
  - "`Mv_Ota_Air_Booker::createAncillaryServices()` — re-test existing factory-loaded baggage flow."
  - "`OptimizationResponseDto` must not break existing consumers."
  - "`Provider/Dida.php` shared abstract changes — spot-check one non-baggage Dida call."
  - "Older catalogue version `Service_StandaloneCatalogue_15_1` — confirm unaffected."

- **Banned glossary terms.** Do not write `storefront` or `storefront page` anywhere in the plan (header lines, *Why:* lines, steps, Notes for QA, Notion title). Use the specific page name (`search results page`, `checkout page`, `confirmation page`) or "FlightHub / JustFly". See [`../../../GLOSSARY.md`](../../../GLOSSARY.md) for the full banned-terms list.

- **No `db.collection.aggregate(...)` / `db.collection.find(...)` Mongo blocks.** Mongo blocks are bare aggregation-pipeline arrays so QA can paste them into MongoDB Compass — see the example in Step 4.

- **No `bookings`-only post-deploy spot-check.** Pre-booking failures leave no row in `bookings`. The attempts query must read `bookability_contestant_attempts` (joined to `booking_contestants`) so failures before a booking row exists are visible.

- **No package-transfer for post-issuance / post-ticketing states.** The tool drives a checkout against a chosen package and stops at the supplier's check availability response. It does not create a booking, never produces a `bookings` row, and cannot reconstruct `bookings.status='issued'`, `booking_segments.control_number` shapes, confirmation emails, or any post-booking debug logs. Checks for those states must drive a real booking end-to-end on staging, or move to a Post-deployment watch.

- **No code-path verbs in pass conditions** (*exercises / enters / hits / runs through / executes / goes through / triggers / reaches / invokes / calls into*) and **no method or class names in *Why:* lines** (`getSegmentPnrs`, `isOnefly()`, `actionValidatePackageDeeply`, etc.). Both fail the "QA can observe this" test — see the *Why:* / pass-condition guidance in Core principle for the translation pattern.

- Do not hardcode staging URLs. Reference the environment by name and let the QA engineer supply the host (the `Staging:` header field is a link the user added to the card, not a hard-coded environment).
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not create a Notion page outside the Flighthub QA root. Pass the root ID (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`) explicitly when creating a page; do not rely on any default.
- Do not post the Notion link as a Trello comment. It goes in the card `desc` (Step 5), de-duped against any prior `**QA Strategy:**` line.
- Do not include Notion-only decoration tags (`<callout>`, `<details>`, `{toggle="true"}`, `<span color=…>`) in the chat-preview markdown. They are added mechanically at publish time per the *Notion render rules* table.
- Do not write a `Rollback signals` section, a progress bar, or per-section counters into the plan. Healthy-vs-unhealthy expectations belong inside each monitoring query's comment header.
- Do not cap the number of PRs listed on the `**PR:**` header line. List every PR linked from the card.
- Do not put a `(PR #<N>)` or branch suffix in the Notion page title. Title is `QA Strategy — <Card title>` only.
- Do not create a new Notion page on every republish. If the Trello card `desc` already has a `**QA Strategy:** <url>` line and the page is still under the QA root, update it in place via `notion-update-page` `replace_content`.

## References

- `db_access` skill — DB CLIs and table / collection docs required for query verification: [`../db_access/SKILL.md`](../db_access/SKILL.md).
- `notion_assistant` skill — Notion delivery pinned to the Flighthub QA root: [`../notion_assistant/SKILL.md`](../notion_assistant/SKILL.md).
- `codebase_access` skill — reading genesis when the PR is too large for a full diff fetch: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- `post_deploy_tracker` skill — longer-term post-deploy monitoring: [`../post_deploy_tracker/SKILL.md`](../post_deploy_tracker/SKILL.md).
- Trello board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
