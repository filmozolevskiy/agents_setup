# optimizer_logs

**Database:** `ota`
**Purpose:** Logs specifically related to the booking Optimizer, tracking
fare selection, optimization logic, and transaction details. Emits one
document per step of an Optimizer run (reprice attempt, matching pass,
cheapest-package selection, exception wrapper, etc.).


| Field            | Type       | Description                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id`            | `ObjectId` | Unique identifier for the log entry. Use its 24-char hex string in permalinks.                                                                                                                                                                                                                                                                                                           |
| `meta`           | `Object`   | Per-step metadata. **For some contexts the leaves are type placeholders** (`{"type": "string.json"}`, `{"type": "composite"}`) — the real JSON body lives in a top-level field on the same document (see *Top-level payload fields* below) or out of band (see *Meta payloads are placeholders*).                                                                                        |
| `_scopes`        | `Array`    | Execution scopes for the step. For multi-ticket (SMT) reprice traffic this carries `**Reprice[master_N]`** (outbound leg) or `**Reprice[slave_N]**` (inbound leg) — the only reliable way to attribute an operand / API-call / wrapper document to its leg within a multi-ticket attempt. Always iterate every operand log per `transaction_id` rather than picking one by `date_added`. |
| `context`        | `String`   | Description of the optimization step or content source. Examples below.                                                                                                                                                                                                                                                                                                                  |
| `level`          | `String`   | Log level (`notice`, `debug`, `info`, `error`).                                                                                                                                                                                                                                                                                                                                          |
| `source`         | `String`   | HTTP endpoint / service URL that emitted the log (e.g. `POST http://api.justfly.com/optimizer/reprice/`).                                                                                                                                                                                                                                                                                |
| `transaction_id` | `String`   | Join key. **Equals `optimizer_attempts.search_id`** (verified 2026-04-21 for DTT, 2026-04-22 for unififi).                                                                                                                                                                                                                                                                               |
| `ip`             | `String`   | Client IP.                                                                                                                                                                                                                                                                                                                                                                               |
| `server_ip`      | `String`   | Server IP.                                                                                                                                                                                                                                                                                                                                                                               |
| `date_added`     | `ISODate`  | Timestamp when the log was created. Bound with `$gte` / `$lte` on every aggregation.                                                                                                                                                                                                                                                                                                     |
| `user_agent`     | `String`   | Client user agent.                                                                                                                                                                                                                                                                                                                                                                       |
| `pid`            | `Int`      | Process ID.                                                                                                                                                                                                                                                                                                                                                                              |


