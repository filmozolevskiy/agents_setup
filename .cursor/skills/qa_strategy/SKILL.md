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

Every staging check that drives a search, checkout, or booking names the debug log in the observe line (context, `_scopes` when needed, Request/Response field when it changed). When the log body does not show the logic change, that same line names the secondary surface and **EXPECT:** is that surface. See *Short test body*, Step 2 *Name the log*, and [`references/log_to_open.md`](references/log_to_open.md).

### Brevity over completeness

The shorter the plan, the more likely QA reads and runs every item. Default to the minimum viable plan. Cut every check that does not change QA's next action. For a small change, three checks total can be the right answer — don't pad the optional sections to look thorough. If a section has nothing to add, drop the section header entirely.

#### Short test body

QA already knows how to search, pick a seat, and open a debug log. A test is not a how-to tutorial.

Each nested test (and each extra `- [ ]` check) is this shape, in this order:

```markdown
  - Test 1: <short name> ✅❌❓
    *Why:* <one or two sentences>
    **Find a case:** <verified query — only when a specific prod row is needed>
    1. <action: drive the condition; note `search_id` / `booking_id` / `attempt_id`>
    2. <observe: open `<context>` (`_scopes` `<scope>`). Confirm `<field>`. Before: <permalink when harvested>.>
    **EXPECT:** <observable>
```

Hard cap: **at most two numbered lines** before `**EXPECT:**`.

| Slot | What it is | What it is not |
|------|------------|----------------|
| Action line | Drive the condition in one sentence. Note the id in the same sentence. | Click-by-click ("open checkout, pick a paid seat, go far enough for the Optimizer to run"). A separate "Note the `search_id`" step. |
| Observe line | Named log: context, `_scopes` when needed, field or "Request/Response unchanged", before permalink when the field changed. Skip when the check produces no debug log group. | A paragraph restating harvest rules. A third numbered line. |
| **EXPECT:** | The observable. If the proof is a query, the query sits next to this line. | A "Run this query" numbered step that repeats the query. |

Post-deploy watches stay: short line + **Find the attempts:** / **Find the cases:** + **EXPECT:**. No numbered steps.

### Plain ESL wording

Write the plan in short, plain sentences with everyday verbs. Prefer "we will not verify them manually" over "we do not sweep them by hand"; prefer "the log no longer fills with duplicate lines" over "the log stops repeating entries". No idioms, no metaphors ("sweep", "blast radius", "in flight", "land cleanly"), no Latin abbreviations, no playful phrasing.

### Scope discipline

Every checklist item traces to a file in the diff **and** a user / agent / log surface that file modifies. If the PR only touches the availability-check step, don't add checks for the confirmation page or seat selection just because they sit downstream. Drop anything you can't tie back.

### No code-level red flags in the plan

Debug toggles flipped on, unconditional bypasses, commented-out guards, leftover `dd()` / `var_dump` — surface those in the chat reply outside the plan block. The plan is QA workflow, not code review.

### No staging fixtures — lean on production cases or the package-transfer tool

We don't maintain staging fixtures for malformed, stale, or contrived inputs. Any check that needs a specific input (a particular carrier, a stale package, a specific error signature, a multi-passenger / multi-PNR shape) is reproduced on staging through one of two paths, **in this order**:

1. **Find a production case and replay the same search on staging.** The plan embeds a `**Find a case:**` query that returns a real prod row with the condition; the action line names the staging replay (same itinerary / same package), not a click-by-click tutorial.
2. **If a fresh search will not reproduce the condition** (a stale package, a different-price re-quote, an unavailable response, a specific package the user already chose), **use the package-transfer tool** at https://summit.flighthub.com/tools/package-transfer. Pick the prod row, transfer the package onto the staging environment, then walk through checkout. The supplier is called live against the transferred shape and exercises the changed code path.

Only when **both** paths fail — no representative prod row exists, and the package-transfer tool cannot recreate the condition — move the check to Post-deployment and frame it as: *"watch prod for sessions where <natural condition>; if such a session occurs, confirm <expected user / agent / log symptom>. If not observed in the watch window, mark as 'not observed' — do not block on it."* The post-deploy watch is the last resort, not the default.

