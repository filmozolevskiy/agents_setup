---
name: qa-automation
description: >-
  Use when creating real test bookings on FlightHub / JustFly staging or
  production and validating them across MySQL, ClickHouse, and MongoDB.
  Drives the booking flow with a Playwright-backed set of stateless CLI
  tools (qa-search → qa-search-telemetry → qa-book → qa-validate →
  qa-cleanup) and lets the agent decide retries and pass/fail based on
  evidence dumps and a documented checklist. Every run goes end-to-end
  through the supplier and the payment gateway by default; failure
  injection (CC Decline / Fraud / Fare Increase / etc.) is opt-in via
  --booking-failure-reason.
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

**Failure injection is opt-in**: by default `qa-book` runs every
booking end-to-end through the supplier and the payment gateway, on
both staging and production. To exercise a specific failure path,
pass `--booking-failure-reason "CC Decline"` (or any other
Debugging Options label — `Fraud`, `Fare Increase`,
`Flight Not Available`, etc.). When the flag is set the booker
short-circuits before contacting the supplier or the payment
gateway, no `ota.bookings` row is persisted, and the runner emits
`booking_failed_by_injection` with `failure_origin=qa_injection` —
that is the expected outcome of any injection run.

**Production safety net** (when no injection flag is passed) is
provided by the platform, not the runner:

- `is_test=1` is set server-side on every `qa-book` booking via the
  autofill query param, which blocks real ticketing.
- The platform's own test-card detection / CC decline at the
  gateway catch obvious test traffic.
- `CancelTestBookings` is a production cron that cancels any
  leaked rows whose ResPro cancel didn't complete.

So a default production run *does* hit the supplier and the
payment gateway; tickets are just blocked from issuing. Use
`--booking-failure-reason "CC Decline"` whenever the test goal is
specifically the failure path — not as a routine safety rail.

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

## When the user names a content source, pin to it — period

When the user names a content source for the booking ("book on
Amadeus", "test Downtowntravel end-to-end", "reproduce on tripstack"),
the booking must actually land on that source. The agent has one
move: pass `--content-source <source>` to `qa-book`. The runner then
auto-flips **Debugging Options → Disable Optimizer/Repricer = Yes**
so the repricer cannot swap the candidate to a different supplier
mid-checkout. There is no override flag and no diagnostic carve-out.

If the pinned source fails (`payment-stage-mount-failed`,
`selector_not_found name=checkout.autofill_link`,
`checkout_render_timeout`, `source_not_available_in_ui`), retry per
[`references/retry_policy.md`](references/retry_policy.md) — a
date shift (±1 / ±7 days) or a different route, **always with
`--content-source <same source>`**. Switching to a different
`--content-source`, dropping the flag to let the optimizer pick, or
falling back to `--package-index N` (which is mutually exclusive
with `--content-source` and would lift the pin) is **not** a retry
— it's a different scenario. If the pinned source genuinely cannot
book on production within the retry budget, report that to the user;
do not silently book on a different source.

`--package-index N` runs (mutually exclusive with `--content-source`)
are for cases where the user has not named a source — they exercise
the production path with the optimizer enabled and are not subject
to this rule. Background on the auto-flip:
[`references/known_issues.md`](references/known_issues.md)
"Optimizer reroutes content-source-specific bookings".

## When `--carrier` is specified, it always means the marketing/validating carrier

When the user names a specific carrier ("book on TK", "AC test
booking", "make it land on UA"), they always mean the
**marketing/validating carrier** — the airline that issues the
ticket and whose flight-number prefix appears on the boarding
pass. They do **not** mean an operating-only codeshare leg. A
booking where the validating carrier is `UA` and one segment is
`UA1234 operated by TK` does **not** satisfy a `--carrier TK`
request.

The `--carrier <IATA>` filter on `qa-book` enforces this on the
result-page side:

* The flight-number signal (`<IATA><digits>` like `TK17`,
  `Flight TK 1762`) is the canonical marketing-carrier check —
  the prefix **is** the marketing carrier.
* The display-name fallback (`Turkish Airlines` for collapsed
  Best/Cheapest cards that don't print flight numbers) is
  scoped to *marketing* mentions only: any occurrence preceded
  by `"Operated by "` within ~25 chars is rejected. So
  `"United Airlines, Operated by Turkish Airlines"` matches
  `--carrier UA` (UA is marketing) and is rejected for
  `--carrier TK` (TK is operating-only).

After the booking lands, **always confirm with `qa-validate`
that `mysql.bookings.validating_carrier == <requested code>`** —
the result-page filter is necessary but not sufficient (the
booker can still pivot to a different validating carrier on
re-pricing). If `validating_carrier` does not match, the run
does not satisfy the request: cancel and retry with a different
date/route per the retry policy.

If a carrier genuinely cannot be booked on the requested source
within the retry budget (typical for thin transatlantic
inventory like TK on Downtowntravel from YYZ origins), report
that to the user; do not silently land on a different
marketing carrier.

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

For a production E2E (no injection — real end-to-end booking
through the supplier and payment gateway; ticketing is blocked
server-side by `is_test=1`):

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

For an opt-in failure-path test (booker short-circuits, no supplier
call, no gateway authorisation):

```bash
cd qa_automation && uv run qa-book \
    --search-url "https://www.flighthub.com/flight/search?..." \
    --content-source amadeus \
    --booking-failure-reason "CC Decline" \
    --scenario-dir qa_automation/reports/<UTC>-prod-amadeus-cc-decline
# Expected outcome: booking_failed_by_injection with
# failure_origin=qa_injection.
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
