# QA Automation — Tool Reference

Every tool prints one JSON object to stdout. Success exits 0; failure exits
non-zero with `{"error": ..., "detail": ..., ...}`. Logs go to stderr only.

Scenario artefacts (screenshots, `trace.zip`) land in
`qa_automation/reports/<UTC-timestamp>-<label>/`. Tools that accept
`--scenario-dir` co-locate into that dir so one booking attempt keeps all
screenshots together.

---

## `qa-search`

Drive the homepage search form, land on `/flight/search`, enumerate packages.
No booking is initiated.

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--site` | `flighthub` | One of `flighthub`, `justfly`. |
| `--trip-type` | `oneway` | `oneway` or `roundtrip`. |
| `--origin` | **required** | IATA, e.g. `YUL`. |
| `--dest` | **required** | IATA, e.g. `LAX`. |
| `--origin-hint` | origin IATA | Autocomplete display hint, e.g. `"YUL - Montreal"`. Needed when IATA alone yields >1 autocomplete match. |
| `--depart` | **required** | `YYYY-MM-DD`. |
| `--return` | — | `YYYY-MM-DD`, required for roundtrip. |
| `--adt` / `--chd` / `--inf` | `1 0 0` | Passenger counts. |
| `--pos` / `--currency` | — | Informational only (staging2 overrides to USD). |
| `--label` | `search-{origin}-{dest}` | Suffix on the scenario dir. |
| `--max-packages` | `20` | Cap on DOM package enumeration. |

### Success output

```json
{
  "scenario_dir": "qa_automation/reports/20260423-120000-amadeus-smoke",
  "site": "flighthub",
  "base_url": "https://staging2.flighthub.com",
  "search_url": "https://staging2.flighthub.com/flight/search?...",
  "search_pos": "CA",
  "search_currency_hint": "CAD",
  "trip_type": "oneway",
  "origin": "YUL", "dest": "LAX", "depart": "2026-07-15", "return": null,
  "pax": {"adt": 1, "chd": 0, "inf": 0},
  "transaction_id": "abc123...",
  "transaction_id_source_url": "https://staging2-api.flighthub.com/storefront-api/...",
  "transaction_id_candidate_urls": ["..."],
  "packages": [
    {"index": 0, "total_display": "USD 315.39", "validating_carrier": "AC", "content_source": "amadeus"},
    {"index": 1, "total_display": "USD 342.12"}
  ],
  "debug_filter_sources": ["Amadeus", "Kiwi", "Navitaire-ndc", "Tripstack"],
  "screenshots": ["001-search-form-loaded.png", "..."]
}
```

### Error bodies

- `selector_not_found` — a named selector failed. Look at the `name`,
  `screenshot`, and `detail`. Run `qa-diag --url <search_url> --page search`
  to see the full probe.
- `unhandled_exception` — a Python exception escaped the runner.

---

## `qa-search-telemetry`

ClickHouse lookup: which content sources responded during a search.
Defaults to
[`search_api_stats.gds_raw`](../../../db-docs/clickhouse/search_api_stats_gds_raw.md)
— one row per (`search_id`, `content_source`, `api_call`). Override via
`QA_CH_SEARCH_TELEMETRY_TABLE` or `--sql` if the schema changes.

> `gds_raw` is a Distributed table with no sorting key, so every query
> includes a `date_added >= now() - INTERVAL <window-hours> HOUR`
> predicate. Keep `--window-hours` as tight as the scenario allows —
> default 24 h is the safe choice for a booking run that just happened.

### Flags

| Flag | Notes |
|---|---|
| `--transaction-id` / `--search-hash` | Either name accepted; both map to `gds_raw.search_id`. |
| `--window-hours` | Hours back in `date_added`. Default 24. Bump if the search is older. |
| `--route` + `--depart` | Only honoured when you pass a custom `--sql`; the default query keys off `search_id` alone. |
| `--sql` | Custom SQL; placeholders `{search_id}` (string), `{route}`, `{depart}`, `{window_hours}`. |

### Success output

```json
{
  "join_key": {"transaction_id": "abc123", "search_hash": "abc123",
               "route": null, "depart": null, "window_hours": 24},
  "table": "search_api_stats.gds_raw",
  "sql": "SELECT content_source, ... FROM search_api_stats.gds_raw WHERE date_added >= now() - INTERVAL 24 HOUR AND search_id = {search_id:String} GROUP BY content_source",
  "sources_called": [
    {"content_source": "amadeus", "status": "ok",
     "attempt_count": 20, "success_count": 20, "error_count": 0,
     "last_error_response": null,
     "packages_returned": 1250, "packages_blocked": 146, "packages_won": 17,
     "avg_response_time_ms": 1800.0,
     "first_seen": "2026-04-23T14:29:38-04:00", "last_seen": "2026-04-23T14:29:41-04:00"},
    {"content_source": "pkfare", "status": "error",
     "attempt_count": 3, "success_count": 0, "error_count": 3,
     "last_error_response": "timeout",
     "packages_returned": 0, "packages_blocked": 0, "packages_won": 0,
     "avg_response_time_ms": 30000.0,
     "first_seen": "2026-04-23T14:29:47-04:00", "last_seen": "2026-04-23T14:30:17-04:00"}
  ],
  "clickhouse_rows": [ ...raw grouped rows... ]
}
```

### Interpretation

- `status = "ok"` means every attempt for that `(search_id, content_source)`
  returned `response = 'success'`. `packages_returned` is the raw supplier
  count; `packages_won` is what actually survived our filters.
- `status = "error"` with `last_error_response = "timeout"` (or a
  source-specific code) means the call did not produce usable inventory —
  cross-check `jupiter.jupiter_booking_errors_v2` if the scenario progressed
  to a book.
- `attempt_count > 1` per source is normal: each supplier API op gets its
  own row, and follow-up calls (`search_type != 'main'`) reuse the same
  `search_id`. For "did the source respond to the initial search?" filter
  or eyeball for `search_type = 'main'` in `clickhouse_rows`.

### Error bodies

- `missing_join_key` — need `--transaction-id` / `--search-hash`, or a
  custom `--sql` that keys on `--route` + `--depart`.

---

## `qa-book`

Re-navigate to the `search_url` from `qa-search`, pick a package, run the
checkout flow to confirmation.

### Flags

| Flag | Default | Notes |
|---|---|---|
| `--search-url` | **required** | From `qa-search` output. |
| `--content-source` | — | Mutually exclusive with `--package-index`. One of the two is required. |
| `--package-index` | — | 0-based; picks any-source package at position N. |
| `--scenario-dir` | new UTC-labelled dir | Pass the dir from `qa-search` to co-locate screenshots. |
| `--label` | `book` | Used only when `--scenario-dir` is omitted. |
| `--cc-number` / `--cc-expiry` / `--cc-cvv` / `--cc-name` | autofill | Override the autofilled card. All four or none. |

### Optimizer disable (implicit with `--content-source`)

When `--content-source` is set, the runner also flips the staging-only
**Debugging Options → Disable Optimizer/Repricer** select to **Yes** on the
checkout page before submit. Without this, the optimizer can reprice/reroute
the candidate to a different provider at book time (e.g. an `atlas` candidate
booked via `Tripstack`) and the test no longer exercises the requested source.
On `--package-index` we leave the optimizer enabled — the index-based flow
intentionally exercises the production path.

### Success output

```json
{
  "scenario_dir": "qa_automation/reports/...",
  "id_hash": "2F3...",
  "booking_id": 297983572,
  "debug_transaction_id": "abc123...",
  "portal_url": "https://staging2.flighthub.com/service/portal/detail/2F3...",
  "content_source_booked": "amadeus",
  "package_index_booked": null,
  "currency_shown_at_checkout": "USD",
  "total_shown_at_checkout": 315.39,
  "bookings_row": { ...full row from ota.bookings... },
  "screenshots": [ ... ]
}
```

### Error bodies

- `source_not_available_in_ui` — Debug Filter has no option matching
  `--content-source`, or 0 packages matched. Retry with a different date,
  route, or source (scenario-dependent).
- `checkout_render_timeout` — React form never mounted within 240 s after
  autofill. Usually staging slowness or a backend 500 for that specific
  package; retry or pick another.
- `booking_failed_in_pipeline` — submit clicked, backend reached the
  booker pipeline, and it returned an error. The failure may be on
  **the supplier's side** (real availability/system error) **or on
  ours** (Payhub rejected the card, our loss-limit guard tripped, our
  internal pricing/availability cache vetoed the package). The body's
  `failure_origin` field tells you which.

  The runner pivots on the `transaction_id` extracted from the
  checkout URL and queries **two stores in parallel**:

  1. **ClickHouse `jupiter.jupiter_booking_errors_v2`** (primary) —
     ops-canonical structured error feed: GDS / route / pax shape /
     `main_group_error` / `front_end_message` / `classification_*`.
  2. **MongoDB `ota.debug_logs`** (enrichment) — exception class +
     stack frame (`exception_at`) + ordered booker context timeline.
     Same data the ResPro `/debug-logs/log-group/<transaction_id>`
     viewer shows.

  The body always includes `failure_origin`, `clickhouse_errors` (a
  list, may be empty if CK is still ingesting) and `booker_diagnosis`
  (may be null if Mongo has nothing yet — at least one of the two has
  data when this error fires):

  ```json
  {
    "error": "booking_failed_in_pipeline",
    "failure_origin": "supplier",
    "detail": "One or more flights not available",
    "classification_category": "FLIGHT_AVAILABILITY_ERRORS",
    "front_end_message": "The fares for one or more flights are no longer available. ...",
    "clickhouse_errors": [
      {
        "timestamp": "2026-04-24T10:10:34-04:00",
        "gds": "tripstack",
        "validating_carrier": "G4",
        "route": "FLL-MEM",
        "number_of_adults": 1, "number_of_children": 1,
        "number_of_infants_on_seat": 0, "number_of_infants_on_lap": 1,
        "booking_step": "Mv_Ota_Air_Booker_Tripstack->validatePackage()",
        "package_id": "c79c1283…",
        "error_message": "One or more flights not available",
        "main_group_error": "Mv_Ota_Air_Booker_Exception_FlightNotAvailable",
        "sub_group_error": "Mv_Ota_Air_Booker_Exception_FlightNotAvailable",
        "front_end_message": "The fares for one or more flights are no longer available. ...",
        "classification_category": "FLIGHT_AVAILABILITY_ERRORS",
        "classification_subcategory": "Flight no longer available"
      }
    ],
    "booker_diagnosis": {
      "transaction_id": "52d028…",
      "booker": "tripstack",
      "exception_class": "Mv_Ota_Air_Booker_Exception_FlightNotAvailable",
      "exception_message": "One or more flights not available",
      "exception_at": "solar/include/Mv/Ota/Air/Booker/Tripstack.php:243",
      "key_contexts": [
        {"context": "tripstack-booker-exception",   "level": "debug",    "date_added": "..."},
        {"context": "booker-segment-not-available", "level": "info",     "date_added": "..."},
        {"context": "handle-booker-exception",      "level": "critical", "date_added": "..."}
      ],
      "raw_exception_doc_id": "69eb79da6a9a80894a0d0f92"
    },
    "transaction_id": "52d028…",
    "checkout_url": "...",
    "retry_hint": "supplier tripstack returned Mv_Ota_Air_Booker_Exception_FlightNotAvailable during Mv_Ota_Air_Booker_Tripstack->validatePackage(). Bookability drift ..."
  }
  ```

  ### `failure_origin` values

  Derived from CK `classification_category` (and pattern-matched on
  the exception class when only Mongo has data):

  | `failure_origin` | Triggered by | Who failed | Retry guidance |
  |---|---|---|---|
  | `supplier` | `FLIGHT_AVAILABILITY_ERRORS`, `CONTENT_SOURCE_ERRORS` | The GDS / consolidator / airline | Bookability drift — re-run `qa-search`, pick another package, or wait 1-5 min and retry. |
  | `payment_processor` | `PAYMENT_ERRORS` (`PaymentDeclined`, `Payhub_*`) | **Our** payment gateway pipeline | Try a different test card via `--cc-number`, or check Payhub status. Not a supplier issue. |
  | `our_pricing_guard` | `FARE_INCREASES`, `PRICING_DISCREPANCY_ERRORS` (`FareIncrease`, `LossLimitFareIncrease`, `PriceChange`, `PricingError`) | **Our** loss-limit / pricing protection | Supplier was happy to sell; price drifted past our threshold. Re-run `qa-search` to refresh pricing or pick another package. |
  | `unknown` | `TECHNICAL_ERRORS`, unmapped class, or no signal | Could be either side | Inspect `clickhouse_errors` / `booker_diagnosis` manually. |

  Roughly **half** of all rows in `jupiter_booking_errors_v2` last
  24h fall into the `our_*` and `payment_processor` buckets — do not
  assume a row in this table means the supplier rejected us.

  Common `main_group_error` / `exception_class` values:
  - `Mv_Ota_Air_Booker_Exception_FlightNotAvailable`
    (`classification_category=FLIGHT_AVAILABILITY_ERRORS`) —
    search-to-book bookability drift; rerun `qa-search` or wait a few
    minutes. (`failure_origin=supplier`)
  - `Mv_Ota_Air_Booker_Exception_PriceChange` /
    `…_LossLimitFareIncrease` — price drifted past *our* loss limit.
    (`failure_origin=our_pricing_guard`)
  - `…_DuplicateBooking` — same booking signature already in flight.
  - `…_Payhub*` / `…_PaymentDeclined` — *our* payment processor
    rejected the card / VCC; supplier never saw the request.
    (`failure_origin=payment_processor`)

  Cross-check the CK row's pax counts (`number_of_adults`,
  `number_of_children`, `number_of_infants_on_seat`,
  `number_of_infants_on_lap`) against your `qa-search` request: a
  mismatch means a different booking attempt collided on the same
  `transaction_id` — re-run from a fresh `qa-search`.
- `confirmation_url_timeout_but_booking_created` — submit succeeded
  server-side (an `ota.bookings` row exists for this `transaction_id`)
  but the browser never navigated to the portal URL. The body includes
  `booking_id`, `id_hash`, `booking_status`, `checkout_status`,
  `process_status`. Use `qa-validate --id-hash …` directly; **run
  `qa-cleanup` to release the booking** — do not retry the submit.
- `confirmation_url_timeout` — submit clicked but neither store has
  evidence yet: no CK `jupiter_booking_errors_v2` row, no Mongo booker
  exception, and no `ota.bookings` row. Body includes
  `clickhouse_errors_count` and `debug_logs_count` so you can decide
  whether to wait. Either the click did not fire (inspect
  `after-submit-3s.png` / `after-submit-18s.png`), payment is still in
  flight (poll `qa-validate --transaction-id …` after a minute), or the
  backend rejected before reaching the booker.
- `selector_not_found` — UI element absent; probably selector rot.
- `unhandled_exception` — catch-all.

---

## `qa-validate`

Evidence dump across MySQL / ClickHouse / MongoDB. No pass/fail.

### Flags

| Flag | Notes |
|---|---|
| `--booking-id` | Preferred. |
| `--id-hash` | Portal URL hash; auto-resolved to `booking_id` via MySQL. |
| `--transaction-id` | Mongo `transaction_id` / MySQL `debug_transaction_id` / CH `search_id`. |
| `--mongo-limit` | Default 10; caps the `debug_logs_top` projection. |
| `--search-telemetry-window-hours` | Default 24. Window used for `search_api_stats.gds_raw.date_added`. Widen only if the booking is older. |

### Success output

```json
{
  "join_keys": {"booking_id": 297983572, "id_hash": "2F3...", "debug_transaction_id": "abc123"},
  "mysql": {
    "bookings": { ... },
    "booking_contestants": [ ... ],
    "booking_passengers": [ ... ],
    "booking_segments": [ ... ],
    "booking_statement_items": [ ... ],
    "booking_tasks": [ ... ],
    "bookability_contestant_attempts_for_search": [ ... ],
    "bookability_customer_attempts_for_search": [ ... ]
  },
  "clickhouse": {
    "jupiter_booking_errors_v2": [ ... ],
    "search_telemetry_rows": [ ...raw rows from search_api_stats.gds_raw... ],
    "search_telemetry_table": "search_api_stats.gds_raw",
    "search_telemetry_window_hours": 24
  },
  "mongodb": {
    "debug_logs_count": 17,
    "debug_logs_top": [
      {"_id": "...", "context": "book", "content_source": "amadeus",
       "Response_has": true, "booking_step": "SUPPLIER_SUCCESS"},
      ...
    ],
    "optimizer_logs_count": 3
  }
}
```

Interpretation rules: [`validation_checklist.md`](validation_checklist.md).

### Error bodies

- `missing_join_key` — none of `--booking-id`, `--id-hash`, `--transaction-id`.
- `booking_not_found` — nothing matched; could be replication lag
  (retry in a few seconds).

---

## `qa-cleanup`

Cancel a test booking via ResPro. Idempotent.

### Flags

| Flag | Notes |
|---|---|
| `--booking-id` | **required** |
| `--scenario-dir` / `--label` | For ResPro screenshots. |
| `--env` | `staging` (default) or `production`. ResPro URL is the same regardless. |

### Success output

```json
{
  "scenario_dir": "qa_automation/reports/...",
  "booking_id": 297983572,
  "cancelled": true,
  "was_already_cancelled": false,
  "screenshots": [ ... ]
}
```

`cancelled=true, was_already_cancelled=true` is the idempotent no-op return.

### Error bodies

- `selector_not_found` — ResPro UI changed; update
  `selectors.py::ResProSelectors` and `page_inventory.md`.
- `unhandled_exception` — login or network failure.

---

## `qa-diag`

Probe every named selector in `pages/selectors.py` against a live URL.
Use when a runner returns `selector_not_found` or when Playwright timeouts
are suspicious.

### Flags

| Flag | Notes |
|---|---|
| `--url` | **required** — page to probe. |
| `--page` | One of `search`, `results`, `checkout`, `confirmation`, `respro`, `summit`. |
| `--label` | Scenario dir suffix. |
| `--timeout-ms` | Page settle wait (default 10 000). |

### Success output

```json
{
  "scenario_dir": "qa_automation/reports/...",
  "page_key": "results",
  "url": "https://staging2.flighthub.com/flight/search?...",
  "selectors_verified_on": "2026-04-23",
  "probes": [
    {"name": "results.select_btn", "selector": "button:has-text(\"Select\")", "count": 12, "found": true},
    {"name": "results.debug_filter_toggle", "selector": ".debug-filters-header-toggle", "count": 0, "found": false}
  ],
  "missing_selectors": ["results.debug_filter_toggle"],
  "screenshots": ["001-diag-page.png"]
}
```

Update `pages/selectors.py` + bump `VERIFIED_ON` + refresh
`page_inventory.md` when missing selectors are confirmed.