### Each check must trigger the specific logic it claims to verify

Before writing the steps for any check, answer: *what condition does the changed code require to execute?* If the answer is "more than one passenger with a distinct PNR", "a stale package that re-quotes at a different price", "a fare with the `XYZ` tag", "an unavailable response from the supplier" — the steps must produce that condition. Never write "use the booking from the smoke test" for a check that only fires under a condition the smoke booking does not hit.

Apply the test: read the check's *Why:* line, then re-read its steps. If the steps could pass on a booking that does not satisfy the condition the *Why:* describes, the check is broken — either change the steps to drive the condition (prod-row replay or package-transfer), fold the check into another booking that already has the condition (see *Bundle checks that share a booking* below), or drop the check.

### Cover both directions when a PR is bi-directional

When the PR affects bi-directional behaviour — increase **and** decrease, success **and** failure, on-time **and** late, granted **and** revoked — verify that **each direction has its own observable surface** before writing the plan, and write a check (or a sub-observation inside a bundle) for each one. The "happy" direction (decrease, success, granted) often has weaker observability than the "unhappy" one and is easy to drop on the floor. Concrete trap from past plans:

- A fare-change PR's **increase** branch raises `loss_limit_fare_increase` / `fare_increase` / `fare_increase_not_allowed` / `flight_not_available_cannot_price` on `bookability_contestant_attempts` (the contestant is dropped). The **decrease** branch lets the contestant proceed with the lower fare, so `bookability_contestant_attempts` shows `status=1` with **no** decrease-flavoured label. The only surface that catches a decrease is the `debug_logs` VerifyPrice response with a different `routing.adultPrice` than the search price. A check that only watches `bookability_contestant_attempts` silently misses every decrease.

Name the asymmetry in the *Why:* line ("decreases never show up on the contestant-attempts surface; they're only visible on `debug_logs`") and ship a separate query for the weaker surface.

### Automate the comparison in the query — don't ask QA to diff by hand

A query that returns a haystack and tells QA to "open each row and compare values" is not a finished query. If the answer the check is looking for is a derivation across rows — a value differs between calls, a count rose / fell, a flag flipped — do the derivation **inside the pipeline / SQL** (regex extraction, `$group` + `$addToSet`, `$switch` for direction inference, `HAVING` on aggregate spreads, etc.) and project the answer as a column on the output. The output is then a list of confirmed positives, not candidates to triage manually.

Apply the test: read the check's pass condition, then re-read the query. If the pass condition is "the third call's price differs from the first two" and the query just lists rows, the query is wrong — push the comparison into the pipeline. The earlier the noise is filtered (tight time-window per session, minimum spread, direction labels, contexts-must-have-both), the closer the output gets to "every row is a real hit".

### Every Post-deployment check carries its own concrete query

A Post-deployment check that says "watch the queries below" is not a check. The reader is reading **the check**, and the query has to be right there. Each **Post Deployment tracking** `- [ ]` watch embeds its own `**Find the cases:**` / `**Find the attempts:**` block (verification-stamped per *Every query is verified before it ships*). Continuous signals such as error share or failure-mode shift since deploy are also post-deploy watches, with the query embedded under the watch.

### Bundle checks that share a booking into one block

When several checks can be done with the same booking attempt present them as **one** booking with N ordered observations, never N separate bookings. QA runs one booking; the plan reads as a single block; nothing is duplicated.

Write `- [ ] DoD<n>` for the relevant Definition of Done item and nest ordered `Test n` lines under it. `n` is the `DoD<n>` prefix already on that item. Do not paste the DoD sentence. If the bundle does not map to DoD, use one extra `- [ ]` line. Describe the booking once, then make each observation a numbered test with its own *Why:* line and **EXPECT:**.

