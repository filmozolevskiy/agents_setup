# Effective queries and evidence rules for `debug_logs`

Shared reference for both the single-booking flow investigation and the deep bookability analysis.
For raw query mechanics (collection choice, `transaction_id` / `context` filtering, JSON-only CLI
limitation), see [`.cursor/rules/mongodb.md`](../../../rules/mongodb.md). For permalink harvest
pipelines, see [`harvest_permalinks.md`](harvest_permalinks.md).

**Before reaching for Mongo:** check
[`db-docs/clickhouse/jupiter_booking_errors_v2.md`](../../../../db-docs/clickhouse/jupiter_booking_errors_v2.md).
CH already carries the supplier `error_message`, `booking_step`, and a classification for the
booking-failure path. Query Mongo when you need the raw request / response body, chronological
flow for one `transaction_id`, or a field CH does not capture (full NDC payload, 3DS / Payhub
detail, search / availability / ticketing stages other than the failure itself).

## Effective queries on debug_logs

Use patterns that stay **index-friendly** and match **where the text actually lives**:

1. **Time first:** always bound **`date_added`** (`$gte` / `$lte` or `$lt`) for prevalence and ad
   hoc pulls on large collections.
2. **Exact `context` when known:** use **equality** (e.g. `"context": "Downtowntravel::BookFlight"`).
   **Do not use `$regex` on `context`** if you have the full string — regex on `context` is slower
   and can mask typos.
3. **Supplier text field:** for DTT book flows, the supplier-visible body is often in top-level
   **`Response`**. Prefer **`$match` on `Response` + `$regex`** (or substring match) together with
   exact `context` over **`$expr` / `$concat` / stringified `meta`** for first-pass counts — the
   latter is slower, can **error** if any stitched field is non-string, and misses text that only
   appears in `Response`.
4. **Regex hygiene:** when the phrase includes literal periods (e.g. `unique. Please`), **escape**
   `.` in the pattern (`unique\.`) unless you intentionally want "any character".
5. **Counts:** reuse the same filter as a single `$match` (or `countDocuments`) and add `{
   "$count": "n" }` in aggregation.
6. **Tools:** `scripts/mongo_query.py` takes **JSON only** — no `ISODate(...)` in the pipeline
   string. For date-bounded aggregations, use **mongosh**, **MongoDB Compass**, or a **small
   Python** script with `pymongo` + `datetime` after `source .env` (same env vars as the CLI).

## Source of truth: supplier traffic vs local exceptions

Documents are not equal. **Prioritize entries that store raw request/response (or equivalent wire
payload) with the external content source** — that is what the GDS or supplier actually saw and
returned.

- **Prefer for final conclusions:** logs that contain **outbound requests and inbound responses**
  (or parsed mirror fields) for the path under investigation. Base **root-cause statements** and
  **customer-facing explanations** on that supplier-visible evidence.
- **Use exceptions and errors as a map, not the verdict:** local application logs (exceptions,
  stack traces, generic wrappers, internal `"reason": "failed"` handlers) are excellent for
  **spotting failures**, **building patterns**, **chronological correlation**, and **clustering**
  — but they are **not** the source of truth about supplier behavior if a nearby document holds
  the real response body.
- **Reading order:** once you pick a `transaction_id` and content source, follow the timeline;
  when both exist, **read the supplier request/response document first**, then the local exception
  that may wrap or summarize it.

**Examples (same `search_hash`, different `_id`):**

| Role | Permalink |
|------|-----------|
| **External content source** (raw traffic — prefer for conclusions) | [log `…#69d55ccec06bf5c3bd021877`](https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877) |
| **Local exception** (patterns / context — supporting) | [log `…#69d55ccec06bf5c3bd021878`](https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021878) |

## How to read `debug_logs` for bookability

