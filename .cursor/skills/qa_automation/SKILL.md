---
name: qa-automation
description: >-
  Use when creating real test bookings on FlightHub / JustFly staging and
  validating them across MySQL, ClickHouse, and MongoDB. Drives the booking
  flow with a Playwright-backed set of stateless CLI tools
  (qa-search → qa-search-telemetry → qa-book → qa-validate → qa-cleanup)
  and lets the agent decide retries and pass/fail based on evidence dumps
  and a documented checklist.
---

# QA Automation

Drive a real test booking on `staging{QA_STAGING_PREFIX}.flighthub.com` /
`staging{QA_STAGING_PREFIX}.justfly.com`, then validate it across the three
DB layers we care about (MySQL `ota`, ClickHouse `jupiter`, MongoDB `ota`).

Five CLI tools, each stateless. Each tool emits a **single JSON object on
stdout**; errors have an `error` key and a non-zero exit code. Stderr carries
logs only.

| Tool | Purpose |
|------|---------|
| `qa-search` | Drive the homepage search form, land on `/flight/search`, enumerate packages. Returns `search_url`, `transaction_id` (if captured), `packages`, `debug_filter_sources`. |
| `qa-search-telemetry` | ClickHouse lookup: which content sources responded for a given `transaction_id` / `search_hash`. Used to decide whether to retry search or proceed to book. |
| `qa-book` | Re-open the `search_url`, pick a package (by content source or index), autofill checkout, submit, wait for confirmation, resolve `booking_id` + `debug_transaction_id` via MySQL. |
| `qa-validate` | Dump raw evidence for a booking across MySQL / ClickHouse / MongoDB. No judgment — the agent compares the dump with `references/validation_checklist.md`. |
| `qa-cleanup` | Cancel the test booking via ResPro. Idempotent. |

Plus `qa-diag` for selector health checks when Playwright timeouts look like
selector rot.

Exact inputs, output schemas, and error bodies live in
[`references/tools.md`](references/tools.md).

## When to invoke

- User asks for a live booking test on staging: "book via amadeus on YUL-LAX",
  "reproduce a booking on tripstack", "end-to-end test for content source X",
  "validate a staging booking across the 3 DBs".
- User passes an existing `booking_id` / `id_hash` / `transaction_id` and asks
  to "re-validate" a prior booking without re-creating it — skip straight to
  `qa-validate`.
- User reports "Playwright keeps timing out on the search page" or "selector
  X stopped working" — run `qa-diag` first.

Do not invoke this skill for data-only investigations (bookability rates,
optimizer audits) — those use `/bookability_analysis` or `/optimizer_analysis`.

## Decision flow

```mermaid
flowchart TD
    Start([Scenario: book on source X, route Y, date Z]) --> Search["qa-search"]
    Search -->|"packages empty OR source not listed"| Retry1{"retry?"}
    Retry1 -->|"yes"| Shift["shift depart +/- 1-2 days, or alt route"]
    Shift --> Search
    Retry1 -->|"no - budget used"| Report["report failure with evidence"]
    Search -->|"packages include X"| Tele["qa-search-telemetry"]
    Tele -->|"source X not in sources_called"| Retry2{"retry?"}
    Retry2 -->|"yes"| Shift
    Retry2 -->|"no"| Report
    Tele -->|"source X called successfully"| Book["qa-book --content-source X"]
    Book -->|"source_not_available_in_ui / checkout_render_timeout"| Retry3{"retry?"}
    Retry3 -->|"yes"| Search
    Retry3 -->|"no"| Report
    Book -->|"confirmed"| Validate["qa-validate"]
    Validate --> Judge{"evidence vs validation_checklist"}
    Judge -->|"all invariants met"| Pass["report pass"]
    Judge -->|"partial fail"| Diag["report gaps with evidence"]
    Pass --> Clean["qa-cleanup (optional)"]
    Diag --> Clean
```

Retry budget, ladder, and terminating conditions:
[`references/retry_policy.md`](references/retry_policy.md).

Known staging quirks (slow checkout render, USD override on staging2,
third-party route blocker, content-source availability swings):
[`references/known_issues.md`](references/known_issues.md).

Interpreting `qa-validate` output:
[`references/validation_checklist.md`](references/validation_checklist.md).

Current selector inventory (dated) + staging DOM notes:
[`page_inventory.md`](page_inventory.md).

## Invocation

