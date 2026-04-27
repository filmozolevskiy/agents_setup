# QA Automation — Known Issues & Env Quirks

Distilled from the plan's "Constraints and known staging quirks" section
and from `page_inventory.md`. Covers both staging and production — when
behaviour diverges, the section title calls it out (e.g. "Production vs
staging differences"). When something here bites a run, the agent should
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
- `qa-book` auto-flips the **Debugging Options →
  Disable Optimizer/Repricer** select to **Yes** whenever
  `--content-source` is passed, to pin the source. The toggle renders
  on **both staging and production** (verified 2026-04-26), so this
  applies regardless of `--env`. `--package-index` runs leave the
  optimizer enabled on purpose (they exercise the production path).
- If the toggle goes missing (panel renamed, build regression), the
  runner fails with `selector_not_found name=checkout.disable_optimizer`
  — safer than silently letting the optimizer reroute.

## `is_test=1` backstop (staging + production)

- All bookings driven by these tools have `is_test=1` in
  `ota.bookings`. The flag is set server-side by the `?af=78FF47`
  autofill query param, which the `CheckoutPage.autofill` step
  triggers via the visible `Autofill` link on **both staging and
  production** (verified by inspecting recent `is_test=1` rows on
  multiple `site_id`s — see card `weaSgLaj`).
- Production infra has a `CancelTestBookings` cron that cancels
  leaked rows if ResPro cancel fails. `qa-cleanup` is therefore
  best-effort at the scenario level — a cancel failure should be
  surfaced but rarely blocks the run.

## Production safety rail (qa-book)

- `qa-book` defaults to injecting a `CC Decline` failure via the
  Debugging Options panel on every production run. The booker
  short-circuits before contacting the supplier or the payment
  gateway, so the card is never actually charged, no PNR is
  created, and **no `ota.bookings` row is persisted** — instead the
  payment stage re-renders with the user-facing
  "Credit Card check failed" alert.
- The runner detects that alert post-submit and emits
  `booking_failed_by_injection` (with
  `failure_origin="qa_injection"`, `front_end_message=<banner>`,
  `front_end_markers=["cc_decline"]`). This is the expected
  outcome of every production safety-rail run — treat it as a
  successful end-to-end exercise of the prod pipeline, not a
  failure to clean up.
- To run a real booking attempt against the supplier on production,
  pass `--booking-failure-reason none --i-know-this-charges-real-money`.
  Without the ack flag the runner emits `production_safety_rail` and
  exits before launching a browser. The platform's own protections
  (test-card detection / CC decline at the gateway) are the only
  remaining safety net once the injection is disabled.
- A run-summary banner is printed to **stderr** before submit on
  every `qa-book` invocation: env, host, content_source,
  package_index, booking_failure_reason, and (if `--cc-*` was passed)
  a masked card preview. Capture stderr alongside stdout when running
  on production so the audit trail for "what we submitted" lives next
  to the JSON report.

## Production vs staging differences

Most selectors are unioned in `pages/selectors.py`, so callers do not
care about the env. The four behavioural differences worth knowing are:

| Surface | Staging | Production |
|---|---|---|
| Cookie banner | "Accept All" / "Reject All" | adds "Reject Non-Essential" |
| Select CTA | `<button>Select</button>` | `<a>Select</a>` |
| Continue to checkout | inline "Continue to checkout" | fare-family modal ending in "Checkout" |

The Autofill link, `is_test=1` flag, Debug Filters dropdown
(`select#gds`), Debugging Options panel (`Disable Optimizer/Repricer`,
`Booking Failure Reason`), per-card "Show Info" toggle, and ResPro
cancellation all behave identically across the two envs as of
2026-04-26. `qa-book` keeps a per-card "Show Info" fallback for
content-source pinning that engages automatically if a future build
ever drops the `select#gds` dropdown.

## Production "Something went wrong" mid-checkout (transient inventory)

- Production occasionally shows a full-page "Something went wrong /
  Sorry, we experienced an issue loading your flight package" between
  Select and the payment stage. The package became unavailable
  between the Select click and the checkout/payment render. Two
  shapes have been observed:
  - On the `/checkout/billing/flight/...` page itself: the React
    form never mounts, `Autofill` is never visible. `qa-book`
    surfaces this as `selector_not_found name=checkout.autofill_link`
    with the error page captured in
    `001-missing-checkout-autofill_link.png`.
  - After "Continue to payment" on a two-stage package: the payment
    form (`#submit_booking`) never renders. `qa-book` surfaces this
    as `checkout_render_timeout` with
    `008-payment-stage-mount-failed.png`.
- This is a real production response, not an automation bug. Retry
  with a different `--package-index`, a different `--content-source`,
  or shift the date by ±1/±7 days.

## Production: B6 (JetBlue) packages have poor bookability

- B6 (JetBlue) has a **carrier-level bookability problem** on
  production: most B6 packages refuse to mount the payment SDK
  after `Continue to payment` and JustFly / FlightHub redirect to
  the full-page "Something went wrong / Sorry, we experienced an
  issue loading your flight package" error. The failure is
  property of the B6 inventory itself, not of the GDS the package
  is sourced from or of the automation pinning a particular source.
- Verified 2026-04-27 on JustFly EWR→SJU 2026-06-19: the
  optimizer's package #0 / #1 are Blue Basic on B6 and consistently
  fail (`payment-stage-mount-failed` with
  `008-payment-stage-mount-failed.png`). Backend logs
  (`ota.debug_logs`) show every API call succeed up through
  `check-availability-comparison-report`, then the page redirects
  without mounting the payment SDK. `--package-index 2` on the
  exact same search URL (a non-B6 itinerary) ran end-to-end
  through Amadeus `[YKXC42100]` + `[ATL1S211S]` + Amadeus seatmap
  retrieval + `post-air-booker` and hit the expected CC Decline
  banner at the gateway (`booking_failed_by_injection`). Only the
  carrier on the chosen package changed.
- This is **not** an Amadeus-wide bookability issue. The same
  Amadeus office `ATL1S211S` books cleanly when paired with other
  carriers (DL, UA, AC, AZ, IB, ...) — the DB has 20+ recent
  successful Amadeus prod test bookings on FlightHub and JustFly
  across CAD and USD on YUL/EWR/MIA/LAX/MTY origins.
- Practical guidance for `qa-book` on production:
  - **Avoid B6 routes when picking a test route.** EWR/JFK/BOS/FLL
    →SJU/MCO/LAX are all B6-heavy and likely to surface a B6
    package as #0 — pick a route where the dominant carrier is
    AC/DL/UA/AA/WS/AZ/IB/etc. instead.
  - When you do hit `payment-stage-mount-failed` /
    `checkout_render_timeout` /
    `selector_not_found name=checkout.autofill_link`, **bump
    `--package-index` (1, then 2, etc.) until you skip past the
    B6 package(s).** The next non-B6 package is usually healthy.
    (Track via `content_source_booked` in the JSON output and
    `bookings.validating_carrier` post-hoc.)
  - The `--keep-optimizer` flag exists for diagnosis: it skips the
    "Disable Optimizer/Repricer = Yes" toggle so the optimizer is
    free to repackage the candidate at checkout. It does not fix
    the B6 case but separates "filter pins to source" from
    "optimizer disabled" in the evidence trail.
  - Do **not** revive the previously-documented "Amadeus prod-pin is
    unbookable" claim. Amadeus prod packages book fine when the
    chosen package is on any non-B6 carrier.

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

- `ResultsPage` and `CheckoutPage` dismiss visible
  "Accept All" / "Reject All" / **"Reject Non-Essential"** banners
  before the first interaction. The third variant only renders on
  production (verified 2026-04-26) but is part of the union
  selector, so the same dismiss path covers both envs. If a new
  banner copy appears, add it to `CHECKOUT.cookie_accept` /
  `RESULTS.cookie_accept`.

## Autofill shortcut (staging + production)

- The `Autofill` link appends a testing query param (e.g.
  `?af=78FF47`) and triggers full pre-fill of passenger details,
  card, and passport. Same anchor and behaviour on both staging
  and production — including setting `is_test=1` server-side on
  the resulting `ota.bookings` row.
- Override individual card fields via `qa-book --cc-*` flags if
  needed. On production with `--booking-failure-reason none` the
  resolved card is logged (masked) to stderr before submit.

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