- **One transaction, many content sources:** `debug_logs` interleaves activity for **multiple**
  content sources / contestants under the same `transaction_id`. Match the **content source under
  investigation** (the same GDS or integration you filtered on in MySQL, e.g. `bconta.gds`). Use
  `source`, `context`, `meta`, and message or stack-trace text to **keep only lines that belong to
  that path**; **ignore** log lines from other suppliers or contestants so conclusions are not
  polluted by unrelated failures.
- **Many `search_hash` values:** Treat each deep dive as building a **hypothesis** (e.g. generic
  "flight not available" is actually `Downtowntravel::BookFlight` throwing X). After you identify
  that signature on one transaction, **spot-check additional `search_hash`s** from the same
  failure bucket to see whether the **same pattern** repeats. Prefer confirming with a small,
  representative sample rather than assuming one log explains every row.

## Frequency / prevalence (after a clear root cause)

When a log exposes a **specific, repeatable failure** (structured payload, stable message,
distinct class or supplier code), **do not treat a single permalink as sufficient**. Estimate how
often that signature appears in production.

1. **Anchor the signature** from the document you already inspected (field paths may be under
   `meta`, top-level, or nested — copy the exact shape you matched on disk). Prefer fields visible
   in **supplier request/response** payloads for prevalence; use **exception-only** text when raw
   traffic is missing from the window or collection.
2. **Query `debug_logs` over longer windows**, typically **the past 7 days** and **the past 30
   days** (adjust if the question is seasonal or incident-scoped). Combine:
   - a **time bound** on `date_added` (`$gte` / `$lte`) so the scan stays purposeful and
     index-friendly;
   - the **same error match** on the **field that holds supplier text** when applicable (e.g.
     **`Response`** for DTT `BookFlight`), otherwise `message`, `stack_trace`, or nested paths;
   - **exact `context`** (and other equality filters) where possible — do not regex `context` when
     the full value is known;
   - the **same content source** when fields like `source` or related `meta` allow — do not lump
     other GDS paths into the count.
3. **Report counts** (exact `$count` / grouped counts by day or by source if useful) and a **small
   set of extra permalinks** if you need to prove the pattern is widespread — not only the first
   hit.
4. **`debug_logs` is a capped collection.** Very old events may already have been rotated out; say
   so if the window returns thin data despite a large expected volume.

**Illustrative example:** one log might show a payload equivalent to:

```json
{
  "message": "Similar order already exists",
  "reason": "failed"
}
```

Map those fields to the real document paths in Mongo, then search for sibling documents with the
same values over 7d / 30d. The concrete row that surfaced it might be:

<https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877>

**Querying:** prefer an **aggregation** with `$match` on **`date_added`** + **exact `context`**
(when known) + **signature field** (e.g. `Response` regex) — then `$count` or `$group`. `scripts/
mongo_query.py` takes JSON without BSON dates; use **mongosh**, **Compass**, or **Python +
pymongo** for `ISODate`-bounded pipelines. Canonical templates:
[`harvest_permalinks.md`](harvest_permalinks.md).

## Reporting MongoDB findings

For **each** claim you make from MongoDB, **include a permalink** so others can open the exact
document. URL shape and the `search_hash` / `object_id` components live in
[`harvest_permalinks.md`](harvest_permalinks.md#permalink-url-shape).

**Lead with supplier evidence:** when you assert what the content source did (rejection reason,
error code, policy), **link first** to the **request / response** (or raw traffic) document. Link
**local exception** documents **additionally** when they clarify where in our stack the failure
surfaced.

For Trello `⊙ Numbers/ Examples` formatting (title lines, `some examples`, `mongo_query:`,
multi-signature blocks), the single source of truth is
[`trello_assistant/SKILL.md`](../../trello_assistant/SKILL.md). Do not restate
those conventions here.

**Example permalink pair** (same `search_hash`, two `_id`s — supplier-side + local exception):

- `https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021877`
  — **supplier-side** log (preferred anchor for conclusions)
- `https://reservations.voyagesalacarte.ca/debug-logs/log-group/95769b38d7b00fc0522d49494fbe94cc#69d55ccec06bf5c3bd021878`
  — **local exception** log (supporting; patterns and stack context)