```markdown
- [ ] DoD1
  - Test 1: Drive one <supplier / route / passenger condition> booking ✅❌❓
    *Why:* <why this booking shape covers the changed behaviour>
    1. Drive one booking on <staging environment>. Note `booking_id`.
    **EXPECT:** <observable booking result>.
  - Test 2: Check the ResPro page for the same booking ✅❌❓
    *Why:* <why this page field may change>
    1. Open the ResPro page for the same `booking_id`.
    **EXPECT:** <observable page result>.
  - Test 3: Check the debug log for the same booking ✅❌❓
    *Why:* <why this log shape may change>
    1. Open `<context>` for the same `booking_id` (`_scopes` `<scope>` when several entries share that context).
    **EXPECT:** <observable log result>.
```

Only split into separate checks when the bookings must differ in a way the bundle cannot accommodate (different supplier, different passenger count when that *is* the condition under test, different staging environment). Two checks that need the same shape of booking are always a single bundle.

### A *Why:* line on each non-trivial check

Every checklist item that isn't a one-line smoke check carries a one-or-two-sentence *Why:* line under its `Test n` or extra-check line, tying the check to the PR's diff in plain user / agent / log terms — "this is the back-fill the PR removed", "this is the new short-circuit the PR introduced".

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

The same rule applies to **pass conditions** — a line ending in "confirm `getTickets()` returns the populated array" is wrong; "confirm the ResPro page shows the ticket number for each passenger" is right.

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

- Any staging-side check that reads a shared store must be pinned to the concrete `search_id`, `booking_id`, `transaction_id`, or equivalent identifier produced by the staging action — never an aggregate over a time window. Note that identifier in the action line before the query runs.
- Aggregate / time-window queries are allowed only in the **Post-deployment** section, where production volume dominates and staging traffic is negligible.
- If a staging check genuinely needs an aggregate (e.g. "did supplier X get called at all on staging"), reframe it as a per-`search_id` row count instead.

### Every query is verified before it ships — no exceptions

Applies to every query in the plan — locator queries inside staging checks, monitoring queries, prod-watch queries, queries pasted in chat preview, queries pasted in the published Trello card description, queries pasted in any Trello card comment, queries proposed in the chat preview only to be approved by the user. **Writing a query from memory and shipping it is forbidden.** Every column name, table name, field name, filter value, and supplier identifier in any query must be verified against the real schema and real data before the query enters any artefact the user reads.

**Mandatory pre-paste sequence** (in this order, no skipping):

1. **Schema check.** Open `.cursor/skills/db_access/db-docs/<store>/<name>.md` and confirm every referenced column / field exists with the expected type. If the doc is missing, write it (per the `db_access` skill) before continuing. If the doc disagrees with the data later in this sequence, the **data wins** — fix the doc inline before pasting the query (durable-fact write-back per `CLAUDE.md` Constitution).
2. **Literal-value check.** Confirm every filter literal (supplier codes, status values, enum-style strings, content sources, error labels) by running a tiny `SELECT DISTINCT col LIMIT 50` / `db.coll.distinct(...)` (or Mongo equivalent) via the `db_access` CLI scripts. Casing matters — `'DIDA'` vs `'dida'` is two different filters.
3. **Execution check.** Run the actual query against a recent window using the `db_access` CLI. Paste a stamp built from what you observed: `-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.` The N and the shape are real numbers from the run, not "should be non-empty".
4. **Honest fallback.** If the fixed condition is rare or zero today (the query returns no representative row in a recent window), confirm steps 1 and 2 only, then write the gap explicitly into the stamp — never imply a populated result you did not see: `-- Schema-confirmed only <YYYY-MM-DD> against <table> (no representative row in last N days; <columns> + filter values verified).`
5. **Abort path.** If the store is unreachable, the table is missing, or step 2 contradicts what the query assumes — **drop the query**. Do not paste it with a placeholder stamp. State the limitation in prose where the query would have gone.

**Forbidden:**

- Writing `-- Verified <date> against <table>` without actually running the query.
- Inventing column names, table names, status values, or filter literals from memory or pattern-matching off other suppliers / databases.
- Shipping a query whose stamp does not reflect the run output (e.g. `returned 50 rows` when you did not run it).
- Stamping a query as verified when only the schema doc was opened and the query was never executed.
- Hedging with "looks right" / "should work" — either it is verified per the sequence above, or it is dropped.

The same rule applies to **fixing** a query the user flagged: re-run the full sequence on the new query, do not just patch the column names and re-paste.

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