All tools are console scripts registered in
[`qa_automation/pyproject.toml`](../../../qa_automation/pyproject.toml) and
installed by `uv sync` inside `qa_automation/`. Run them from the repo root
with `uv run` so they pick up the `.env` at the top of the repo:

```bash
cd qa_automation && uv run qa-search \
    --origin YUL --dest LAX --depart 2026-07-15 --trip-type oneway \
    --label amadeus-smoke
```

`qa-book` reuses the scenario dir from `qa-search` so all screenshots for
one attempt land in the same folder:

```bash
cd qa_automation && uv run qa-book \
    --search-url "https://staging2.flighthub.com/flight/search?..." \
    --content-source amadeus \
    --scenario-dir qa_automation/reports/20260423-130000-amadeus-smoke
```

`qa-validate` needs at least one of `--booking-id`, `--id-hash`,
`--transaction-id`. `qa-cleanup` takes `--booking-id`.

### Where to redirect stdout/stderr

When you capture a runner's JSON for inspection (e.g. piping through `jq`,
or saving for a later step), write the dumps under
`qa_automation/reports/_stdio/<tool>-<label>.{json,log}` — never next to
`pyproject.toml` or inside the `qa_automation/qa_automation/` package
dir. `qa_automation/reports/` is gitignored, so anything in `_stdio/`
stays out of the repo. Create the dir on first use:

```bash
mkdir -p qa_automation/reports/_stdio
cd qa_automation && uv run qa-search ... \
    > reports/_stdio/search-amadeus.json \
    2> reports/_stdio/search-amadeus.log
```

Per-scenario evidence (screenshots, `trace.zip`) still goes to the
scenario dir under `qa_automation/reports/<UTC-timestamp>-<label>/` —
that part is unchanged.

## Read the evidence, do not trust

`qa-validate` never returns `pass=true`. It returns rows and payloads. Read
[`references/validation_checklist.md`](references/validation_checklist.md)
and apply the invariants field-by-field before reporting an outcome. If a
check is ambiguous — say, `bookings.status = not_issued` right after book —
say so. Do not over-interpret.

## Run summary: write for QA, not for the agent's author

