# QA Automation — Page Inventory

All selectors verified against **staging2.flighthub.com**,
**staging2-summit.flighthub.com** (Summit), and
**reservations.voyagesalacarte.ca** (ResPro) on **2026-04-26**.
Casper-era selectors have been replaced. Selector constants live in
[`qa_automation/qa_automation/pages/selectors.py`](../../../qa_automation/qa_automation/pages/selectors.py);
the `VERIFIED_ON` string in that file must match this header.

---

## Critical: Third-Party Ad Blocking

[`qa_automation/qa_automation/browser.py`](../../../qa_automation/qa_automation/browser.py)
injects a route handler on every `BrowserContext` that blocks:
- **Third-party scripts** (`resource_type == "script"` not from flighthub.com/justfly.com)
- **Third-party document navigations** (ClickTripz, TripAdvisor, etc.)

Without this, submitting the search form redirects to hotel ad networks instead of `/flight/search`.
Route blocking is transparent to the FlightHub application — all first-party JS/XHR/navigation works normally.

---

## 1. Search Page (`/` homepage)

| Element | Selector |
|---------|----------|
| Search form | `form.flight-search-form` |
| Trip type oneway | `div.trip-type-oneway` |
| Trip type roundtrip | `div.trip-type-roundtrip` |
| Origin wrapper (click target) | `div.search-form-input.departure` |
| Origin display input | `#seg0_from_display` |
| Dest display input | `#seg0_to_display` |
| Autocomplete — origin | `page.get_by_text('{IATA} - {Name}', exact=False).first.click()` |
| Autocomplete — dest | `keyboard.press("ArrowDown")` + `keyboard.press("Enter")` |
| Date picker open | click `#seg0_date` |
| Date picker next month | `.rdrNextButton` |
| Day cells (selectable) | `.rdrDay:not(.rdrDayDisabled):not(.rdrDayPassive)` |
| Date picker close | `button:has-text("Done")` |
| Submit button | `div.home-search-form-submit` |

**Notes:**
- Click origin wrapper `div.search-form-input.departure` to activate the input
- For destination, use JS `document.getElementById('seg0_to_display').focus()` then type — the wrapper intercepts pointer events
- After submit, browser navigates to `/flight/search?num_adults=1&...&seg0_from=YUL&seg0_to=LAX&seg0_date=YYYY-MM-DD`

---

## 2. Search Results Page (`/flight/search?...`)

| Element | Selector |
|---------|----------|
| Select button | `button:has-text("Select")` |
| Bundle modal | `[role="dialog"]` or `#modal_box` |
| Dismiss bundle | `.continue-with-flight-only-btn` |
| Fare loading indicator | `text=Fetching fare information` |
| Continue to checkout | `button:has-text("Continue to checkout")` |

**Flow (3-step SPA, URL unchanged until step 3):**
1. Wait for `button:has-text("Select")` → click first one
2. Bundle modal opens → click `.continue-with-flight-only-btn`
3. Fare family loads inline → wait for `text=Fetching fare information` state=hidden (up to 30s)
4. Click `button:has-text("Continue to checkout")` → navigates to `/checkout/billing/flight/...`

**search_hash** is resolved post-booking via `ota.bookings.debug_transaction_id`.

---

## 3. Checkout Page (`/checkout/billing/flight/{package_id}/{hash_key}?`)

| Element | Selector |
|---------|----------|
| Autofill link | `a:has-text("Autofill")` → get href → `page.goto(href)` |
| Submit button | `#submit_booking` (text: "Confirm and Book") |
| Insurance decline | JS `label.find(:has-text("No thanks")).click()` |
| Card number | `#cc_number` |
| Card expiry | `#cc_expiry` |
| Card CVV | `#cc_cvv` |
| Cardholder name | `#cc_name` |
| Passenger 1 first name | `#p1_first_name` |
| Passenger 1 last name | `#p1_last_name` |
| Passenger 1 DOB | `#p1_dob` |