Also capture any staging URL mentioned on the card or in comments. Put it in the chat reply outside the plan block, under **Notes for QA** or **What changes for QA**, so QA does not have to hunt for it.

If no PR URL is found, ask the user to paste one before proceeding. Do not guess.

### Step 2 — Read the PR / branch (mandatory)

Read every linked PR with no cap. List every PR URL in the chat reply outside the plan block; do not add a PR header to the card:

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

#### Name the log each staging booking check will open

Before writing any checklist item, answer these for every staging search / checkout / booking check. Worked examples: [`references/log_to_open.md`](references/log_to_open.md).

1. Name every `debug_logs` `context` the staging action will produce. Confirm against the PR, [`.cursor/skills/db_access/db-docs/mongodb/debug_logs.md`](../db_access/db-docs/mongodb/debug_logs.md), and a sample query when the context is not already documented.
2. If several entries share that `context`, name the `_scopes` value that picks the entry the check cares about. Do not point at the first matching row when the bug is on a later call.
3. Decide whether the PR changes a Request/Response field, the count of those entries, or neither.
4. **Field changed.** Query `ota.debug_logs` for one recent production row of that context (and `_scopes` when needed) whose field still has the **old** shape. Verification stamp required. Write the context, `_scopes` if needed, the field, and one permalink into the observe line: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>`. If no representative row exists, omit the permalink, keep the context / field / expected new shape in the observe line, and stamp the gap. **EXPECT:** includes the new Request/Response shape. Do not emit a **Log to open** slot.
5. **Body unchanged, behaviour changed.** Keep an observe line. Write in that line that the supplier Request/Response is unchanged and name the first secondary surface that moves (entry count in the same log group → contestant-attempts → ClickHouse booking errors → ResPro field → user-facing page or confirmation email). Do not harvest a before permalink for an unchanged field. **EXPECT:** is the secondary surface. If none of those move, drop the check; say so in the chat reply, not on the card.
6. Never paste an after permalink you did not observe. QA confirms the new shape on the session they drove.
7. When several observations share one booking, each observation that claims a log condition names that log in its own observe line. Two different contexts are two tests (or two observe lines on two tests). The same context+field is not repeated.

Do not name logs on **Post Deployment tracking** watches, negative-path watches, monitoring queries, **Find a case** locator queries, or checks that produce no debug log group. Do not pad with a fake context. Do not emit a **Log to open** slot, a `This log does not show the logic change` labelled line, or an **Also watch** labelled line.

#### Validate every pass condition against how the flow actually behaves

Before writing a check, confirm the *expected* user / agent / log outcome matches the real flow. The plan is wrong when it asserts behaviour the system does not have, even if the steps run cleanly. Known traps — re-check the code (via `codebase_access`) and the debug logs whenever a check touches any of these surfaces:

- **Check availability does not change the price shown or charged to the user.** The price agreed at search stands. A pass condition like "the new repriced total appears on checkout" is wrong — the user never sees a re-price. If the supplier returns a different price, the agent path is to drop the contestant and let the optimizer try another, not to re-prompt the user.
- **The fare-increase / fare-decrease page is not shown right away on a price-changed response.** Even when check availability (or the booker's VerifyPrice) returns a different price, the contestant is dropped and the optimizer attempts the next contestant. The FI / FD page is reserved for the case where **every** contestant came back with a price change. Pass conditions like "the price-change page appears with the new total; accepting it routes to payment" are wrong on a single-contestant-change observation — they only apply to the all-contestants-exhausted edge case (give that case its own dedicated check). The right observable for a single fare-changed contestant is on the contestant-attempts surface (the Dida attempt gets `status=0` + a fare-change `error` label like `loss_limit_fare_increase`) and a different contestant gets attempted.
- **"Flight no longer available" does not block the booking.** On an unavailable response from check availability, the flow falls through to the optimizer and the original contestant is excluded from retry. A pass condition like "the user is blocked with an error" is wrong — the correct condition is "the original contestant is not retried; the optimizer attempts another contestant; the user either gets a different fare or, only after all contestants are exhausted, sees no-availability".
- **A failure before the `bookings` row is written does not show up in `bookings`.** Pre-booking failures (during contestant attempts) are visible only on the **contestant-attempts** surface. A check that watches `bookings` for "did the booking fail" will miss them — see Step 3 production checks.
- **Team conventions live in the data, not in the column name.** When a check needs a column that splits "system did this" vs "agent did this" (or any other team-internal bucket), the right column is the one the team actually reads on — not the one whose name sounds closest. Examples that look obvious and are wrong:
  - `ota.booking_tasks` system-vs-agent resolution: `resolved_by = 0` is system-resolved, non-zero is agent-resolved. `handle_type='auto'` is **not** that signal (it is queue routing intent at task creation). Same for `created_by = 0` = "created by the system". See [`../db_access/db-docs/mysql/booking_tasks.md`](../db_access/db-docs/mysql/booking_tasks.md).
  - Before relying on a column for a convention like this, confirm in the relevant db-doc that the convention is written there. If the doc does not state it, ask the user (or read the writer code via `codebase_access`) and write it back into the doc in the same change — see the durable-fact write-back rule in `CLAUDE.md` Constitution.

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
- **Regression risks (user-visible only)** — other journeys sharing the same UI surface, supplier, log shape, or ResPro page area. Phrase each as a symptom; embed a locator query when a specific carrier / supplier is needed. If you can't phrase a regression in observable terms, drop it. A **broad "is everything else still fine" sweep** that exists only because the PR touches shared code (e.g. "confirm all other content sources still search and book") is not a checklist item — it is a blast-radius note. Put it in **Notes for QA** in the chat reply outside the plan block, so the agent treats it as context, not a test to run.

**Post-deployment section** — checks after the fix is live. Also where negative paths land when staging can't reproduce them:

- **Production checks** — human verifications observable on real bookings. A spot-check ("confirm the first real booking after deploy") must come with a query that surfaces recent **contestant attempts** on the affected surface — both successes and failures — so QA can see at a glance whether attempts are failing and pick a real attempt to validate. Read the **contestant-attempts** surface (MySQL `bookability_contestant_attempts` joined to `booking_contestants` — see the `bookability` skill for the canonical CTE), **not** `bookings` alone: a failure that happens *before* a `bookings` row is written (auth error, supplier 500 on price, malformed availability response) leaves nothing in `bookings` and is invisible to a `bookings`-only query. Never write "pick a booking" without the attempts query that finds it.
- **Monitoring queries** — copy-pasteable MySQL / ClickHouse / Mongo snippets, 1-hour or 24-hour window, label window + timezone. State the healthy vs unhealthy shape in the query comment (e.g. `-- healthy after deploy: 0 rows; any row = the fix did not land — revert / escalate`), so the revert signal travels with the query instead of in a separate section.

**Published map.** Derivation still uses smoke / happy-path / edge / regression / post-deploy. The card does not. Write one `- [ ] DoD<n>` line into `### ⊙ **QA Strategy**` for every real DoD item (`DoD1`, `DoD2`, … matching the `DoD<n>` prefix under **Definition of Done**). Do not paste the DoD sentence. Nest `Test n` under a coverable item. Nest `No test: <reason>.` under an uncoverable item. PR checks that do not map to DoD become new `- [ ]` lines after the DoD# items. Post-deploy watches and monitoring queries become `### ⊙ **Post Deployment tracking**` (omit that heading when empty). Drop **Smoke tests**, **Happy-path**, **Edge cases**, **Regression risks**, **Production checks**, and **Monitoring queries** as published headers.