When the agent finishes a run, the final message to the user is a short
**run summary** plus the per-row validation table whose shape lives on
sibling card [https://trello.com/c/UEZ0oMf4](https://trello.com/c/UEZ0oMf4).
Both pieces are written for a QA / business reader. The agent's internal
probes, fallbacks, exception class names, and "not blocking" hedges stay
in the scenario dir and terminal output; they do not show up in the
summary.

### Structure

A run summary has three parts, in this order:

1. **Header paragraph** — booking ID, env, supplier, route + date(s),
   trip type. One sentence.
2. **Per-stage outcomes** — one bullet per stage in pipeline order
   (Search, Search telemetry, Book, Validate, Cleanup). One line each.
   Skipped stages get one line saying so ("Cleanup not run — booking
   left in place at user request.").
3. **Validation table** — the canonical per-row table (columns
   `Booking ID | Validation | Verdict | Explanation | Proof`) per
   sibling [https://trello.com/c/UEZ0oMf4](https://trello.com/c/UEZ0oMf4).
   This card owns the wording in the `Explanation` column; the sibling
   owns the columns and verdict vocabulary
   (`PASS` / `FAIL` / `AMBIGUOUS` / `SKIPPED`).

A one-line tail with the overall verdict is optional. Anything else
(internal narratives, raw JSON, traceback dumps, retry ladders) belongs
in the scenario dir or terminal log, not in the summary.

### QA voice rules

- **Name the business outcome**, not the internal mechanic. "Search
  returned 17 packages on Amadeus" / "Booking confirmed at $437.20 USD"
  / "Supplier rejected the fare — flight no longer available" / "Card
  declined as expected for the CC Decline scenario" / "Cleanup
  cancelled the booking in ResPro". Not "selector probe ok" /
  "checkout React form mounted" / "PaymentDeclined exception caught".
- **Plain English. No internal lexicon in the summary.** Banned in the
  summary (still fine in scenario dir / stdout / skill internals):
  - Internal field names: `transaction_id`, `id_hash`,
    `debug_transaction_id`, `search_hash`, `search_id`, `gds_raw`,
    `package_id`, `is_test`.
  - Internal class names: `Mv_Ota_Air_Booker_Exception_*`,
    `unhandled_exception`, `selector_not_found`,
    `payment-stage-mount-failed`, `confirmation_url_timeout*`.
  - Internal endpoint names: `storefront-API`, `/storefront-api/`,
    `debug-logs/log-group`, `search_api_stats`.
  - Playwright / runner vocabulary: `selector`, `probe`, `mounted`,
    `autofill`, `Debug Filter`, `Debugging Options`.
- **Translate to QA-facing names** where the concept needs to surface:
  `transaction_id` → "booking session ID"; `id_hash` → "portal
  booking ID"; `content_source` → "supplier" (or just the name,
  "Amadeus"); `debug-logs/log-group/<id>` → "supplier log group" with
  the URL as `Proof` in the table; `is_test=1` → "flagged as a test
  booking".
- **Drop `not blocking` hedging.** If a probe miss does not change
  what QA does, omit it entirely — it is internal noise. If it does
  change something, state the **consequence** in plain language:
  "Per-leg supplier log group is not available for this run, so the
  validation table cannot link a supplier permalink for `debug_logs
  presence`." Not: "storefront-API URL probe missed; not blocking".
- **Translate retries / fallbacks** to outcome prose. "Search retried
  once on the next day after no packages came back the first time."
  Not: "fell back to IATA" / "shifted depart +1 per retry policy".
  The retry ladder lives in
  [`references/retry_policy.md`](references/retry_policy.md), not in
  the summary.
- **Errors: translate the failure path** into what happened from the
  user's seat. `unhandled_exception` → "Search failed unexpectedly;
  full traceback in the scenario dir." `selector_not_found` → "The
  site's checkout layout changed; the runner could not reach the
  payment step. Selector probe output saved to the scenario dir."
  `booking_failed_in_pipeline` with `failure_origin=supplier` →
  "Supplier rejected the fare (no longer available)."
  `failure_origin=payment_processor` → "Our payment gateway declined
  the card."  `failure_origin=our_pricing_guard` → "Price drifted
  past our loss-limit guard."
- **Failure-injection runs are not failures.** A
  `--booking-failure-reason "CC Decline"` run that lands in
  `booking_failed_by_injection` with
  `failure_origin=qa_injection` is the **expected outcome** and the
  summary says so: "CC Decline scenario behaved as expected — payment
  page re-rendered with the credit-card alert; no charge was made and
  no booking was persisted."

### Where the diagnostics go

The headline summary is the deliverable. The agent does not lose the
diagnostics; they are already on disk:

- **Tool stdout / stderr** — full JSON dump per stage, captured under
  `qa_automation/reports/_stdio/<tool>-<label>.{json,log}` per
  [Where to redirect stdout/stderr](#where-to-redirect-stdoutstderr).
  Internal field names, raw exception classes, retry chatter, the
  `qa-book` stderr banner — all there.
- **Scenario dir** (`qa_automation/reports/<UTC>-<label>/`) —
  screenshots, `trace.zip`, `qa-diag` probe output when a selector
  miss fired.
- **Supplier log groups** — when the validation table needs them as
  `Proof`, the cell is the raw permalink URL (one URL per cell, per
  sibling [UEZ0oMf4](https://trello.com/c/UEZ0oMf4)).

If the summary surfaces a single internal artefact, it is a **path**
("scenario dir: `qa_automation/reports/<UTC>-<label>/`") so the
engineer can drill in. Never paste raw JSON, raw class names, raw
selectors, or stderr banners into the summary itself.

### Worked examples

Two pinned anchor examples — staging happy path and production
`CC Decline` injection — live in
[`references/run_summary_voice.md`](references/run_summary_voice.md).
Match those when writing a run summary. Each example pairs the
**internal-voice version (do NOT write this)** with the **QA-voice
version (write THIS)** so the rewrite is unambiguous, and a
stage-by-stage phrase bank covers the cases the two examples do not.

## When the UI breaks

If a runner returns `{"error": "selector_not_found", "name": "..."}`,
invoke `qa-diag --url <url> --page <page>` to list every probed selector.
Update [`qa_automation/qa_automation/pages/selectors.py`](../../../qa_automation/qa_automation/pages/selectors.py),
bump the `VERIFIED_ON` date, and refresh [`page_inventory.md`](page_inventory.md).
Do not edit selectors elsewhere — that file is the single source of truth.

## Known open items

_(none currently tracked — Summit selectors confirmed 2026-04-26 on card
[`ue37vUp5`](https://trello.com/c/ue37vUp5).)_
