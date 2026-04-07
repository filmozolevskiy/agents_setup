# MongoDB Query Rules

This rule provides guidance on how to query the MongoDB collections `debug_logs` and `optimizer_logs` in the `ota` database using `scripts/mongo_query.py`.

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

### Shared fields (both collections)

- `transaction_id`: Correlates with MySQL `search_hash` / storefront transaction id; use it to join MySQL bookability rows with Mongo.
- `date_added`: Time-based filtering and recency.
- `level`: Severity (e.g. info, error, debug).
- `context`: Component or step that emitted the log (read together with payload fields).

## Querying Guidelines

### Investigation order

1. **`debug_logs`** — transaction-wide flow (checkout, booking, supplier calls outside repricing, errors).
2. **`optimizer_logs`** — only if the issue is repricing / fare mismatch after optimization; same `transaction_id`, filter mentally or in output by content source.

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
