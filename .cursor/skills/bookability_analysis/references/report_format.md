# Bookability report format (canonical)

Every bookability analysis ends with a single markdown report. The body is **header paragraph → tables → recommended next step**, nothing else. The QA skill's [`report_format.md`](../../qa_automation/references/report_format.md) is the parent shape; this card adapts it for bookability — split the failure-cause rows into their own table so verbatim supplier evidence fits beside the count, and inline every proof so the reader never has to follow a documentation reference to reproduce a number.

Voice rules, banned tokens, and the four-part structure live in [`../SKILL.md`](../SKILL.md) § *Report shape: write for content / business, not for the SQL author*. Read those first.

## Tables — there are two of them

### Findings table (always present)

`Finding | Verdict | Explanation | Proof` — one row per business claim about volumes, rates, recovery, repeat-client behaviour, classification, or correlation gaps.

| Column        | What goes in                                                                                                                              |
|---------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `Finding`     | Short business-voice label of the claim. No internal field names, no SQL fragments.                                                        |
| `Verdict`     | `HEALTHY` / `DEGRADED` / `CRITICAL` / `INFO` / `PASS` / `FAIL` / `AMBIGUOUS` / `SKIPPED` (vocabulary below).                              |
| `Explanation` | One QA-voice sentence. Counts and shares together (e.g. "365 / (365 + 59) = 86.1 %"). No internal tokens.                                |
| `Proof`       | A **runnable** inline-backticked SQL query, a `debug_logs` permalink, or a path to a saved dump. **Never** "see § N" or "see other doc".  |

### Top failure causes table (present whenever the report includes ClickHouse signatures — standard report § 3 and the deep workflow's similar-errors output)

`Cause | Verdict | Sessions over the window | Supplier verbatim | ClickHouse SQL | Sample session`