#### Cross-content-source coverage for shared log contexts

When the changed code path runs for more than one content source — e.g. a log context like `*::check-availability-response` or `*::check-availability-comparison-report` that fires for every supplier, a shared dispatcher, an abstract base — the plan **must** add an explicit verification case for at least one other content source, not just the supplier named on the card. The pass condition is the same observable shape; only the supplier filter changes. Skip this only when the diff is provably scoped to one supplier's adapter (e.g. `Provider/Kiwi.php` with no shared call site changed).

### Step 4 — Output the strategy

Every published check is a Trello checklist line. DoD parents are `- [ ] DoD1`, `- [ ] DoD2`, … with no ✅❌❓ and no restated DoD sentence. `n` matches the `DoD<n>` prefix under **Definition of Done** (`* DoD1: <text>`). Skip `_TO BE DONE_`. If a card still uses `- [ ]` / `- [x]`, bare `DoD1`, or `- DoD1` under Definition of Done, number those 1-based in order (legacy). Nested tests are `Test n: <short name> ✅❌❓` plus *Why:* (when not trivial), at most two numbered lines (action, then observe when a log is named), and `**EXPECT:**`. Extra PR checks and post-deploy watches put ✅❌❓ on the `- [ ]` line itself. Do not emit a PASS labelled line. Worked short shapes: [`references/log_to_open.md`](references/log_to_open.md).

