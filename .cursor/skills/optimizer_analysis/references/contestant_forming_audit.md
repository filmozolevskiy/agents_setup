# Contestant-forming leak audit (primary workflow)

**Use when the user asks for a matching-correctness audit on a specific
content source + time window.** Produces a per-carrier / per-bucket
breakdown of attempts where the Optimizer failed to form a contestant, and
separates the failures we can fix (our-side) from the ones we cannot
(supplier-side).

Unlike the broad anomaly scan, this workflow reads the actual supplier
response for each failed attempt, per operand leg, and classifies who was
responsible.

## Checklist

```
- [ ] 1. Confirm scope (gds, window, candidacy buckets, include/exclude
        reprice_and_drop)
- [ ] 2. Pull failed-attempt search_ids from MySQL (bound on created_at)
- [ ] 3. For each attempt, pull ALL operand logs and ALL supplier API logs
- [ ] 4. Per leg: classify into {supplier_0_routings, supplier_gap,
        supplier_returned_with_fb, pure_our_side_leak_fb_empty}
- [ ] 5. Aggregate to attempt-level verdict (an attempt is our-side only if
        EVERY leg is our-side)
- [ ] 6. Group by (leg-bucket, operating_carrier) and count; pick example
        permalinks for each bucket
- [ ] 7. Emit the audit report with rescue-able count and ticket wording
- [ ] 8. Post-run learning: extend db-docs and context hints as needed
- [ ] 9. Offer Trello follow-ups (hand off to trello_content_integration)
```

## Scope defaults

| Scope knob | Default | Override phrase |
|---|---|---|
| Window | last 24h | user-supplied |
| Candidacy filter | `candidacy IN ('Incalculable','Unsalable')` | — |
| `reprice_type` filter | exclude `reprice_and_drop` | "include reprice-and-drop" |
| Policy exceptions | exclude `Blocked by Supplier Rules%` | "include supplier rules" |
| Attempt cap for Mongo deep-dive | 200 (representative sample) | user-supplied |
| Only `Incalculable`? | no — include `Unsalable` **non-`reprice_and_drop`** too | — |

Record the final scope choice in the report header.

## Why leg-by-leg — the multi-ticket gotcha

A single attempt may have **multiple operand logs**, one per leg of a
multi-ticket (SMT) bundle. `scripts/mongo_query.py find --sort` with a
single-document limit will only surface one of them and will silently
mis-attribute the failure cause. Always iterate over every
`{Source}::Reprice-original-operands` document whose `transaction_id`
matches the attempt, reading `_scopes` to identify the leg:

- `_scopes = ['Reprice[master_N]']` → outbound / first ticket.
- `_scopes = ['Reprice[slave_N]']` → inbound / second ticket.

Each operand has its own companion `{source}-api[...] search` log (supplier
call for that leg) and its own `Reprice <type>+<ACCOUNT>+<visibility>`
wrapper with its own exception. Pair them **by chronological index within
the attempt**; do not assume there is a single supplier call per attempt.

## Step 1 — Scope

Ask the user (or state in the report header):