| Column                   | What goes in                                                                                                                                                                                  |
|--------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Cause`                  | Business-voice label of the cause ("Supplier said the seats are gone on the booking step"). No supplier strings here.                                                                          |
| `Verdict`                | Share-of-bucket: `> 50 %` → `CRITICAL`, `15–50 %` → `DEGRADED`, `< 15 %` → `INFO` for context, `SKIPPED` for clusters that need but lack supplier evidence.                                     |
| `Sessions over the window` | One number per cluster across the whole window, with the per-day split when the report covers multiple days ("19 sessions (16 + 3) — ~28 % of bookability failures").                       |
| `Supplier verbatim`      | The actual `Response` / `Error-Data` body returned by the supplier or processor, quoted verbatim from `debug_logs`. Quote, don't paraphrase. Add one sentence of context after the quote when the message alone isn't self-explanatory (e.g. "fires ~0.4 s after the book failure on the same offer"). |
| `ClickHouse SQL`         | The runnable CH grouping query that produces the count in the previous column. Inline backticks.                                                                                              |
| `Sample session`         | A `debug_logs` permalink that lands the reader on the exact log entry whose verbatim text appears in `Supplier verbatim`. Canonical shape — pin this host, do not swap to brand-specific hosts: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>`. ResPro is shared across brands and `voyagesalacarte.ca` is the canonical ResPro host (see [`harvest_permalinks.md`](harvest_permalinks.md#permalink-url-shape)). The `#<_id>` fragment is required; the log-group root alone is **not** a sample session. To get the `_id`, query Mongo with `mongo_query.py find ... --json` for the cluster's anchor session filtered to the supplier-error `context` and copy the `$oid` of the returned document. |

A row in the failure-causes table replaces what would otherwise be three rows in the findings table (count + sample permalink + supplier-evidence row). Don't render both — one table per cluster, in the failure-causes table.

## Verdict vocabulary

Two families coexist in one report. Rate / pattern findings use the rate vocabulary; per-stage and per-invariant findings use the pass / fail vocabulary borrowed from QA.

| Verdict     | When                                                                                                                                       |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `HEALTHY`   | Rate / volume sits within the agreed baseline for the supplier and window. State the baseline in `Explanation` if it isn't obvious.        |
| `DEGRADED`  | Rate / volume off baseline but not page-this-supplier-now (e.g. success rate down 5–15 pts, single cluster owns 15–50 % of the bucket).    |
| `CRITICAL`  | Rate / volume severely off (success rate down > 15 pts, single cluster owns > 50 %, customer recovery collapsed, or a misclassification meaningfully shifts the headline rate). |
| `INFO`      | Volume / context row that isn't a pass / fail by itself ("3,421 attempts", repeat-client count, classification-mismatch note, no documented baseline yet). Also the default for clusters in the failure-causes table that own < 15 % of the bucket. |
| `PASS`      | Per-stage / per-invariant claim met (single-booking workflow rows; uncorrelated-rows row when the count is small enough to ignore).        |
| `FAIL`      | Per-stage / per-invariant claim violated.                                                                                                  |
| `AMBIGUOUS` | Evidence partial or transient (e.g. ClickHouse ingestion lag for the most recent hour, single-booking row missing supplier `Response`).    |
| `SKIPPED`   | The check could not run (e.g. payment-only window so customer-recovery rate is undefined). Always include a row instead of dropping the claim. |

State the baseline you are comparing against once in the header paragraph; every `HEALTHY` / `DEGRADED` / `CRITICAL` row inherits it. When no documented baseline exists, ship the row as `INFO` and call out the missing baseline in the recommended next step.

## Per-finding proof catalogue (inline SQL, not references)

Every row's `Proof` is a runnable copy-paste. The catalogue below is the starting point — agent fills in real `gds`, dates, IDs, host. Use these queries directly; do not link to "see standard report" or any other document.

| Finding                                                  | Inline proof to put in the cell                                                                                                                                                                                                                                                                                                                                                                |
|----------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Total attempts (per day)                                 | `` `SELECT COUNT(*) FROM ota.bookability_contestant_attempts c JOIN ota.bookability_customer_attempts u ON c.customer_attempt_id=u.id LEFT JOIN ota.bookings b ON b.id=c.booking_id WHERE DATE(u.date_created)='<day>' AND c.gds='<source>' AND (b.is_test=0 OR b.is_test IS NULL)` ``                                                                                                          |
| Total failures, broken down by `c.error`                 | `` `SELECT c.error, COUNT(*) FROM ota.bookability_contestant_attempts c JOIN ota.bookability_customer_attempts u ON c.customer_attempt_id=u.id WHERE DATE(u.date_created)='<day>' AND c.gds='<source>' AND c.status=0 GROUP BY c.error` ``                                                                                                                                                     |
| Bookability success rate (per day)                       | `` `SELECT SUM(c.status=1)/(SUM(c.status=1)+SUM(c.status=0 AND IFNULL(c.error,'')<>'payment_error')) FROM ota.bookability_contestant_attempts c JOIN ota.bookability_customer_attempts u ON c.customer_attempt_id=u.id LEFT JOIN ota.bookings b ON b.id=c.booking_id WHERE DATE(u.date_created)='<day>' AND c.gds='<source>' AND (b.is_test=0 OR b.is_test IS NULL)` ``                          |
| Customer recovery rate after supplier failed (per day)   | `` `SELECT COUNT(DISTINCT CASE WHEN c.status=0 AND u.status=1 THEN u.id END)/COUNT(DISTINCT CASE WHEN c.status=0 THEN u.id END) FROM ota.bookability_contestant_attempts c JOIN ota.bookability_customer_attempts u ON c.customer_attempt_id=u.id LEFT JOIN ota.bookings b ON b.id=c.booking_id WHERE DATE(u.date_created)='<day>' AND c.gds='<source>' AND (b.is_test=0 OR b.is_test IS NULL)` `` |
| Repeat-client failures                                   | `` `SELECT u.surfer_id, COUNT(DISTINCT u.id) AS attempts FROM ota.bookability_customer_attempts u JOIN ota.bookability_contestant_attempts c ON c.customer_attempt_id=u.id WHERE DATE(u.date_created)='<day>' AND c.gds='<source>' AND c.status=0 AND u.surfer_id<>'' GROUP BY u.surfer_id HAVING attempts>=2 ORDER BY attempts DESC` ``                                                       |
| ClickHouse cluster count + distinct sessions             | `` `SELECT count(), uniqExact(search_id) FROM jupiter.jupiter_booking_errors_v2 WHERE timestamp>='<start>' AND timestamp<'<end>' AND gds='<source>' AND error_message<predicate>` ``                                                                                                                                                                                                            |
| Supplier-side `debug_logs` permalink for a sample        | `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<_id>` — pull `<_id>` with `` `python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id":"<sample>","context":"<SupplierError context>"}' --sort '{"date_added":1}' --limit 2 --json` `` and copy the `$oid`. Always use the `voyagesalacarte.ca` host — ResPro is shared across brands. |
| Single-booking stage outcome (when no specific entry _id is needed) | `https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>?context=<context>` filters the log-group view to a single stage. For per-stage rows where the verdict hinges on one specific entry, use the entry-level shape above instead. |

When a finding doesn't fit the catalogue, write a short query directly. Never substitute a documentation reference for a query.

## Worked example 1 — Standard bookability report (Downtowntravel, single day)

This is a real-shape specimen. The headline finding is the misclassified virtual-card cluster; everything else is supporting. Each `Sample session` cell links to the exact `debug_logs` entry that proves the row.

```markdown
# Bookability Report — Downtowntravel / 2026-04-28

Bookability success rate is normal at 86.1 %, but **only 16 / 75 customers recovered on a different supplier** when Downtowntravel failed yesterday. Two flight-availability signatures account for ~50 % of bookability failures: the supplier's verbatim "There are no seats left" on the booking step and "The offer is expired" on price-verification — they typically appear back-to-back in the same session. The 18-session "Virtual card merchant fare statement items failed" payment-side cluster is **misclassified** — Mongo shows the card was charged successfully and our internal `loss-limit-fare-increase` guard triggered a refund post-Sale; reclassifying drops yesterday's bookability rate from 86.1 % to 82.6 %.

| Finding | Verdict | Explanation | Proof |
|---------|---------|-------------|-------|
| Total attempts | INFO | 481 customer booking attempts on Downtowntravel on 2026-04-28 | `<inline SQL from the catalogue, with DATE(...)='2026-04-28'>` |
| Total failures | INFO | 116 contestant failures: 59 bookability + 57 payment-side (excluded from rate; one of those clusters is misclassified — see failure-causes table) | `<error-histogram SQL>` |
| Bookability success rate | INFO | 365 / (365 + 59) = 86.1 % excluding payment-side; no documented Downtowntravel baseline yet | `<rate SQL>` |
| Customer recovery rate after Downtowntravel failed | INFO | 16 / 75 = 21.3 %; well below the ~47 % seen on Amadeus, but no documented Downtowntravel-specific baseline | `<recovery SQL>` |
| Repeat-client failures | INFO | 13 of 57 distinct failing clients retried Downtowntravel; top retrier 5 times, second 3 times | `<repeats SQL>` |

## Top failure causes (verbatim supplier evidence)

| Cause | Verdict | Sessions yesterday | Supplier verbatim | ClickHouse SQL | Sample session |
|---|---|---|---|---|---|
| Supplier said the seats are gone on the booking step | DEGRADED | 16 sessions — 27 % of bookability failures | `Downtowntravel::BookFlight::Error` carried `Error-Data: failed: There are no seats left`. A supplier-side **Booking ID was created** (`298468082`) before the failure on the sample session — possible orphan-PNR pattern | `<CH cluster SQL with error_message='failed: There are no seats left'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/0dc940e1105c7f92e4b04a384826b746#69f07d2f89831c79b6025cbc |
| Offer expired during price-verification (often the retry leg of "no seats left") | DEGRADED | 14 sessions — 24 % of bookability failures | `Downtowntravel::VerifyPrice::Error` carried `Error-Data: preliminary: The offer is expired, conduct another search`. Fires ~0.4 s after the book failure on the same session — the booker retried verify on the offer the supplier had just consumed | `<CH cluster SQL with error_message LIKE 'preliminary: The offer is expired%'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/0dc940e1105c7f92e4b04a384826b746#69f07d2f89831c79b6025ccc |
| **Misclassified as payment**: virtual card was charged, then loss-limit reversed it | CRITICAL | 18 sessions — currently coded `payment_error` and excluded from the bookability rate | Mongo trace: full Payhub success path completed (Verify → ThreeDs → IssueCard → **Sale (success)** at 14:48:50.439); then `loss-limit-fare-increase` fires at 14:48:51.005 — the link points at this exact firing — followed by `DeferredRefundPaidStatementItemsAction::run Starting refund` and `CancelVirtualCardPipe`. **No card decline — post-Sale fare increase reversed the transaction.** Reclassifying drops the bookability rate from 86.1 % to 82.6 % | `<CH cluster SQL with error_message='Virtual card merchant fare statement items failed'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/e7b8c1d44902608a13efa8ad6c4a4dd4#69f0c8d388c0563281078882 |

**Recommended next steps**

1. Reclassify "Virtual card merchant fare statement items failed" from payment to bookability (drops yesterday's bookability rate from 86.1 % to 82.6 %). Trello card to platform asking for a CH subcategory like `FARE_INCREASES.post_sale_loss_limit`.
2. Verify the "Credit Card payment declined" cluster is actually card declines — the sample shows the same post-Sale-then-refund shape as the misclassified virtual-card cluster. One Mongo `$in` query over the cluster's `transaction_id`s.
3. Investigate the "no seats left" → "offer expired" pair as one root cause — they co-occur on the same session. The supplier-side `Booking ID` getting created before the "no seats left" return is the real lead; possible orphan-PNR pattern.
4. Establish a Downtowntravel-specific 30-day recovery-rate baseline so yesterday's 21.3 % can be judged.

Raw dumps: `reports/_stdio/standard-downtowntravel-2026-04-29-mysql-errors.log`, `reports/_stdio/standard-downtowntravel-2026-04-29-ch-signatures.log`.
```

Notes on the example:

- **No preamble bullet list.** The header paragraph is one short paragraph stating the headline finding; the tables carry every other detail.
- **No MySQL ↔ ClickHouse classification mismatch row, no Uncorrelated rows row.** Both rows lived on every report and rarely changed what anyone did. They are dropped from the mandatory list.
- **Every `Proof` cell is runnable.** No "see standard report § 1 `recovery` CTE" — the SQL is right there in backticks.
- **Failure causes are in the second table.** Each cluster gets one row carrying the count, the supplier verbatim from `debug_logs`, the CH SQL, and the permalink. The findings table doesn't repeat these.
- **`Sample session` URLs end in `#<_id>`** so the reader lands on the exact `debug_logs` entry that proves the row, not the log-group root. Always use the `voyagesalacarte.ca` host — ResPro is shared across brands.
- **`INFO` over `HEALTHY` when no baseline exists.** The recovery rate is genuinely off appearance (~47 % on Amadeus baseline vs ~21 % here), but without a documented Downtowntravel baseline the verdict stays `INFO` and the missing baseline becomes a recommended next step.

## Worked example 2 — Single-booking flow investigation

```markdown
# Bookability Report — Booking 297983572 (Downtowntravel, YUL→YVR)

Booking failed at the booking step: supplier returned `Similar order already exists` during `BookFlight`. Client had a prior cancelled Downtowntravel booking on the same itinerary 38 minutes earlier — matches the documented rebook-after-cancel pattern. Customer did not recover on a different supplier.

| Finding | Verdict | Explanation | Proof |
|---------|---------|-------------|-------|
| Search returned packages | PASS | 14 packages came back from Downtowntravel for the requested route and date | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<hash>?context=Downtowntravel::Search |
| Supplier accepted the fare on price verification | PASS | Verification step returned the same fare shown at checkout | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<hash>?context=Downtowntravel::VerifyPrice |
| Card was authorised | PASS | Payhub Sale returned an approval; no decline payload | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<hash>?context=payhub_api_response_Momentum%5CPayhub%5CRequest%5CSale |
| Supplier rejected the booking | FAIL | `Downtowntravel::BookFlight::Error` carried `Error-Data: failed: Similar order already exists`; client had cancelled a same-itinerary booking 38 minutes earlier | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<hash>#<_id_of_BookFlight_Error_entry> |
| Customer recovered on a different supplier | FAIL | No other contestant booked on this customer attempt; the customer dropped off | `` `SELECT u.status FROM ota.bookability_customer_attempts u JOIN ota.bookability_contestant_attempts c ON c.customer_attempt_id=u.id WHERE c.search_hash='<hash>'` `` |
| Booking row marked test or live | INFO | Live booking; flagged `is_test = 0`. Booking row exists with status `cancelled` | `` `SELECT id, is_test, status FROM ota.bookings WHERE id = 297983572` `` |

**Recommended next steps**

Pattern matches the documented Downtowntravel `Similar order already exists` case (rebooking after a prior cancel). Add this booking to the existing Trello card; remediation is supplier-side until DTT replies.

Raw dump: `reports/_stdio/single-booking-297983572.json`.
```

Notes on the example:

- **No per-stage outcome bullet list.** The findings table *is* the per-stage list; rows are ordered Search → Availability → Payment → Booking → Customer recovery → Booking metadata.
- **`PASS` rows can use the `?context=<context>`** filter — the reader doesn't need to land on a single specific entry, just the stage's portion of the log group.
- **`FAIL` rows must link to the exact entry** that proves the failure (`#<_id>` shape, on the `voyagesalacarte.ca` host). The verbatim supplier `Error-Data` body goes in the `Explanation` cell; the URL in `Proof` lands the reader on the entry whose `Error-Data` matches.
- SQL only shows up where the row is sourced from MySQL (customer recovery, booking metadata).
- There's no separate failure-causes table because there is one cluster of one — the failure row carries the supplier verbatim itself.

## Worked example 3 — Deep bookability / similar-errors report

```markdown
# Bookability Deep Analysis — Downtowntravel / 2026-04-19 → 2026-04-26

Three supplier-side signatures account for 78 % of Downtowntravel bookability failures over the window. The dominant one is the documented `Similar order already exists` rebook-after-cancel pattern (624 sessions). One classification mismatch surfaced and 12 rows were reclassified from payment to bookability.

| Finding | Verdict | Explanation | Proof |
|---------|---------|-------------|-------|
| Total bookability failures (after excluding payment) | INFO | 1,157 contestant failures on Downtowntravel in the window | `<error-histogram SQL>` |
| ClickHouse signature coverage | INFO | 1,098 / 1,157 bookability failures (95 %) matched a ClickHouse signature | `<CH count + MySQL count SQL>` |
| Mongo deep-dive coverage | INFO | `debug_logs` pulled for the top 3 signatures (902 sessions in batches of 100) | `<mongo $in SQL>` |

## Top failure causes (verbatim supplier evidence)

| Cause | Verdict | Sessions over the window | Supplier verbatim | ClickHouse SQL | Sample session |
|---|---|---|---|---|---|
| Supplier rejected as duplicate booking | CRITICAL | 624 sessions — 54 % of bookability failures; matches the documented rebook-after-cancel pattern | `Downtowntravel::BookFlight::Error` carried `Error-Data: failed: Similar order already exists`. Same-itinerary cancellation within ~1 h on every sampled session | `<CH cluster SQL with error_message LIKE '%Similar order already exists%'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<sample_id>#<_id_of_BookFlight_Error_entry> |
| Fare increased past loss-limit between search and book | DEGRADED | 198 sessions — 17 % of bookability failures | `Downtowntravel::VerifyPrice` returned a higher price than search; our `loss-limit-fare-increase` event fires post-verify on every sampled session | `<CH cluster SQL with classification_category='FARE_INCREASES'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<sample_id>#<_id_of_loss_limit_entry> |
| NDC offer not suitable on price-verification (TK NDC) | INFO | 80 sessions — 7 % of bookability failures; ClickHouse message is the generic `Failed to reprice`, Mongo shows the actual NDC code | `Downtowntravel::VerifyPrice::Error` carried `Error-Data: preliminary: Failed to reprice: NDC-1454 SHOPPING_OFFER_NOT_SUITABLE The selected offer was not suitable. Please submit a new AirShopping request. [{ID=...}]` on every one of the 80 sessions | `<CH cluster SQL with error_message LIKE '%Failed to reprice%'>` | https://reservations.voyagesalacarte.ca/debug-logs/log-group/<sample_id>#<_id_of_VerifyPrice_Error_entry> |

**Recommended next steps**

1. Update the Downtowntravel `Similar order already exists` Trello card with the 624-session count and 5 sample permalinks.
2. Escalate the `NDC-1454 SHOPPING_OFFER_NOT_SUITABLE` cluster to the TK liaison — 80 sessions on a single NDC error code is enough to ticket.

Raw dumps: `reports/_stdio/deep-dtt-2026-04-26-ch.json`, `reports/_stdio/deep-dtt-2026-04-26-mongo.json`.
```

Notes on the example:

- Each failure cause is one row even though the underlying signature varies by offer ID — the cluster is the unit, not the row.
- Sample permalinks come from the Mongo deep dive and end in `#<_id>` so they land on the exact supplier-error entry that proves the cluster — same shape as Example 1, same `voyagesalacarte.ca` host.

## Cell escaping

If the report goes through any markdown-table renderer, follow the same hygiene as the QA card:

- One row per line. Embedded newlines break some renderers — collapse to a space if the verbatim supplier message has a `\n`.
- Pipes inside SQL or `error_message` text should be escaped (`\|`) when laid out by hand. If a tool renders the table, pass raw text and let the tool escape.
- One proof per cell in the findings table. The failure-causes table has fixed columns and is allowed (and expected) to carry SQL + permalink in adjacent cells.

## What this card does **not** cover

- Wording / tone of the `Explanation` cell — that's [`../SKILL.md`](../SKILL.md) § *Voice rules*.
- Trello formatting — when the same findings post on the Content Integration board, the formatter in [`../../trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md) reshapes the tables into `⊙ Summary` + `⊙ Numbers/quantity/Examples`. Build the tables here first; reshape from them.
- Multi-supplier / multi-period comparison reports — those layer on top of this format (one set of tables per supplier or period). Same columns, repeated.
