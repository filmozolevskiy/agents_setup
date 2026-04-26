# QA Automation — Known Issues & Staging Quirks

Distilled from the plan's "Constraints and known staging quirks" section and
from `page_inventory.md`. When something here bites a run, the agent should
mention the specific quirk in the final report rather than treating it as
a bug.

## Checkout React form takes 30–90 s to render

- `CheckoutPage.autofill()` waits up to 120 s for `#submit_booking` to
  appear after the autofill link is clicked.
- If mount exceeds 120 s the runner returns `checkout_render_timeout`.
  Usually this means a backend API returned 500 for the chosen package;
  retry or pick another package.

## Staging2 always returns USD

- `staging2.flighthub.com` ignores `--pos` and `--currency` and shows
  prices in USD. `qa-validate`'s checklist treats
  `bookings.currency != currency_hint` as **AMBIGUOUS**, not FAIL.

## Content source availability varies by day

- Not every source publishes fares for every day. If a source has 0
  packages, try ±1 / ±7 days before giving up (see
  [`retry_policy.md`](retry_policy.md)).

## Optimizer reroutes content-source-specific bookings

- The optimizer can reprice a candidate at book time and land the booking
  on a different provider than what the Debug Filter selected (observed
  `atlas` → `Tripstack` on SJU→FLL). The ResPro `Provider` column, not the
  `--content-source` flag, is the truth at ticketing.
- `qa-book` now auto-flips the staging-only **Debugging Options →
  Disable Optimizer/Repricer** select to **Yes** whenever
  `--content-source` is passed, to pin the source. `--package-index` runs
  leave the optimizer enabled on purpose (they exercise the production
  path).
- If the toggle is missing (production build, panel renamed), the runner
  fails with `selector_not_found name=checkout.disable_optimizer` —
  safer than silently letting the optimizer reroute.

## `is_test=1` backstop

- All bookings driven by these tools have `is_test=1` in
  `ota.bookings`. Production infra has a `CancelTestBookings` cron that
  cancels leaked rows if ResPro cancel fails.
- `qa-cleanup` is therefore best-effort at the scenario level — a cancel
  failure should be surfaced but rarely blocks the run.

## PNRs / tickets are empty until ticketing

- `bookings.status` is `not_issued` right after `qa-book`; do not assert
  on `status = issued`. Ticketing runs async.
- Similarly `pnr_code`, `ticket_number` etc. are NULL until the carrier
  issues tickets (can be minutes to hours).

## ResPro URL is not staging-prefixed

- ResPro always lives at
  `https://reservations.voyagesalacarte.ca/booking/index/{booking_id}`,
  regardless of which staging environment produced the booking. The
  `resolve_url(App.RESPRO, ...)` helper handles this.

## Third-party scripts redirect the search submit

- The homepage search form's Submit button opens a popup. Without the
  route-blocker in [`qa_automation/browser.py`](../../../qa_automation/qa_automation/browser.py),
  ClickTripz / TripAdvisor scripts can hijack the main tab and the popup
  never lands on `/flight/search`.
- The route-blocker passes through any URL whose host ends with one of
  `flighthub.com`, `justfly.com`, `voyagesalacarte.ca`, and blocks
  third-party `script` + `document` requests.

## Cookie / tracking banners cover the first click

- `ResultsPage` and `CheckoutPage` dismiss visible "Accept All" / "Reject
  All" banners before the first interaction. If a new banner appears, add
  it to `CHECKOUT.cookie_accept` / `RESULTS.cookie_accept`.

## Autofill shortcut

- Staging exposes a `?af=78FF47` autofill query param; the `Autofill`
  link on the checkout form appends it automatically when clicked.
- Full autofill data (passenger details, card, passport) is pre-populated.
  Override individual fields via `qa-book --cc-*` flags if needed.

## Selector rot is expected

- Staging front-end deploys change selectors without warning. Every
  runner's error body includes the failing selector `name`.
- Fix by editing [`qa_automation/qa_automation/pages/selectors.py`](../../../qa_automation/qa_automation/pages/selectors.py)
  and bumping `VERIFIED_ON`. Re-run `qa-diag --url <url> --page <page>` to
  confirm all selectors are found before declaring the fix complete.

## ClickHouse search telemetry → `search_api_stats.gds_raw`

- `qa-search-telemetry` defaults to `search_api_stats.gds_raw` — one row
  per (`search_id`, `content_source`, `api_call`) with the actual
  `response`, `response_time`, and per-call package counts. Schema is
  documented in
  [`db-docs/clickhouse/search_api_stats_gds_raw.md`](../../../../db-docs/clickhouse/search_api_stats_gds_raw.md).
- **Always pass a time window.** `gds_raw` is a Distributed table with no
  partition key or sorting key. Without a `date_added` predicate, queries
  full-scan the shards (tens of seconds to minutes). The runner defaults
  to 24 h (`--window-hours`); `qa-validate` uses the same default via
  `--search-telemetry-window-hours`.
- Override the table via `QA_CH_SEARCH_TELEMETRY_TABLE` in `.env` only if
  the schema changes — the runner relies on columns `search_id`,
  `content_source`, `response`, `response_time`, `num_packages_*`,
  `api_call`, `search_type`, `date_added`.
- Multiple rows per `(search_id, content_source)` are expected — each is
  one supplier API call. Follow-up calls (`search_type != 'main'`) share
  the same `search_id`. When you only care about the initial search, look
  at `search_type = 'main'` in the raw rows.