**Top-level payload fields** — many contexts carry their real content at
the top level of the document under named keys rather than inside `meta.*`
placeholders. Common names: `Request`, `Response`, `0`, `1`, `exception`,
`post`, `get`, `packages`, `itinerary`, `mismatchingItineraries`. See the
per-context table below and
`[.cursor/skills/optimizer_analysis/references/optimizer_logs_patterns.md` — *Top-level content vs meta placeholders](../../.cursor/skills/optimizer_analysis/references/optimizer_logs_patterns.md#top-level-content-vs-meta-placeholders)*
for how to decide which shape a context uses and how to parse it.

> A `fares` top-level field was listed in very early drafts of this doc
> and has **not** been observed in real DTT / PKFARE / unififi / Amadeus
> reprice traffic. Treat references to a flat `fares[]` array as
> historical noise.

## Join key

- `**transaction_id` = `optimizer_attempts.search_id`** — confirmed on DTT
reprice traffic 2026-04-21. Same value convention as
`debug_logs.transaction_id` ↔ MySQL `search_hash`.

## Meta payloads are placeholders (for some contexts)

Many contexts' `meta.*` leaves are **type placeholders**:

```json
{ "meta": { "Request":  { "type": "string.json" },
            "Response": { "type": "string.json" },
            "get":      { "type": "composite" },
            "exception":{ "type": "composite" } } }
```

When you see that shape, the full body is stored out of band and is only
viewable via the storefront debug UI. Consequences for tooling:

- `scripts/mongo_query.py find --projection '{"meta.Response":1}'` will
return the placeholder, not the JSON body — useful to confirm the
context / step exists, **not** to compare supplier values.
- Content-level comparison (e.g. fare-basis / booking-class reconciliation)
requires opening the permalink, or — when offered by the platform — an
alternative payload-retrieval path.
- Error / prevalence aggregations should rely on stable fields (`context`,
`level`, `date_added`, `transaction_id`, `source`) and treat `meta.`*
as a **signal that a step fired**, not a content source.

**For contexts that carry content at the top level** (`unififi-api[...] search`,
`{Source}::Reprice-original-operands`, `Reprice <type>+{ACCOUNT}+{visibility}`,
`{Source}::Reprice-matching-multiple-packages`, `pkfare-no-matching-itineraries`,
`contestant-overwrite-rules`, …) the placeholder rule does **not** apply —
read the top-level field directly with `json.loads(doc[field])`. See the
per-context table below for field names.

## Permalink URL shape

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>
```

- `<transaction_id>` — the same `transaction_id` on the document
(= MySQL `optimizer_attempts.search_id`).
- `<log_id>` — the document's `_id` as a 24-char hex string
(`$toString` in aggregations).

Same host family as `debug_logs` permalinks — the storefront exposes
optimizer logs under the same `/debug-logs/log-group/` path.

## Per-content-source `context` hints

Use **equality** on `context` when the exact string is known; never
`$regex` on `context` when the full value is available.


| Content source       | Context                                                                                                                                  | What the step represents                                                                                                                                                                                                            | Payload shape                                                                                                                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downtowntravel (DTT) | `Downtowntravel::Reprice-matching-packages`                                                                                              | DTT's reprice result set (supplier-side evidence for matching).                                                                                                                                                                     | `meta.results` placeholder — use the permalink.                                                                                                                                                           |
| Downtowntravel (DTT) | `Downtowntravel::Cheapest-package`                                                                                                       | The cheapest option selected from the reprice response.                                                                                                                                                                             | `meta.prices` + `meta.package` (placeholders).                                                                                                                                                            |
| Downtowntravel (DTT) | `Reprice new_package+DOWNTOWNTRAVELUSD+published` (and `multicurrency+PKFARECAD+published`, `single_to_multi+ONEFLYUSD+published`, etc.) | Wrapper emitting `get` / `post` / `exception` for the whole reprice pass. Pattern: `Reprice <reprice_type>+<ACCOUNT_CURRENCY>+<visibility>`.                                                                                        | Top-level `exception`, `post`, `get` (often JSON strings; sometimes placeholders — check per source).                                                                                                     |
| PKFare               | `pkfare-no-matching-itineraries`                                                                                                         | PKFare returned something but the Optimizer could not reconcile it to the anchor itinerary. Fires 1:1 with `pkfare Reprice failure` (confirmed 2026-04-21, ~275 transactions / 2h).                                                 | Top-level `itinerary` + `mismatchingItineraries`.                                                                                                                                                         |
| PKFare               | `pkfare Reprice failure`                                                                                                                 | Wrapper emitted alongside `pkfare-no-matching-itineraries` when the reprice yields nothing usable.                                                                                                                                  | Top-level `exception`.                                                                                                                                                                                    |
| PKFare               | `Reprice <reprice_type>+PKFARE{CAD,USD}+published`                                                                                       | Reprice wrapper for PKFare pricing accounts. `reprice_type` ∈ {`new_package`, `multicurrency`, `single_to_multi`} (plus `original` on `+private` visibility). Confirmed on pkfare reprice traffic 2026-04-21.                       | Top-level `exception`, `post`, `get`.                                                                                                                                                                     |
| Unififi              | `Unififi::Reprice-original-operands`                                                                                                     | The operand(s) we asked unififi to reprice. **One document per leg** of a multi-ticket (SMT) bundle; `_scopes` distinguishes `Reprice[master_N]` vs `Reprice[slave_N]`. Confirmed 2026-04-22 on unififi matching-correctness audit. | Top-level `0="operands"`, `1=<operand JSON>` (parse with `json.loads`).                                                                                                                                   |
| Unififi              | `unififi-api[UNIFIFICAD] search` / `unififi-api[UNIFIFIUSD] search`                                                                      | Raw supplier API call + response for one leg. One document per call (one per operand).                                                                                                                                              | Top-level `Request`, `Response` (JSON strings), `Operation`, `Response time`. Parse `Response` with `json.loads`; iterate `routings[].itineraries[].segments[]` to compare against the operand's flights. |
| Unififi              | `Reprice <reprice_type>+UNIFIFI{CAD,USD}+<visibility>`                                                                                   | Reprice wrapper for unififi pricing accounts. `reprice_type` ∈ {`reprice_and_drop`, `new_package`, `multicurrency`, `single_to_multi`, `original`}.                                                                                 | Top-level `exception` (JSON string or dict with `class` / `message` / `file` / `line` / `backtrace`), `post`, `get`.                                                                                      |
| Unififi              | `Unififi::Reprice-matching-multiple-packages`                                                                                            | Fires **only when the matcher ran**. Its absence on an `Incalculable` / `Unsalable` (non-drop) attempt is a strong signal that our pre-matcher gate dropped the candidate (e.g. empty `fareBasisCode`).                             | Top-level `packages` (JSON string; may deserialize to list or dict keyed by package index).                                                                                                               |
| Generic              | `contestant-overwrite-rules`                                                                                                             | Post-match contestant rule evaluation. Fires densely (dozens per attempt) during the reprice pass; presence is normal. Confirmed 2026-04-21 during pkfare audit.                                                                    | Top-level `before-`*, `after`, `rules` (mix of strings + composites).                                                                                                                                     |
| Generic              | `Shopping`                                                                                                                               | `POST …/reprice/` request + response pair.                                                                                                                                                                                          | `meta.Request` / `meta.Response` / `meta.Response time` (placeholders).                                                                                                                                   |
| Generic              | `fare-display-fare-calculation-parser`                                                                                                   | Internal fare-calc parsing step.                                                                                                                                                                                                    | `meta.fares` (composite placeholder).                                                                                                                                                                     |


Add rows to this table as new stable contexts are confirmed during an
investigation. Remove or correct a row when the context shape changes or
disappears.

## Multi-ticket (SMT) — iterate all operand logs per attempt

A single reprice attempt on a multi-ticket itinerary emits **multiple**
`{Source}::Reprice-original-operands` documents (one per leg), each with
its own companion `{source}-api[...]` search and its own
`Reprice <type>+{ACCOUNT}+<visibility>` wrapper. Distinguish legs with
`_scopes`:

- `['Reprice[master_N]']` — outbound / first-ticket leg.
- `['Reprice[slave_N]']` — inbound / second-ticket leg.

**Do not** use `find_one(..., sort=[('date_added', -1)])` to pick "the"
operand for an attempt — it silently surfaces one leg and mis-attributes
the failure cause. For matching-correctness audits, always iterate every
operand chronologically and pair index-wise with the supplier calls and
wrappers. See
`[.cursor/skills/optimizer_analysis/references/contestant_forming_audit.md` — *Per-leg classification buckets](../../.cursor/skills/optimizer_analysis/references/contestant_forming_audit.md#step-4--per-leg-classification-buckets)*.

## Common queries

```javascript
// Find optimizer logs for a specific transaction
db.optimizer_logs.find({ "transaction_id": "TRANS-123" }).sort({ "date_added": -1 })

// Narrow to DTT reprice evidence for one transaction
db.optimizer_logs.find({
  "transaction_id": "TRANS-123",
  "context": { "$in": [
    "Downtowntravel::Reprice-matching-packages",
    "Downtowntravel::Cheapest-package"
  ]}
})
```

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find optimizer_logs ota \
  --filter '{"transaction_id": "TRANS-123", "context": "Downtowntravel::Reprice-matching-packages"}' \
  --sort '{"date_added": -1}' --limit 50 --json
```

## Indexes

- `_id_`: `_id: 1`
- Likely also has `transaction_id` / `date_added` indexes (inferred from
`debug_logs`; confirm with `db.optimizer_logs.getIndexes()` when needed).

## Notes

- Like `debug_logs`, likely a **capped collection** — old reprice docs may
already have rotated out.
- Used by the `[optimizer-analysis](../../.cursor/skills/optimizer_analysis/SKILL.md)`
skill for per-attempt drill-downs and matching-error audits.
- Use `optimizer_logs` only for repricing / Optimizer-specific questions.
Full flight-booking debug traffic lives in `debug_logs`. See
`[.cursor/rules/mongodb.md](../../.cursor/rules/mongodb.md)`.

