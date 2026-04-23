# QA Automation — Page Inventory

All selectors verified against **staging2.flighthub.com** on **2026-04-20**.
Casper-era selectors have been replaced.

---

## Critical: Third-Party Ad Blocking

`conftest.py` injects a route handler on every `BrowserContext` that blocks:
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

⚠️ Not yet confirmed — requires Phase 3 spike with SUMMIT_USER/SUMMIT_PASS credentials.
URL: `https://staging2-summit.flighthub.com/flight-search/info/`

---

## 7. ResPro Booking Detail / Cancel

⚠️ Not yet confirmed — requires Phase 1 spike with RESPRO_USER/RESPRO_PASS credentials.
URL: `https://staging2-reservations.voyagesalacarte.ca/internal/booking/index/{booking_id}`
