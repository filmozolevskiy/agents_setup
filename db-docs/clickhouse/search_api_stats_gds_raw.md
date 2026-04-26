## search_api_stats.gds_raw

**Database:** `search_api_stats`
**Engine:** Distributed (no `partition_key` / `sorting_key` / `primary_key`)
**Purpose:** Per search, per content source, per API call — the raw record of which content sources we actually hit during a search, how many packages each returned / blocked / won, and how long each call took. Primary source for `/qa_automation`'s `qa-search-telemetry` step and for any "did source X respond to my search?" question.

> **Critical performance note.** `gds_raw` has no sorting or partition key, so every query **must** include a `date_added` window. Without one, ClickHouse does a full scan of the underlying shards (≈3 min in practice). A `date_added >= now() - INTERVAL 1 DAY` predicate on the same search brings the same query to ~6 s.

### Columns

| Column | Type | Notes |
|--------|------|-------|
| `search_id` | String | Storefront search hash; matches MySQL `ota.bookings.debug_transaction_id` and Mongo `ota.debug_logs.transaction_id`. |
| `target_id`, `target_id_source` | Int32, String | Downstream targeting ids (e.g. package target). |
| `date_added` | DateTime | Timestamp of the API call. **Use this for every WHERE / LIMIT window.** |
| `origin`, `destination` | String | OD pair. |
| `origin_city_airport`, `destination_city_airport`, `origin_country`, `destination_country`, `origin_region`, `destination_region`, `origin_province`, `destination_province` | String | Normalised geography. |
| `class` | String | Cabin class. |
| `departure_date`, `return_date` | String (YYYY-MM-DD) | Trip dates. |
| `trip_type` | String | `oneway`, `roundtrip`, etc. |
| `site_id` | Int32 | Brand ID (FH / JF / …). |
| `content_source` | String | Source / GDS slug (`amadeus`, `pkfare`, `navitaire-ndc`, `aircanadandc`, …). |
| `office_id` | String | PCC / office identifier used for the call. |
| `affiliate_id` | Int32 | Affiliate ID. |
| `site_currency` | String | Brand default currency at the time. |
| `currency` | String | Currency of the search. |
| `api_user` | String | API user credential bucket. |
| `bot_score`, `cf_score` | Int32 | Bot / Cloudflare scores. |
| `device_type` | String | Device class. |
| `source` | String | High-level traffic source tag. |
| `search_type` | String | `main` for the initial search; other values indicate upsell / reprice / follow-up calls. |
| `multiticket_part` | String | `master` / `slave` / empty. |
| `num_packages_returned` | Int32 | Raw packages returned by the supplier before our filtering. |
| `num_packages_blocked` | Int32 | Packages dropped by blocker rules. |
| `num_packages_won` | Int32 | Packages that "won" deduping and were eligible for display. |
| `response` | String | Outcome tag — `success`, `error`, or a more specific code for the supplier. Non-empty always. |
| `response_time` | Int32 | Response time for the call (milliseconds; double-check locally if seen values look unreasonable). |
| `cheapest_pricing` | Float32 | Cheapest itinerary price seen on this call. |
| `is_nearby`, `is_instant_search` | Int32 | Search-feature flags. |
| `api_call` | String | Supplier API operation (e.g. `Fare_MasterPricerTravelBoardSearch`). Empty for sources that don't report a specific op. |
| `request_options` | String | Serialised request options blob. |
| `discard_counts` | String | Serialised per-reason discard counts. |
| `cache_status` | Nullable(String) | Cache hit / miss / bypass tag. |
| `validating_carriers_returned` | Nullable(String) | Validating carriers that appeared in the response. |

### Key relationships

- `gds_raw.search_id` ↔ MySQL `ota.bookings.debug_transaction_id` ↔ Mongo `ota.debug_logs.transaction_id`.
- Multiple rows are normal for the same `(search_id, content_source)` — each row is one supplier API call. Aggregate with `GROUP BY content_source` or `(content_source, api_call)` depending on what you're asking.

### Common queries

Per-source summary for a specific search (the default shape used by
`qa-search-telemetry`):

```sql
SELECT
  content_source,
  count() AS attempts,
  countIf(response = 'success') AS ok,
  countIf(response != 'success') AS err,
  anyIf(response, response != 'success') AS last_error_response,
  sum(num_packages_returned) AS packages_returned,
  sum(num_packages_blocked)  AS packages_blocked,
  sum(num_packages_won)      AS packages_won,
  round(avg(response_time), 1) AS avg_rt_ms,
  min(date_added) AS first_seen,
  max(date_added) AS last_seen
FROM search_api_stats.gds_raw
WHERE date_added >= now() - INTERVAL 24 HOUR
  AND search_id = '<search_id>'
GROUP BY content_source
ORDER BY content_source;
```

Raw rows for a single (`search_id`, `content_source`) pair — useful when a
summary shows `err > 0` and you need the per-call detail:

```sql
SELECT date_added, api_call, search_type, response, response_time,
       num_packages_returned, num_packages_blocked, num_packages_won,
       office_id, cache_status
FROM search_api_stats.gds_raw
WHERE date_added >= now() - INTERVAL 24 HOUR
  AND search_id = '<search_id>'
  AND content_source = '<source>'
ORDER BY date_added;
```

Is a given content source reachable right now (sanity check outside a
specific search):

```sql
SELECT content_source, count() AS calls, countIf(response = 'success') AS ok,
       countIf(response != 'success') AS err
FROM search_api_stats.gds_raw
WHERE date_added >= now() - INTERVAL 10 MINUTE
GROUP BY content_source
ORDER BY err DESC, calls DESC;
```

### Interpretation

- `response = 'success'` with `num_packages_returned > 0` ⇒ the source
  answered and had inventory for this search.
- `response = 'success'` with `num_packages_returned = 0` ⇒ source answered
  but had nothing to sell (common for oddly-dated trips or niche routes).
- `response != 'success'` ⇒ genuine error (look at
  `last_error_response`); cross-reference with
  `jupiter.jupiter_booking_errors_v2` if the search progressed to a book.
- `num_packages_blocked` can be non-zero even on success — this is our
  filter rejecting candidate packages (fare rules, blacklists, etc.).
- `search_type != 'main'` marks follow-up calls for the same `search_id`
  (upsell, reprice). When answering "did the source respond to the initial
  search?", filter on `search_type = 'main'`.
