---
name: qa-automation
description: >-
  Use when creating real test bookings on FlightHub / JustFly staging or
  production and validating them across MySQL, ClickHouse, and MongoDB.
  Drives the booking flow with a Playwright-backed set of stateless CLI
  tools (qa-search → qa-search-telemetry → qa-book → qa-validate →
  qa-cleanup) and lets the agent decide retries and pass/fail based on
  evidence dumps and a documented checklist. Production runs default to a
  controlled CC Decline injection so cards are never charged.
---

# QA Automation

Drive a real test booking on `staging{QA_STAGING_PREFIX}.flighthub.com` /
`staging{QA_STAGING_PREFIX}.justfly.com` or on production
(`www.flighthub.com` / `www.justfly.com`), then validate it across the
three DB layers we care about (MySQL `ota`, ClickHouse `jupiter`,
MongoDB `ota`).

Both environments share the same DBs — `qa-validate` and `qa-cleanup`
work the same regardless of where the booking originated. The
production-vs-staging UI differences (no Debug Filter dropdown,
`<a>` Select buttons, "Reject Non-Essential" cookie banner, etc.) are
absorbed inside the page objects and runners; callers simply pass
`--env production` (or a `www.*` `--search-url`) to `qa-search` /
`qa-book`. See [`references/known_issues.md`](references/known_issues.md)
"Production vs staging differences" for the full inventory.

**Production safety**: `qa-book` defaults to injecting a
`CC Decline` failure via the Debugging Options panel on every
production run. The booker pipeline short-circuits before contacting
the supplier or the payment gateway — the card is never charged.
The runner detects the user-facing CC-decline alert post-submit
and emits `booking_failed_by_injection` (with
`failure_origin=qa_injection`); that is the **expected outcome of
every production safety-rail run**. To run a real production
booking against a supplier you must explicitly pass
`--booking-failure-reason none --i-know-this-charges-real-money`;
even then, the platform's own protections (test-card detection at
the gateway) are the only safety net.

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

- User asks for a live booking test on staging or production: "book via
  amadeus on YUL-LAX", "reproduce a booking on tripstack",
  "end-to-end test for content source X", "validate a staging booking
  across the 3 DBs", "run a prod E2E against unififi".
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

For a production E2E (auto-injects `CC Decline` — supplier never sees
the booking, card is never charged):

```bash
cd qa_automation && uv run qa-search --env production \
    --origin YUL --dest LAX --depart 2026-07-15 --trip-type oneway \
    --label prod-amadeus-smoke
cd qa_automation && uv run qa-book \
    --search-url "https://www.flighthub.com/flight/search?..." \
    --content-source amadeus \
    --scenario-dir qa_automation/reports/<UTC>-prod-amadeus-smoke
# qa-book emits a banner to stderr summarising env / failure-reason /
# resolved card before submitting; capture it for the run report.
```

`qa-validate` needs at least one of `--booking-id`, `--id-hash`,
`--transaction-id` — both staging and production bookings live in the
same `ota.bookings` table. `qa-cleanup` takes `--booking-id` and
optionally `--env` (default: from `QA_ENV`); ResPro is shared between
envs so the cleanup URL is identical.

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

## When the UI breaks

If a runner returns `{"error": "selector_not_found", "name": "..."}`,
invoke `qa-diag --url <url> --page <page>` to list every probed selector.
Update [`qa_automation/qa_automation/pages/selectors.py`](../../../qa_automation/qa_automation/pages/selectors.py),
bump the `VERIFIED_ON` date, and refresh [`page_inventory.md`](page_inventory.md).
Do not edit selectors elsewhere — that file is the single source of truth.

## Known open items

_(none currently tracked — Summit selectors confirmed 2026-04-26 on card
[`ue37vUp5`](https://trello.com/c/ue37vUp5).)_