When a check needs a specific real-world case (carrier / supplier / error / route), include a `**Find a case:**` / `**Find the attempts:**` block with a verification-stamped query under that test. The action line refers to that output. Do not add a numbered "Run this query" step.

Full plan template (chat preview = card body). Spec: [`docs/2026-08-20-card-dod-qa-design.md`](docs/2026-08-20-card-dod-qa-design.md).

```markdown
### ⊙ **QA Strategy**

- [ ] DoD1
  - Test 1: <short name> ✅❌❓
    *Why:* <one or two sentences tying this check to the PR's diff>
    1. Drive the booking / checkout. Note `search_id` / `booking_id`.
    2. Open `<context>` (`_scopes` `<scope>` when several entries share that context). Confirm Request `<field>`. Before (old shape): <permalink> — only when a before row was harvested.
    **EXPECT:** <observable condition, including the new Request shape when the field changed, or the secondary surface when it did not>
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
  -- Recent contestant attempts on the affected surface — successes + failures — last N hours.
  -- Verified <YYYY-MM-DD> against bookability_contestant_attempts, returned <N rows / shape summary>.
  <query>
  ```
  **EXPECT:** <observable condition>

- [ ] <MongoDB watch line> ✅❌❓
  **Find the cases:**
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
  **EXPECT:** <observable condition>
```

Mongo blocks stay **bare aggregation-pipeline arrays** so QA can paste them straight into MongoDB Compass — never `db.collection.aggregate(...)`, never `db.collection.find(...)`, no surrounding shell wrapper. State the target collection in the comment above the array. Window expressions like `new Date(Date.now() - N*3600*1000)` are fine because Compass evaluates them.

**QA Strategy** always ships when DoD has real items, or when the PR yields a test that does not map to DoD. If DoD is only `* DoD1: _TO BE DONE_` (or a legacy `DoD1 _TO BE DONE_` / `- [ ] _TO BE DONE_`), write no DoD# lines; ship **QA Strategy** only when unmapped PR tests exist. Drop **Post Deployment tracking** when it has zero items. Do not put ✅❌❓ on a DoD# line or on a `No test:` line. First publish writes one space before `✅❌❓`, with no spaces between the three marks.

### Step 5 — Propose, wait for approval, then publish

The plan is **always proposed in chat first** and only published after approval. Never auto-publish.

1. **Propose.** Emit the Step 4 card markdown in chat. End with: *"Approve and publish?"* Do not pre-empt with edits. Put **What changes for QA**, **Notes for QA**, and code red flags in the chat reply **outside** the plan block. They do not go on the card.
2. **Iterate.** If the user wants changes, update and re-emit the full card-markdown block.
3. **Publish (on approval).** Write into the Trello card `desc`. Never call Notion create or update.

   1. `GET /1/cards/<id>?fields=desc`.
   2. Strip any `**QA Strategy:** <url>` line and the `---` immediately above it. Leave the Notion page in place; do not delete it.
   3. Remove any existing `### ⊙ **QA Strategy**` section and any existing `### ⊙ **Post Deployment tracking**` section (heading through the line before the next `### ⊙` or the AI footer `---`). Keep their mark suffixes in memory (algorithm below).
   4. Build the new sections from the approved preview. For each test heading / extra `- [ ]` / post-deploy `- [ ]`, strip the checkbox or list prefix and trailing `✅` / `❌` / `❓` to get the match key. Match on the remaining text only. Keep the approved line prefix in the output. If that key existed in the old section, copy its trailing mark suffix as-is (one mark, two marks, or `✅❌❓`). If it did not exist, write `✅❌❓`. DoD# lines (`- [ ] DoD1`) and `No test:` lines never get marks. DoD# lines always reset to `- [ ]` (do not keep `- [x]`). On a republish that switches an old verbatim DoD parent to `DoD<n>`, match tests by their `Test n:` heading; do not try to match the old DoD sentence to `DoD<n>`.
   5. Insert **QA Strategy** immediately after the **Definition of Done** section (its heading plus checklist), before the next remaining `### ⊙` (**Credentials / access**, **QA notes**, **Similar / relevant cards**) and before the AI footer.
   6. Insert **Post Deployment tracking** immediately after **QA Strategy** when that section has items.
   7. If the new `desc` length is greater than 16384 characters, stop. Paste the length in chat. Do not truncate. Do not publish anywhere else.
   8. `PUT /1/cards/<id>` with `desc`. If the write fails, paste the error and stop. Do not retry on Notion or a comment.

