# `optimizer_logs` query patterns

How to reliably pull the supplier-side fare payload from MongoDB
`ota.optimizer_logs` and reconcile it with MySQL candidates. For core Mongo
safety rules (JSON-only CLI, no `ISODate(...)` in pipelines, which collection
to use when) read [`.cursor/rules/mongodb.md`](../../../rules/mongodb.md)
first.

## Join key

**`optimizer_logs.transaction_id` ↔ `optimizer_attempts.search_id`** —
confirmed 2026-04-21 on DTT reprice traffic. Same convention as
`debug_logs.transaction_id` ↔ MySQL `search_hash`
([`db-docs/mongodb/debug_logs.md`](../../../../db-docs/mongodb/debug_logs.md)).

If a new content source ever uses a different mapping (e.g. `checkout_id`),
update this file and [`db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md)
immediately — do not silently adapt the query.

## Canonical queries

Load env once per session:

```bash
set -a && source .env && set +a
```

### Single transaction (confirm shape, spot-check)

```bash
python3 scripts/mongo_query.py find optimizer_logs ota \
  --filter '{"transaction_id": "YOUR_SEARCH_ID"}' \
  --sort '{"date_added": -1}' \
  --limit 50 \
  --json
```

Use this to:

1. See which `context` strings are relevant for the content source under
   investigation.
2. Pin down the `fares[]` shape (see **Fares extraction** below).
3. Capture `_id` values for permalink construction.

### Batch — many transactions (Workflow B)

```bash
python3 scripts/mongo_query.py find optimizer_logs ota \
  --filter '{"transaction_id": {"$in": ["SEARCH_ID_1", "SEARCH_ID_2", "..."]}, "context": {"$regex": "<integration_or_step>", "$options": "i"}}' \
  --sort '{"date_added": -1}' \
  --limit 500 \
  --json
```

- Batch **25–100** `search_id`s per call to stay readable and well under the
  limit.
- Use **equality** on `context` when the exact string is known (e.g.
  `"context": "Optimizer::Rank"` — confirm the real value in your first-use
  sample). Use `$regex` only when the full string is unknown.
- Project only the fields you need when `fares` is large (see next section).

### Projection for heavy `fares`

If `fares` is large and you only need a subset for reconciliation:

```bash
python3 scripts/mongo_query.py find optimizer_logs ota \
  --filter '{"transaction_id": "YOUR_SEARCH_ID"}' \
  --projection '{"_id": 1, "transaction_id": 1, "context": 1, "date_added": 1, "fares": 1}' \
  --limit 10 \
  --json
```

Adjust `--projection` to narrow to specific `fares` sub-paths once you have
confirmed them. `scripts/mongo_query.py` accepts standard Mongo projection
syntax, so nested paths like `"fares.total": 1` also work.

### Date-bounded aggregations

`scripts/mongo_query.py` does not accept `ISODate(...)` inside a JSON
pipeline string (same limitation as for `debug_logs`). For date-bounded
aggregations — e.g. "count matching signatures in the last 7 days" — use
**mongosh**, **MongoDB Compass**, or a **short `pymongo` script** after
`set -a && source .env && set +a`.

Template `pymongo` snippet (keep it small, run it ad hoc):

```python
import os
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=10_000)
coll = client["ota"]["optimizer_logs"]

now = datetime.now(timezone.utc)
since = now - timedelta(days=7)

pipeline = [
    {"$match": {
        "context": "Optimizer::Rank",                 # replace with confirmed value
        "date_added": {"$gte": since, "$lte": now},
        "fares.gds": "amadeus",                       # example — replace when shape confirmed
    }},
    {"$count": "n"},
]
print(list(coll.aggregate(pipeline)))
```

## Top-level content vs `meta.*` placeholders

Payloads fall into **two shapes** depending on the source + context. Know
which one you're looking at before trying to read JSON:

1. **Top-level content** — the actual JSON body is at the **top level of the
   document** under named fields like `Request`, `Response`, `0`, `1`,
   `exception`, `post`, `get`, `packages`, `fares`. The `meta` subtree may
   still exist, but it is just type metadata, not the body. Confirmed on
   unififi and pkfare reprice traffic 2026-04-22.

   Read them with `json.loads(doc["Response"])` /
   `json.loads(doc["1"])` from `pymongo` — the `scripts/mongo_query.py find`
   CLI returns them unchanged.

   Examples of top-level-content contexts:

   | Context | Top-level payload fields |
   |---|---|
   | `Unififi::Reprice-original-operands` | `0="operands"`, `1=<operand JSON>`, `_scopes=['Reprice[master_N]' | 'Reprice[slave_N]']` |
   | `unififi-api[UNIFIFICAD] search` / `unififi-api[UNIFIFIUSD] search` | `Request`, `Response` (JSON strings), `Operation`, `Response time` |
   | `Reprice reprice_and_drop+UNIFIFICAD+published` (and sibling `new_package` / `multicurrency` / `single_to_multi` wrappers) | `exception` (JSON string or dict with `class`/`message`/`file`/`line`/`backtrace`), `post`, `get` |
   | `Unififi::Reprice-matching-multiple-packages` | `packages` (JSON string or list/dict of per-package predicate results) |
   | `pkfare-no-matching-itineraries` | `itinerary`, `mismatchingItineraries` |
   | `contestant-overwrite-rules` | `before-*`, `after`, `rules` |

2. **`meta.*` placeholders** — leaves are `{"type":"string.json"}` /
   `{"type":"composite"}`, not the body. The body lives out of band and is
   only viewable via the permalink in the storefront debug UI. Presence of
   the context still tells you the step fired; content-level comparison
   requires the permalink.

When in doubt: dump one document's top-level keys first. If the expected
content field (`Response`, `1`, `packages`, …) is a string, try
`json.loads()`; if it's a `{"type": ...}` dict, it is a placeholder and you
need the permalink.

Use the `context` hints table in
[`db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#per-content-source-context-hints)
as the primary source of truth; extend it during post-run learning.