**URL change from plan:** Now `/checkout/billing/flight/{package_id}/{hash_key}?` — not `/checkout/billing/flight?...`

**Autofill:** `?af=1` does NOT work. Get href from `a:has-text("Autofill")` and navigate to it directly. This uses the staging test user code `?af=78FF47`.

**Insurance gate:** Must explicitly decline Cancellation Protection before submit; otherwise "Please select an option to proceed" blocks submission.

---

## 4. Confirmation Page (`/service/portal/detail/{id_hash}?signature=...`)

| Element | Selector |
|---------|----------|
| Success banner | `text=Your booking was successfully completed!` |
| Post-booking upsell dismiss | `button:has-text("No, I don't want to receive these benefits")` |

**booking_id resolution:** Parse `id_hash` from URL path, then:
```sql
SELECT id FROM ota.bookings WHERE id_hash = '{id_hash}'
-- returns e.g. 297983572
```

No booking number is shown on the page — must be looked up in MySQL.

---

## 5. DB Schema Corrections (vs. original plan)

| Table / Column | Originally Planned | Actual |
|---------------|-------------------|--------|
| `bookings.date_added` | asserted | **does not exist** → use `bookings.booking_date` |
| `bookings.surfer_id` | asserted | **does not exist** |
| `bookings.status` | `"completed"` | enum: `not_issued \| issued \| cancelled \| voided` |
| `bookings.id_hash` | not planned | **present** → portal URL hash → integer id |
| `bookings.debug_transaction_id` | not planned | **present** → = package_id from checkout URL = search_hash for bookability join |

---

## 6. Summit Stats Page

Base URL: `https://staging2-summit.flighthub.com` (Momentum OTA-Admin).
Stats are auth-gated; anonymous requests redirect to `/login`. The
[`SummitStatsPage`](../../../qa_automation/qa_automation/pages/summit_stats_page.py)
runner logs in at the base URL and then navigates straight to
`/flight-search/info/{search_hash}` (the `#searchIdForm` lookup just
redirects to the same path — bypass it).

| Step | URL | Element | Selector |
|------|-----|---------|----------|
| Login | `/` | Login form wrapper | `form.login-form` |
| Login | same | Username (Email) input | `#email` |
| Login | same | Password input | `#password` |
| Login | same | Submit (`Sign In`) | `#process-login` |
| Stats page wrapper | `/flight-search/info/{search_hash}` | Stats container | `#flightSearchStats` |
| Stats page wrapper | same | Search ID lookup form | `#searchIdForm` |
| Stats page wrapper | same | Search ID lookup input | `#search_id` |
| Stats summary (per `search_hash`) | same | `Stats` fieldset summary | `#flightSearchStats fieldset.stats` |
| Search urls table | same | `Search urls` table (per-API-call detail) | `#flightSearchStats fieldset#urlStats table` |

**Notes:**
- Summit's username field is named `email` in the DOM; we keep
  `username_input` as the canonical selector key on `SummitSelectors`
  for parity with `RESPRO.username_input`. The selector itself is
  `#email`.
- The keyed URL only renders a `fieldset.stats` summary when the search
  is still in Summit's in-memory store. The summary's `Expire at` line
  shows ~20 minutes after run, so anything older than that returns the
  same template with an `Error: Search not found` fieldset and *no*
  `fieldset.stats`. `SummitStatsPage.find_search_hash_row()` raises
  `SelectorNotFound("summit.stats_row")` in that case — the `detail`
  string distinguishes "expired vs selector rot" so callers can act on it.
- `find_search_hash_row()` returns the `<dl><dt>/<dd>` pairs inside
  `fieldset.stats` as a `{label: value}` dict (e.g. `Search id`,
  `Started`, `Completed`, `Packages count`, `Runtime`, `Started at`,
  `Expire at`, `Backend`). The keyed page also exposes `Web link`,
  `Api link`, and `Debug log` URLs in the same `dl` head — use the
  `<dd> > a[href]` if you need the underlying URLs (the dict carries
  the link text only).