4. **Report.** Hand back the card URL. Say first publish or republish. On republish, say that existing ✅ / ❌ / ❓ suffixes on matching headings were kept.

**Mark suffix algorithm** (run in the same Python that builds the new `desc`):

```python
import re

MARKS = re.compile(r"([✅❌❓]+)\s*$")
LINE_PREFIX = re.compile(r"^\s*-\s*(?:\[[ xX]\]\s*)?")

def strip_marks(heading: str) -> str:
    return MARKS.sub("", heading).rstrip()

def match_key(heading: str) -> str:
    return strip_marks(LINE_PREFIX.sub("", heading))

def suffix_of(heading: str) -> str | None:
    m = MARKS.search(heading)
    return m.group(1) if m else None

def apply_marks(new_heading: str, old_headings: list[str]) -> str:
    key = strip_marks(new_heading)
    for old in old_headings:
        if match_key(old) == match_key(new_heading):
            old_sfx = suffix_of(old)
            if old_sfx:
                return key + " " + old_sfx
            break
    return key + " ✅❌❓"

old = "- [x] Fare above the new loss limit is dropped ✅"
new = "- [ ] Fare above the new loss limit is dropped ✅❌❓"
result = apply_marks(new, [old])
assert result == "- [ ] Fare above the new loss limit is dropped ✅"
```

`old_headings` are the raw lines that start with `- [ ]`, `- [x]`, or `  - Test ` inside the removed sections. Strip that prefix before matching, and match on the remaining mark-free text. Keep the new line's prefix. Concatenate the suffix with **one space** before the first mark (`fee ✅❌❓`), and no spaces between `✅`, `❌`, and `❓`. `strip_marks` uses `rstrip()`, so `foo ✅` and `foo✅` share the key `foo`.

**Section extract regex** (same write):

```python
SECTION = re.compile(
    r"\n*### ⊙ \*\*(QA Strategy|Post Deployment tracking)\*\*\n.*?(?=\n### ⊙ |\n---\n|\Z)",
    re.S,
)
```

Reference shell after Python has produced `NEW_DESC`:

```bash
curl -s -X PUT "https://api.trello.com/1/cards/<id>" \
  -d "key=$TRELLO_API_KEY" -d "token=$TRELLO_TOKEN" \
  --data-urlencode "desc=${NEW_DESC}"
```

If any publish step fails, surface the error verbatim and stop. Don't retry on a different surface without user direction.

## What not to do

Concrete rules not already stated by Core principle, Workflow, or `GLOSSARY.md`:

- **Forbidden-phrasing examples** (illustrating the glossary's "no code identifiers in prose" rule). Each is replaced by the user / agent / log symptom it would produce.
  - "`Mv_Ota_Air_Booker::createAncillaryServices()` — re-test existing factory-loaded baggage flow."
  - "`OptimizationResponseDto` must not break existing consumers."
  - "`Provider/Dida.php` shared abstract changes — spot-check one non-baggage Dida call."
  - "Older catalogue version `Service_StandaloneCatalogue_15_1` — confirm unaffected."

- **Banned glossary terms.** Do not write `storefront` or `storefront page` anywhere in the plan (header lines, *Why:* lines, steps, Notes for QA, Trello card body). Use the specific page name (`search results page`, `checkout page`, `confirmation page`) or "FlightHub / JustFly". See [`../../../GLOSSARY.md`](../../../GLOSSARY.md) for the full banned-terms list.

- **No `db.collection.aggregate(...)` / `db.collection.find(...)` Mongo blocks.** Mongo blocks are bare aggregation-pipeline arrays so QA can paste them into MongoDB Compass — see the example in Step 4.

- **No `bookings`-only post-deploy spot-check.** Pre-booking failures leave no row in `bookings`. The attempts query must read `bookability_contestant_attempts` (joined to `booking_contestants`) so failures before a booking row exists are visible.

- **No package-transfer for post-issuance / post-ticketing states.** The tool drives a checkout against a chosen package and stops at the supplier's check availability response. It does not create a booking, never produces a `bookings` row, and cannot reconstruct `bookings.status='issued'`, `booking_segments.control_number` shapes, confirmation emails, or any post-booking debug logs. Checks for those states must drive a real booking end-to-end on staging, or move to a Post-deployment watch.

- **No code-path verbs in pass conditions** (*exercises / enters / hits / runs through / executes / goes through / triggers / reaches / invokes / calls into*) and **no method or class names in *Why:* lines** (`getSegmentPnrs`, `isOnefly()`, `actionValidatePackageDeeply`, etc.). Both fail the "QA can observe this" test — see the *Why:* / pass-condition guidance in Core principle for the translation pattern.

- **No tutorial steps.** At most two numbered lines before **EXPECT:**. No click-by-click ("open checkout, pick a paid seat, go far enough"). No separate "Note the `search_id`" step. No "Run this query" numbered step. See *Short test body*.
- Do not hardcode staging URLs. Use the staging URL found on the card or in its comments, and list it in the chat reply outside the plan block.
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not write a `Rollback signals` section, a progress bar, or per-section counters into the plan. Healthy-vs-unhealthy expectations belong inside each monitoring query's comment header.
- Read every linked PR. List every PR URL in the chat reply outside the plan block; do not put a PR header on the card.
- **No first-matching `context` when several entries share it.** Name `_scopes` that pick the later / other call.
- **No log-group root as a before permalink.** Before links end in `#<_id>`. Host is `https://reservations.voyagesalacarte.ca/debug-logs/log-group/`.
- **No after permalink you did not observe.**
- Do not publish to Notion. Do not call Notion create or update operations from this skill.
- Do not add an **Additional tests** section.
- Do not emit a **Log to open** slot, a `This log does not show the logic change` labelled line, or an **Also watch** labelled line.
- Do not write a PASS labelled line. The observable line is **EXPECT:**.
- Do not put ✅❌❓ on a DoD# line (`- [ ] DoD1`) or on a `No test:` line.
- Do not restate a Definition of Done sentence under **QA Strategy**. Write `- [ ] DoD1`, `- [ ] DoD2`, … only.
- Do not invent a test for an uncoverable DoD item.
- Do not nest an extra PR check under a DoD item it does not cover.
- Do not name logs on **Post Deployment tracking** watches.
- Do not reset a heading's marks back to `✅❌❓` when that heading still exists with a different suffix.
- Do not post the strategy as a Trello comment. It goes in the card `desc` after Definition of Done (Step 5).

## References

- `db_access` skill — DB CLIs and table / collection docs required for query verification: [`../db_access/SKILL.md`](../db_access/SKILL.md).
- `codebase_access` skill — reading genesis when the PR is too large for a full diff fetch: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- `post_deploy_tracker` skill — longer-term post-deploy monitoring: [`../post_deploy_tracker/SKILL.md`](../post_deploy_tracker/SKILL.md).
- Trello board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
- Log-to-open worked examples: [`references/log_to_open.md`](references/log_to_open.md).
- Card-DoD publish spec: [`docs/2026-08-20-card-dod-qa-design.md`](docs/2026-08-20-card-dod-qa-design.md).
