---
name: qa-strategy
description: >-
  Use when the user wants a QA strategy, test plan, or staging /
  post-deploy checklist derived from a Trello card and its linked PR —
  trigger phrases: "QA strategy for this card", "test plan for",
  "staging checklist", "post-deploy checks", "what to QA on <card
  link>". Reads the card and PR diff, writes a two-section plan
  (Staging + Post-deployment) framed in user / agent / log terms only —
  never code identifiers.
---

# QA Strategy Generator

Given a Trello card and its linked PR, produce a structured QA strategy — what to test on staging before merging, and what to watch in production after deploy.

## Core principle

**Read the code. Test the functionality.**

Reading the PR (or branch diff) is **mandatory** — without it the plan degrades into generic boilerplate. The diff is read to answer one question: *what behaviour will a human or a log query notice differently after this change?* The output plan is written in terms of UI flows, internal screens, emails, and log shapes QA can observe directly — every checklist item must be verifiable without opening the codebase. If a change has no user-visible, agent-visible, or log-visible effect (pure refactor, internal rename, comment-only edit), the plan says so explicitly and stays short.

### Scope discipline

Every checklist item traces to a file in the diff **and** a user / agent / log surface that file modifies. If the PR only touches the availability-check step, don't add checks for the confirmation page or seat selection just because they sit downstream. Drop anything you can't tie back.

### No code-level red flags in the plan

Debug toggles flipped on, unconditional bypasses, commented-out guards, leftover `dd()` / `var_dump` — surface those in the chat reply outside the plan block. The plan is QA workflow, not code review.

### No staging fixtures — lean on production cases

We don't maintain staging fixtures for malformed, stale, or contrived inputs. Any check that needs a specific input (a particular carrier, a stale package, a specific error signature) is first found in a prod DB and then reproduced on staging. If a failure mode cannot be reproduced either way, move it to Post-deployment and frame it as: *"watch prod for sessions where <natural condition>; if such a session occurs, confirm <expected user / agent / log symptom>. If not observed in the watch window, mark as 'not observed' — do not block on it."*

### A *Why:* line on each non-trivial check

Every checklist item that isn't a one-line smoke check carries a one-or-two-sentence *Why:* line under the bold name, tying the check to the PR's diff in plain user / agent / log terms — "this is the back-fill the PR removed", "this is the new short-circuit the PR introduced". No code names.

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

## Workflow

### Step 1 — Read the card

`GET /1/cards/<shortLink>?actions=commentCard&fields=name,desc,url`. Extract title, description, and PR URLs from `desc` and `actions[].data.text` (match `github.com/.+/pull/\d+`).

Also capture any staging URL mentioned on the card or in comments — it goes into the plan header so QA doesn't have to hunt for it.

If no PR URL is found, ask the user to paste one before proceeding. Do not guess.

### Step 2 — Read the PR / branch (mandatory)

For each linked PR (limit to 3 — if more, ask the user which to use):

```
get_pull_request(owner, repo, pull_number)
get_pull_request_files(owner, repo, pull_number)
get_pull_request_diff(owner, repo, pull_number)   # PRs ≤ 50 files only
```

For PRs > 50 files: skip `get_pull_request_diff` and rely on `get_pull_request_files` plus targeted reads via `codebase_access`. For a branch with no PR yet, use `compare_commits(owner, repo, base, head)` and read the resulting diff the same way.

Read the **substantive code changes**, not the file paths alone. For each meaningful cluster of changed files, answer three questions in canonical glossary terms (see `GLOSSARY.md`):

1. **What does the end user see differently?** (search results page, checkout page, the check availability call, confirmation page, confirmation email, error messages, fallback behaviour)
2. **What does the internal agent see differently on the ResPro page?** (order details, segments, fare basis, ticketing view, refund / exchange UI, queue / status fields)
3. **What does the log shape change?** (new / removed fields in `ota.debug_logs` or `ota.optimizer_logs`, supplier request / response payload diffs, new ClickHouse error codes, new MySQL row states)

If a changed file maps to none of these, it does not generate a checklist item — code-only refactors are out of scope.

### Step 3 — Derive the strategy

Map the diff-derived surface to test scenarios. When a check needs a **specific** input — a particular carrier on a particular content source, a fare basis with a tag, a session that hit a specific error — embed a concrete prod-DB query that finds a real example, so QA can pick one and reproduce on staging:

| What to find | Where to query | Joinable to |
|--------------|----------------|-------------|
| A booked itinerary on carrier X with content source Y | MySQL `booking_contestants` (`validating_carrier`, `content_source`, `booking_status = 'BOOKED'`) | `search_hash` → MongoDB `debug_logs.transaction_id` |
| A session that hit a specific supplier error | ClickHouse `jupiter.jupiter_booking_errors_v2` (`gds`, `booking_step`, `error_message`) | `search_id` → MongoDB `debug_logs.transaction_id` |
| A session whose supplier response had / lacked a specific field | MongoDB `ota.debug_logs` (`$match` on `context`, then check `Response` / `response`) | `transaction_id` → MySQL `booking_contestants.search_hash` |

**Staging section** — only flows that can be driven from a fresh search on staging or replayed from a real prod case:

- **Smoke tests** — one end-to-end per affected content source.
- **Happy-path flows** — the journey the card promises.
- **Edge cases** — boundary inputs reachable from a fresh search or by replaying a prod case. Anything that needs a fabricated input moves to Post-deployment.
- **Regression risks (user-visible only)** — other journeys sharing the same UI surface, supplier, log shape, or ResPro page area. Phrase each as a symptom; embed a locator query when a specific carrier / supplier is needed. If you can't phrase a regression in observable terms, drop it.

**Post-deployment section** — checks after the fix is live. Also where negative paths land when staging can't reproduce them:

- **Production checks** — human verifications observable on real bookings.
- **Monitoring queries** — copy-pasteable MySQL / ClickHouse / Mongo snippets, 1-hour or 24-hour window, label window + timezone.
- **Rollback signals** — one-sentence conditions a human or log query can spot.
- **Watch window** — default 24h for booking-path changes, 4h for config-only.

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

Full plan template:

```markdown
## QA Strategy — <Card title>

**PR:** <pr_url>
**Trello card:** <card_url>
**Staging:** <staging URL from card / comments — omit the line if none>
**What changes for QA:** <one to three plain-language sentences. List the surfaces to watch (search results page, checkout page, ResPro page, debug log, etc.). No code terms.>

---

### Staging

**Smoke tests**

- [ ] **<Short name>**
  1. <step>
  2. <observable pass condition>

**Happy-path flows**

- [ ] **<Short name>** + *Why:* + steps

**Edge cases** (reachable from a fresh search or replayed from a real prod case)

- [ ] **<Short name>** + *Why:* + optional **Find a case:** + steps

**Regression risks (user-visible only)**

- [ ] **<Short name>** + *Why:* + optional **Find a case:** + steps

---

### Post-deployment

**Production checks**

- [ ] **<Short name>** + (*Why:* unless it's a generic spot check) + steps

- [ ] **<Negative-path check that staging couldn't reach>**
  *Why:* <new failure mode, why staging can't reproduce, what observable behaviour to confirm>
  1. After deploy, watch prod for <natural condition>.
  2. If such a case occurs, confirm <observable symptom>.
  3. If not observed in the watch window, mark "not observed" — do not block.

**Monitoring queries**

```sql
-- <label, window, timezone>
-- Verified <YYYY-MM-DD> against <table>, returned <N rows / shape summary>.
<query>
```

Mongo blocks use the same shape with `// Field shape verified ...` and `// Run from mongosh.`.

**Rollback signals**
- <user-visible or log-visible condition> → revert / escalate

**Watch window:** <N hours>
```

### Step 5 — Propose, wait for approval, then publish

The plan is **always proposed in chat first** and only published after approval. Never auto-publish.

1. **Propose.** Emit the full Step 4 markdown block in chat. End with: *"Approve and publish?"* Do not pre-empt with edits.
2. **Iterate.** If the user wants changes, update and re-emit the full block.
3. **Publish (on approval), in order:**
   1. **Create a Notion page** via the `notion_assistant` skill. Parent: Flighthub QA root (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`). Title: `QA Strategy — <card title> (PR #<number>)` — substitute the branch name for `PR #<number>` if no PR exists. Body: the approved markdown. Capture the page URL.
   2. **Append the Notion link to the bottom of the Trello card `desc`** — never as a comment. The append is idempotent: any prior `**QA Strategy:** <url>` line (and its preceding `---` separator) is stripped before the new link is added.

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

4. **Report.** Hand back the Notion URL in chat and confirm the Trello card was updated.

If either publish step fails, surface the error verbatim and stop. Don't retry on a different surface without user direction.

## What not to do

Concrete rules not already stated by Core principle, Workflow, or `GLOSSARY.md`:

- **Forbidden-phrasing examples** (illustrating the glossary's "no code identifiers in prose" rule). Each is replaced by the user / agent / log symptom it would produce.
  - "`Mv_Ota_Air_Booker::createAncillaryServices()` — re-test existing factory-loaded baggage flow."
  - "`OptimizationResponseDto` must not break existing consumers."
  - "`Provider/Dida.php` shared abstract changes — spot-check one non-baggage Dida call."
  - "Older catalogue version `Service_StandaloneCatalogue_15_1` — confirm unaffected."

- Do not hardcode staging URLs. Reference the environment by name and let the QA engineer supply the host (the `Staging:` header field is a link the user added to the card, not a hard-coded environment).
- Do not include monitoring queries for tables unrelated to the change surface.
- Do not create a Notion page outside the Flighthub QA root. Pass the root ID (`35edf8c4-9d3f-80ee-a5ff-eaaa7aa9b3b9`) explicitly to `notion_assistant`; do not rely on its default.
- Do not post the Notion link as a Trello comment. It goes in the card `desc` (Step 5), de-duped against any prior `**QA Strategy:**` line.

## References

- `db_access` skill — DB CLIs and table / collection docs required for query verification: [`../db_access/SKILL.md`](../db_access/SKILL.md).
- `notion_assistant` skill — Notion delivery pinned to the Flighthub QA root: [`../notion_assistant/SKILL.md`](../notion_assistant/SKILL.md).
- `codebase_access` skill — reading genesis when the PR is too large for a full diff fetch: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- `post_deploy_tracker` skill — longer-term post-deploy monitoring: [`../post_deploy_tracker/SKILL.md`](../post_deploy_tracker/SKILL.md).
- Trello board IDs: `.cursor/skills/trello_assistant/automation_cards.md`.