- **`gds`** — required. One of `unififi`, `pkfare`, `downtowntravel`,
  `amadeus`, … The query patterns below assume the `{source}` token maps to
  the context prefix documented in
  [`../../../db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#per-content-source-context-hints).
  For new sources, populate that table first (short pass with
  [`./single_attempt_investigation.md`](single_attempt_investigation.md) on
  one failing attempt to confirm the context strings).
- **Window** — default **last 24h**.
- **Include `reprice_and_drop`?** — default **no**. Those candidates are
  intentional shadow repricings; see
  [`../SKILL.md` → "reprice_and_drop is intentional"](../SKILL.md#reprice_and_drop-is-intentional--exclude-from-leak-audits).
- **Cap** — default 200 attempts for the Mongo deep-dive; sample
  representatively if the failed-attempt set is larger.

## Step 2 — Pull failed-attempt `search_id`s from MySQL

Starting query (adjust `{gds}` and window):

```sql
SELECT oa.search_id,
       oc.validating_carrier,
       oc.candidacy,
       oc.reprice_type
FROM ota.optimizer_candidates oc
JOIN ota.optimizer_attempts oa ON oa.id = oc.attempt_id
WHERE oc.gds = '{gds}'
  AND oc.created_at >= NOW() - INTERVAL {window_hours} HOUR
  AND oc.candidacy IN ('Incalculable','Unsalable')
  AND oc.reprice_type <> 'reprice_and_drop'     -- unless scope says otherwise
ORDER BY oc.attempt_id DESC
LIMIT {cap};
```

Run via `scripts/mysql_query.py query`. Capture `(search_id,
validating_carrier)` tuples as input to Step 3.

Also run the candidacy-distribution sanity query so the report has the
overall shape:

```sql
SELECT oc.candidacy, oc.reprice_type, COUNT(*) AS c
FROM ota.optimizer_candidates oc
WHERE oc.gds = '{gds}'
  AND oc.created_at >= NOW() - INTERVAL {window_hours} HOUR
GROUP BY oc.candidacy, oc.reprice_type
ORDER BY c DESC;
```

## Step 3 — Pull operand + supplier-call + wrapper logs per attempt

For each `search_id`, pull three context families in a single pass:

| Context | What it is | Notes |
|---|---|---|
| `{Source}::Reprice-original-operands` | The operand(s) we asked the supplier to reprice. One document **per leg** of a multi-ticket bundle. | Body JSON is under the top-level field **`1`** (with `0 = "operands"`). `_scopes` identifies `master_N` / `slave_N`. |
| `{source}-api[{ACCOUNT}] search` | The raw supplier API call + response for one leg. | `Request` / `Response` are **top-level JSON strings**, not `meta.*` placeholders, for unififi / pkfare. Parse with `json.loads`. |
| `Reprice <type>+{ACCOUNT}+{visibility}` | The wrapper for the whole reprice pass on that leg. Carries the thrown exception (class + message + file:line). | `exception` lives at the top level (sometimes a JSON string, sometimes a dict). |

Exact context strings per source are in
[`../../../db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#per-content-source-context-hints).
Use equality on `context` when known. See
[`./optimizer_logs_patterns.md` — *Top-level content vs meta placeholders*](optimizer_logs_patterns.md#top-level-content-vs-meta-placeholders).

## Step 4 — Per-leg classification buckets

For each operand in each attempt, find the **corresponding** supplier API
call (match by order within the attempt) and classify:

| Bucket | When |
|---|---|
| `supplier_0_routings` | Supplier returned 0 routings. **Supplier-side** — no amount of our-code fixing would help. |
| `supplier_gap` | Supplier returned routings, but **none** of them contains the operand's anchor flight(s). Supplier returned substitutes only. **Supplier-side.** |
| `supplier_returned_with_fb` | Supplier returned the anchor's flight **with** a populated `fareBasisCode`, but we still threw `Incalculable`. **Possibly our-side** — predicate mismatch on fare basis / booking class / cabin. Worth a deeper dive. |
| `pure_our_side_leak_fb_empty` | Supplier returned all of the operand's anchor flights, but **every** occurrence has `fareBasisCode=[]` or a null/empty fb. **Pure our-side** — our package-assembly gate drops these before the matcher. Typically LCC carriers (F8, F9, VB, VZ, TR, G4). **Rescue-able by relaxing the fb gate.** |

For the last two buckets also record the segments' `cabinCode`,
`bookingClass` and `opCarrier` so the report can show which LCC /
legacy-carrier split is driving the pattern.

### Reusable classifier (template)

```python
import os, json, subprocess, collections
from pymongo import MongoClient

client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=15_000)
coll = client["ota"]["optimizer_logs"]

# gds, window_hours, cap provided by caller
GDS = "unififi"
SOURCE_PREFIX = "Unififi"                 # context prefix
API_CONTEXTS = [
    "unififi-api[UNIFIFICAD] search",
    "unififi-api[UNIFIFIUSD] search",
]
WRAP_REGEX = r"^Reprice (reprice_and_drop|new_package|multicurrency|single_to_multi)\+UNIFIFI"
WINDOW_HOURS = 24
CAP = 200
INCLUDE_REPRICE_AND_DROP = False

reprice_type_filter = "" if INCLUDE_REPRICE_AND_DROP else "AND oc.reprice_type <> 'reprice_and_drop'"
sql = f"""
SELECT oa.search_id, oc.validating_carrier
FROM ota.optimizer_candidates oc
JOIN ota.optimizer_attempts oa ON oa.id = oc.attempt_id
WHERE oc.gds='{GDS}'
  AND oc.created_at >= NOW() - INTERVAL {WINDOW_HOURS} HOUR
  AND oc.candidacy IN ('Incalculable','Unsalable')
  {reprice_type_filter}
ORDER BY oc.attempt_id DESC
LIMIT {CAP}
"""
r = subprocess.run(["python3","scripts/mysql_query.py","query", sql],
                   capture_output=True, text=True, env={**os.environ})

pairs = []
for line in r.stdout.splitlines():
    parts = [p.strip() for p in line.split("|")]
    if len(parts) >= 2 and len(parts[0]) == 32 and all(c in "0123456789abcdef" for c in parts[0].lower()):
        pairs.append((parts[0], parts[1]))

leg_buckets = collections.Counter()
carrier_buckets = collections.defaultdict(lambda: collections.Counter())
attempt_verdicts = collections.Counter()
examples_pure_leak = []

for sid, mysql_carrier in pairs:
    ops  = list(coll.find({"transaction_id": sid, "context": f"{SOURCE_PREFIX}::Reprice-original-operands"}).sort("date_added", 1))
    apis = list(coll.find({"transaction_id": sid, "context": {"$in": API_CONTEXTS}}).sort("date_added", 1))
    if not ops:
        leg_buckets["no_operand_log"] += 1
        attempt_verdicts["no_operand_log"] += 1
        continue

    per_leg_verdicts = []
    for i, op in enumerate(ops):
        try: a = json.loads(op.get("1", "{}"))
        except Exception: a = {}
        op_fns = set(a.get("flightNumbers") or [])
        itin = a.get("itinerary") or []
        op_carrier = next(iter(set(s.get("operating_carrier_code") or "" for s in itin)), "") or "UNKNOWN"

        if not op_fns:
            bucket = "op_no_fn"
        else:
            api = apis[i] if i < len(apis) else None
            if api is None:
                bucket = "no_api_for_op"
            else:
                try: resp = json.loads(api.get("Response", "{}"))
                except Exception: resp = {}
                routings = resp.get("routings") or []
                if not routings:
                    bucket = "supplier_0_routings"
                else:
                    resp_flights = set()
                    fb_by_flight = collections.defaultdict(list)
                    for rt in routings:
                        for it in (rt.get("itineraries") or []):
                            for s in (it.get("segments") or []):
                                raw = str(s.get("flightNumber",""))
                                resp_flights.add(raw)
                                if raw in op_fns:
                                    fb = s.get("fareBasisCode")
                                    if isinstance(fb, list):
                                        fb_by_flight[raw].append("EMPTY" if len(fb)==0 else "SET")
                                    elif isinstance(fb, str):
                                        fb_by_flight[raw].append("EMPTY" if not fb else "SET")
                                    else:
                                        fb_by_flight[raw].append("EMPTY")
                    if op_fns - resp_flights:
                        bucket = "supplier_gap"
                    else:
                        any_set = any("SET" in fb_by_flight[fn] for fn in op_fns)
                        all_empty = all("EMPTY" in fb_by_flight[fn] and "SET" not in fb_by_flight[fn] for fn in op_fns)
                        if all_empty and not any_set:
                            bucket = "pure_our_side_leak_fb_empty"
                            if len(examples_pure_leak) < 15:
                                examples_pure_leak.append((sid, op_carrier, sorted(op_fns)))
                        else:
                            bucket = "supplier_returned_with_fb"

        leg_buckets[bucket] += 1
        carrier_buckets[op_carrier][bucket] += 1
        per_leg_verdicts.append(bucket)

    # Attempt-level verdict: attempt is our-side only if EVERY leg is our-side
    if any(v == "supplier_gap" or v == "supplier_0_routings" for v in per_leg_verdicts):
        attempt_verdicts["supplier_dominated"] += 1
    elif all(v == "pure_our_side_leak_fb_empty" for v in per_leg_verdicts):
        attempt_verdicts["pure_our_side_leak"] += 1
    elif all(v in ("pure_our_side_leak_fb_empty","supplier_returned_with_fb") for v in per_leg_verdicts):
        attempt_verdicts["our_side_mixed"] += 1
    else:
        attempt_verdicts["other"] += 1

print("Leg buckets:", dict(leg_buckets))
print("Attempt verdicts:", dict(attempt_verdicts))
```

Adapt `SOURCE_PREFIX`, `API_CONTEXTS`, `WRAP_REGEX`, and the `routings[]`
accessors for non-unififi sources — the data shape is almost identical for
PKFare (context `pkfare-no-matching-itineraries`, different payload keys)
but must be confirmed against the per-source context table in
[`../../../db-docs/mongodb/optimizer_logs.md`](../../../../db-docs/mongodb/optimizer_logs.md#per-content-source-context-hints).

## Step 5 — Attempt-level verdict

Aggregate per-leg verdicts into a per-attempt verdict:

| Attempt verdict | Rule |
|---|---|
| `supplier_dominated` | Any leg is `supplier_gap` or `supplier_0_routings`. Fixing our-side won't rescue this attempt. |
| `pure_our_side_leak` | **Every** leg is `pure_our_side_leak_fb_empty`. Relaxing the fb gate would fully rescue this attempt. **This is the rescue-able headline number.** |
| `our_side_mixed` | Every leg is our-side (`pure_our_side_leak_fb_empty` or `supplier_returned_with_fb`), mix of empty-fb and populated-fb. Needs a two-pronged fix. |
| `other` | Edge cases (missing logs, op with no flight numbers, etc.). Inspect individually; do not include in headline counts. |

Only attempts with verdict `pure_our_side_leak` (plus the `fb_empty`
sub-portion of `our_side_mixed`) are rescue-able by the LCC-fare-basis
ticket. Do not inflate the count by including single-leg classification
across multi-leg attempts where another leg is dominant.

## Step 6 — Group and pick examples

Group the pure-leak attempts by **operating carrier** (on the pure-leak
leg). Pick 3 representative `transaction_id`s per carrier and capture:

- Anchor `flightNumbers`, `fareBasisCodes`, `bookingClasses`, `cabinCodes`.
- Supplier routing excerpt showing the exact flight with `fareBasisCode=[]`.
- Wrapper exception class + message (`IncalculableRepricerException` / `AdmissibleRepricerException`).
- Permalink: `https://reservations.voyagesalacarte.ca/debug-logs/log-group/{transaction_id}`.

For the `supplier_returned_with_fb` bucket, capture which predicate failed
(usually `same fare basis codes` or `same booking classes`) — that is the
seed for the secondary fix.

## Step 7 — Report template

```markdown
# Contestant-forming leak audit — {gds}

- **Window:** {start} .. {end}  ({hours}h)
- **Scope:** candidacy IN ('Incalculable','Unsalable'), reprice_and_drop
  excluded ({"included" if opted in}), policy exceptions excluded by default.
- **Attempts scanned (MySQL):** {total}  — sampled {cap} for Mongo deep-dive.

## Candidacy distribution (24h)

| candidacy | reprice_type | candidates | attempts |
| ... | ... | ... | ... |

## Leg-level classification ({N_legs} operand-legs)

| Bucket | Count | % | Side |
|---|---:|---:|---|
| supplier_0_routings | … | … | supplier |
| supplier_gap | … | … | supplier |
| supplier_returned_with_fb | … | … | our-side (predicate mismatch) |
| **pure_our_side_leak_fb_empty** | … | … | **our-side (rescue-able)** |

## Attempt-level verdicts ({N_attempts})

| Verdict | Count | Rescue-able? |
|---|---:|---|
| supplier_dominated | … | No |
| pure_our_side_leak | … | **Yes — relax fb gate** |
| our_side_mixed | … | Partial |
| other | … | — |

## Per-carrier breakdown (pure-leak legs only)

| Operating carrier | pure_leak | supplier_gap | with_fb | Total legs |
| VB | 2 | 5 | 4 | 12 |
| F8 | 1 | 5 | 0 | 7 |
| … |

## Rescue-able examples (`pure_our_side_leak_fb_empty`)

### {carrier} — {flight}  (tx=…)

- Anchor `fareBasisCodes`=…, `bookingClasses`=…, `cabinCodes`=…
- Supplier returned the flight in {N} routings, e.g.:
  ```
  {flight} {date}  cabinCode={cc}  fareBasisCode=[]
  ```
- Exception: {class} "{message}"
- [Permalink](…)

(Repeat per representative example; aim for ≥1 per LCC carrier.)

## Rescue-able count (extrapolated)

- ~{pct}% of Incalculable/Unsalable attempts are pure_our_side_leak.
- Daily Incalculable volume ≈ {N}/day → **~{rescue}/day rescue-able** by
  relaxing the fareBasisCode gate for LCC operating carriers.

## Ticket wording

> **Title:** Relax strict fare-basis equality in {gds} package assembly for LCC operating carriers
>
> **Context:** … (example anchor + supplier excerpt + permalink)
>
> **Ask:** When operating carrier is a known LCC, skip fare_basis /
> booking_class / cabin_code equality predicates in package assembly; match
> on (operating carrier, flight number, departure date) only. Keep strict
> matching for legacy carriers.
>
> **Impact:** {rescue}/day contestants rescued.

## Secondary signal — `supplier_returned_with_fb`

{N} legs had the supplier return the anchor flight **with** populated fb,
yet we still failed. Predicate split:
- same fare basis codes: … (… %)
- same booking classes: … (… %)
- same cabin codes: … (… %)

These cases are not covered by the LCC ticket above — they would need a
separate relaxation on legacy carriers. Flag as follow-up; do not bundle.

## Caveats

- Sample capped at {cap} attempts; extrapolation assumes proportional
  distribution across the full window.
- `optimizer_logs` is likely capped; older traffic may have rotated out.
```

## Step 8 — Post-run learning

Update `db-docs/mongodb/optimizer_logs.md` when:

- A new source's `{Source}::Reprice-original-operands` / `{source}-api[...]`
  / `Reprice <type>+{ACCOUNT}+{visibility}` context is confirmed.
- A top-level field name differs from the current docs (e.g. `1` vs
  `body` vs `Response`).
- The `_scopes` multi-ticket naming changes for a source.

Update `db-docs/mysql/optimizer_candidates.md` if new `candidacy` values or
`reprice_type` values show up during the audit.

## Step 9 — Trello follow-up

Offer to open a Trello card with the ticket wording above via
[`../../trello_content_integration/SKILL.md`](../../trello_content_integration/SKILL.md).
Include ≥3 permalinks and the rescue-able count so the content integration
team can act without re-running the scan.

## Common pitfalls (learned the hard way)

- **Picking one operand per attempt.** Multi-ticket bundles have `master_N`
  **and** `slave_N` operands. `find_one(..., sort=...)` gives you one of
  them and silently mis-attributes the failure cause. Always iterate over
  every operand log.
- **Matching a non-LCC anchor's fareBasisCode against supplier `fb=[]`.**
  This is the exact LCC pattern — don't treat it as a supplier bug. The
  supplier is correct (LCCs don't use fare basis); our code is wrong.
- **Conflating `Unsalable` with failure.** `Unsalable` +
  `reprice_type='reprice_and_drop'` is intentional — see `SKILL.md`. Only
  non-drop `Unsalable` candidates belong in this audit.
- **Codeshare flight-number mismatches.** Anchor may carry marketing
  `UA9929`, supplier response carries operating `SN501`. Compare on
  (`opCarrier`+`opFlightNumber`) as a fallback key before declaring a gap.
- **`packages` arriving as a string or dict with numeric keys.** Some
  matching-event payloads stringify their inner arrays. Use
  `json.loads(raw or "[]")` and `isinstance(p, dict)` guards in the
  classifier.
