# MongoDB Query Rules

This rule covers (1) querying **`debug_logs`** and **`optimizer_logs`** with `scripts/mongo_query.py`, and (2) maintaining the shared **system map** so agents know where to search and what internal systems mean—without duplicating `db-docs/` schemas.

## System context map

**Canonical file:** `.cursor/rules/system-map.md`

**When to read**

- Before non-trivial investigations that may use Mongo logs: bookability deep dives, payments/charges, supplier-specific behavior, or “where are the debug logs for …”.
- When the user mentions internal products (e.g. Payhub, GDS paths) and you need **where to look**, not only SQL.

**When to update `system-map.md`**

- After you **confirm** something **reusable** and **stable**: log filters, service names, glossary entries (e.g. what Payhub covers), per–content-source hints for `debug_logs`.
- Do **not** use it as a scratchpad for one-off hypotheses. Prefer short factual bullets.
- If a fact belongs in **`db-docs/`** for a specific table, **link there** instead of pasting schema detail.
- **How to edit:** append or small patches; correct wrong lines with a brief date if useful; avoid deleting others’ notes without cause.

---

## Scope

- **Database:** `ota`
- **Collections:** `debug_logs`, `optimizer_logs`

**Note:** Exploration of other databases or collections is prohibited.

## Collection structure and when to use which

### `debug_logs` — full process (start here for investigations)

`debug_logs` records the **entire** OTA flow for a transaction: search, storefront, checkout, booking, ticketing, supplier API calls, and related steps. It **excludes** repricing calls made by the optimizer — those live only in `optimizer_logs`.

**Investigation rule:** When debugging or analyzing a problem, **query `debug_logs` first**. It is the right place to understand end-to-end behavior outside of repricing.

### `optimizer_logs` — repricing only

`optimizer_logs` contains **only** repricing-related activity from the optimizer (e.g. repricing attempts against different GDS/content sources). It does **not** include checkout, booking, ticketing, or other post-search flows — those appear in `debug_logs`.

### Multiple contestants and content sources

Both collections can contain entries for **many different contestants** (e.g. Amadeus vs Sabre paths) for the same `transaction_id`. When investigating a **specific** issue (e.g. “what happened on Sabre?”), **narrow by content source** — filter or read log payloads for the relevant GDS/supplier (e.g. `sabre`, `amadeus`) so you do not mix unrelated paths.

**Mandatory when the user names a content source / supplier:** Do **not** return or interpret logs from other contestants for that question. **Always** add a filter that limits `context` (and/or other known discriminator fields) to that source.

- **Prefer exact `context`** when you know the full string (e.g. `"Downtowntravel::BookFlight"`). Equality is faster and avoids accidental matches.
- **If the exact `context` values are unknown**, constrain `context` with a **case-insensitive regex** on the supplier/integration name so only matching steps are included—for example Downtowntravel:

```json
{
  "context": { "$regex": "Downtowntravel", "$options": "i" }
}
```

Combine with **`transaction_id`** and/or **`date_added`** bounds whenever possible (see Performance). For supplier-visible error text, prefer matching on **`Response`** (and similar payload fields) **in addition** to this `context` scope, not instead of it—otherwise you can still mix paths when multiple sources log under one transaction.

### Shared fields (both collections)

- `transaction_id`: Correlates with MySQL `search_hash` / storefront transaction id; use it to join MySQL bookability rows with Mongo.
- `date_added`: Time-based filtering and recency.
- `level`: Severity (e.g. info, error, debug).
- `context`: Component or step that emitted the log (read together with payload fields).

## Querying Guidelines

### Investigation order

1. **`debug_logs`** — transaction-wide flow (checkout, booking, supplier calls outside repricing, errors). If the question names a **content source** / supplier, **always** narrow **`context`** to that source (exact string if known; otherwise case-insensitive `$regex` on the supplier name—see above).
2. **`optimizer_logs`** — only if the issue is repricing / fare mismatch after optimization; same `transaction_id`, and the same **content-source** narrowing on `context` when multiple optimizers could appear.

### Performance
1. **Use Indexes:** Both collections are indexed by `transaction_id` and `date_added`. Always include one of these in your filter for performance.
2. **Limit Output:** These collections are very large. Always use the `--limit` flag (default is 1000) and avoid large scans.
3. **Capped Collections:** These are capped collections. They are optimized for high-speed writes and sequential reads. Sorting by `$natural: -1` is a fast way to get the most recent entries.

### Using scripts/mongo_query.py

#### List Collections
```bash
python3 scripts/mongo_query.py collections ota
```

#### Find Recent Logs
```bash
python3 scripts/mongo_query.py find debug_logs ota --sort '{"date_added": -1}' --limit 10
```

#### Filter by transaction ID (prefer `debug_logs` first)
```bash
python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' --limit 200
python3 scripts/mongo_query.py find optimizer_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' --limit 200
```
Use repricing logs only when the question is about optimizer/reprice; restrict interpretation to the relevant content source (e.g. Sabre vs Amadeus) when both appear.

#### Filter by content source (narrow `context`)

When the investigation is about a **named** supplier/content source, **combine** `transaction_id` or `date_added` with a `context` constraint. Example: Downtowntravel only, for one transaction:

```bash
python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID", "context": {"$regex": "Downtowntravel", "$options": "i"}}' --limit 200
```

For aggregations, put the same `$match` fields in the first pipeline stage.

#### Aggregate for Specific Contexts
```bash
python3 scripts/mongo_query.py aggregate debug_logs '[{"$match": {"context": "BookingProcess"}}, {"$group": {"_id": "$level", "count": {"$sum": 1}}}]' ota
```

## Safety and Best Practices

- **Never** perform full collection scans (e.g., `find {}` without a limit or filter on a time field).
- **Use `--json`** when you need detailed BSON types (ObjectIds, Dates) in your output.
- **Source Credentials:** Always source the `.env` file before running the script:
  ```bash
  set -a && source .env && set +a
  ```