### Multi-ticket operand iteration (mandatory for leak audits)

A single attempt can emit **multiple** `{Source}::Reprice-original-operands`
documents — one per leg of a multi-ticket (SMT) bundle. They are
distinguished by `_scopes`:

- `_scopes = ['Reprice[master_N]']` — outbound / first-ticket leg.
- `_scopes = ['Reprice[slave_N]']` — inbound / second-ticket leg.

Each operand has its own companion `{source}-api[...]` supplier call and
its own `Reprice <type>+{ACCOUNT}+{visibility}` wrapper with its own
exception.

**Do not `find_one(..., sort=[('date_added', -1)])` when classifying.** That
silently picks one leg and misses the other. Iterate chronologically:

```python
ops  = list(coll.find({"transaction_id": sid, "context": f"{SOURCE_PREFIX}::Reprice-original-operands"}).sort("date_added", 1))
apis = list(coll.find({"transaction_id": sid, "context": {"$in": API_CONTEXTS}}).sort("date_added", 1))
wraps= list(coll.find({"transaction_id": sid, "context": {"$regex": WRAP_REGEX}}).sort("date_added", 1))
# Pair ops[i] ↔ apis[i] ↔ wraps[i]
```

See the full leg-by-leg classifier in
[`contestant_forming_audit.md`](contestant_forming_audit.md#step-4--per-leg-classification-buckets).

### Default match key (used when payload content is accessible)

When the permalink body is available (e.g. through the storefront UI, a
follow-up pymongo fetch when the placeholders resolve, or an exported
payload), reconcile a fare to a candidate using:

1. **Primary:** `validating_carrier` + `flight_numbers` + `fare_bases` +
   `booking_classes` + `cabin_codes` (ordered per-segment).
2. **Secondary sanity:** `total` within a small currency-noise tolerance.
3. **Tie-breaker:** prefer the candidate with matching `reprice_index` when
   the payload exposes a reprice identifier.

Normalize both sides before comparing:

- Flight-number sequences are **ordered tuples** (order encodes the
  itinerary).
- Class / cabin / fare-basis arrays align **positionally** to segments.
- Uppercase codes; strip whitespace.

### When the payload body is not accessible

For `meta.*` placeholder-shaped contexts (see
[`optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#meta-payloads-are-placeholders)),
fall back to:

- **Structural evidence**: which contexts fired for a `transaction_id`,
  their `date_added` ordering, `level`, and `source`. This is enough to say
  *where* in the flow the mismatch occurred and to tie it to the MySQL
  candidate's `reprice_type` / exception tag.
- **Permalink citation**: always include a permalink to the supplier-side
  context document (e.g. `Downtowntravel::Reprice-matching-packages`) so a
  human can open the payload in the storefront UI.

For top-level-content contexts (unififi, pkfare, and several generic
wrappers) this fallback is not needed — parse the top-level JSON directly.

## Permalink URL shape

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>
```

- `<transaction_id>` — the same value on the document.
- `<log_id>` — `_id` as a 24-char hex string (use `$toString` in
  aggregations).

Same host family as `debug_logs` — the storefront exposes optimizer logs
under the same `/debug-logs/log-group/` path (confirmed 2026-04-21).

**Aggregation to harvest permalinks** — use the same Variants A/B/C shape
from [`../../bookability_analysis/references/harvest_permalinks.md`](../../bookability_analysis/references/harvest_permalinks.md),
swapping `debug_logs` for `optimizer_logs` and replacing the `Response`
regex with an equality `$match` on the relevant `context` (since the
supplier body is a placeholder here).

## Scope hygiene

- **One transaction, multiple optimizer passes.** A single `search_id` can
  produce several optimizer_logs documents (e.g. original vs reprice). When
  the report ties a verdict to a specific candidate, cite the **optimizer_log
  that corresponds to its `reprice_type` / `reprice_index`** — do not merge
  evidence across passes.
- **One transaction, multiple content sources.** If the user scoped by `gds`,
  keep only log lines whose `fares[].gds` (or `source` / `context`
  equivalent) matches. Do not let another supplier's fares pollute the
  reconciliation.
- **Capped collection caveat.** Old events may have rotated out; say so if
  the date-bounded scan returns thin data relative to the expected volume.
