# MongoDB Query Rules

Query **`debug_logs`** and **`optimizer_logs`** in database **`ota`** using `scripts/mongo_query.py`.

**Documentation:** Collection reference, glossary, observability pointers, and **verified** per–content-source hints live in **`db-docs/mongodb/debug_logs.md`** (append stable facts there). **`db-docs/`** holds schemas for other stores; this rule covers **how to query** safely.

---

## Which collection

| Collection | Use |
|------------|-----|
| **`debug_logs`** | Full OTA flow (search through booking, supplier calls, etc.). **Start here** for investigations. Excludes optimizer-only repricing calls. Field list: `db-docs/mongodb/debug_logs.md`. |
| **`optimizer_logs`** | **Only** repricing / optimizer activity. Same `transaction_id` as `debug_logs` when both apply. Field list: `db-docs/mongodb/optimizer_logs.md`. |

Use `optimizer_logs` only when the question is repricing or fare mismatch after optimization.

---

## `transaction_id`, competitors, and `context`

- **Join to MySQL:** `transaction_id` aligns with `search_hash` / storefront transaction id on bookability rows.
- **Multiple paths per id:** One `transaction_id` can mix different GDS/supplier flows. If the user names a **content source** or supplier, **do not** treat other contestants’ lines as evidence for that question.
- **Narrow `context`:** Prefer **equality** when you know the full string (e.g. `"Downtowntravel::BookFlight"`). If unknown, use a **case-insensitive `$regex`** on the integration/supplier name. Always tie to **`transaction_id`** (single value or **`$in`** from MySQL) so you do not scan unrelated traffic.
- **Supplier evidence:** Prefer **`Response`** (and similar payload fields) **together with** narrowed `context` — not `Response` alone across the whole transaction.

**Example filter** (replace ids and regex to match the case):

```json
{
  "transaction_id": { "$in": ["<id_from_mysql_1>", "<id_from_mysql_2>"] },
  "context": { "$regex": "Downtowntravel", "$options": "i" }
}
```

```bash
python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID", "context": {"$regex": "Downtowntravel", "$options": "i"}}' --limit 200
```

For aggregations, put the same `$match` fields in the first pipeline stage. Include **`transaction_id`** and/or **`date_added`** in filters when possible (indexed; see `db-docs` for each collection).

---

## `scripts/mongo_query.py` examples

#### List collections
```bash
python3 scripts/mongo_query.py collections ota
```

#### Recent logs
```bash
python3 scripts/mongo_query.py find debug_logs ota --sort '{"date_added": -1}' --limit 10
```

#### By `transaction_id` (debug first; add optimizer only if repricing)
```bash
python3 scripts/mongo_query.py find debug_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' --limit 200
python3 scripts/mongo_query.py find optimizer_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' --limit 200
```

#### Aggregate by context and level
```bash
python3 scripts/mongo_query.py aggregate debug_logs '[{"$match": {"context": "BookingProcess"}}, {"$group": {"_id": "$level", "count": {"$sum": 1}}}]' ota
```

---

## Safety and best practices

- **Never** run unbounded full collection scans (e.g. `find {}` without a time/index-friendly filter and limit).
- **`--json`** when you need BSON types (ObjectIds, dates) in output.
- **Credentials:** `set -a && source .env && set +a` before running the script.