- `qa-diag --page summit --url https://staging2-summit.flighthub.com/`
  is the canonical anonymous probe and confirms the four login
  selectors. The five `summit.stats_*` selectors require auth and only
  appear in the dump produced by the throwaway logged-in inspector
  (see card [`ue37vUp5`](https://trello.com/c/ue37vUp5)). A `qa-diag`
  call against the keyed stats URL also lands on `/login` (anonymous
  redirect) and will report `summit.stats_*` as missing — that is
  expected, not selector rot. To detect rot in the stats portion, run
  the page object end-to-end (login → `find_search_hash_row(<live hash>)`)
  using a freshly-issued hash from `search_api_stats.gds_raw` (anything
  inside the last ~20 min).
- A live hash for confirmation: pull the most recent
  `search_id` from
  `SELECT search_id FROM search_api_stats.gds_raw WHERE date_added >=
  now() - INTERVAL 5 MINUTE GROUP BY search_id ORDER BY
  max(date_added) DESC LIMIT 1`. Booking-derived hashes
  (`bookings.debug_transaction_id`) age out fast — most are already
  `Search not found` by the time you run the inspector.
- Summit production env (`https://summit.flighthub.com`) is **not**
  covered by this section — the prod end-to-end runbook lives on
  [`weaSgLaj`](https://trello.com/c/weaSgLaj).

---

## 7. ResPro Booking Detail / Cancel

Base URL: `https://reservations.voyagesalacarte.ca` for **both** staging and
production — there is no staging prefix (see "ResPro URL is not
staging-prefixed" in [`references/known_issues.md`](references/known_issues.md)).
The cleanup runner reaches it via `resolve_url(App.RESPRO, qa_env)`.

| Step | URL | Element | Selector |
|------|-----|---------|----------|
| Login | `/login` (or any auth-gated path while logged out) | Login form wrapper | `form` |
| Login | same | Username input | `[name="username"]` |
| Login | same | Password input | `[name="password"]` |
| Login | same | Submit button | `input[type="submit"]` |
| Booking detail | `/booking/index/{booking_id}` | Override to Cancel link (active bookings only) | `text=Override to Cancel` |
| Cancel modal | inline overlay loaded by `requestCancelOverride()` from `/booking/modal-cancel-trip/{booking_id}` | Reason `<select>` | `#reason` |
| Cancel modal | same | Note `<input>` | `#note` |
| Cancel modal | same | Submit (Continue) | `#btn-continue` |
| Booking detail (post-abort) | `/booking/index/{booking_id}` | Red `Cancelled: <reason>` banner | `text=Cancelled:` |

**Notes:**
- Successful login redirects to `**/home/**`; `ResProPage.login()` waits on
  that URL pattern (no DOM selector, since the home page layout is unstable).
- The `Status` column of the air-summary table is **not** a cancellation
  signal — it shows "OPEN" / "CLOSED" (ticket-queue state) regardless of
  whether the booking is aborted. Use the red `Cancelled: …` banner that
  appears next to the action buttons instead.
- Submitting the cancel modal queues an async `Work Order Process [Abort
  Booking]`. The banner only renders after that work order is picked up
  by the ResPro worker — empirically 10–30 s on staging, occasionally
  longer. `ResProPage.cancel()` polls `text=Cancelled:` for up to 90 s
  with a reload between polls; do not shorten that without re-measuring.
- The `Override to Cancel` link is removed from the DOM once the banner
  appears, so an "already cancelled" booking is detected by
  `text=Cancelled:` count > 0 in `is_cancelled()`. This is what makes
  `qa-cleanup` idempotent (`was_already_cancelled=true`).
- `qa-diag --page respro --url <booking-detail-url>` against an unauthed
  context will redirect to `/login` and only confirm the four login-form
  selectors. Selector rot in the booking-detail / cancel-modal portion is
  caught instead by an actual `qa-cleanup` run; the runner's `error`
  body names the failing selector (`respro.override_cancel_link`,
  `respro.abort_reason_select`, etc.).
