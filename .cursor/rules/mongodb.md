# MongoDB Query Rules

This rule provides guidance on how to query the MongoDB collections `debug_logs` and `optimizer_logs` in the `ota` database using `scripts/mongo_query.py`.

## Scope

- **Database:** `ota`
- **Collections:** `debug_logs`, `optimizer_logs`

**Note:** Exploration of other databases or collections is prohibited.

## Collection Structure

### debug_logs
Stores general debug and error logs from OTA processes. Key fields:
- `transaction_id`: Use this for tracking a user transaction across logs.
- `date_added`: Use this for time-based filtering.
- `level`: Log severity (info, error, debug).
- `context`: Identifies the component or process that logged the message.

### optimizer_logs
Stores logs specifically related to the booking optimizer. Key fields:
- `fares`: Contains details about the fares being optimized.
- `transaction_id`: Cross-reference with `debug_logs`.
- `date_added`: Optimization timestamp.

## Querying Guidelines

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

#### Filter by Transaction ID
```bash
python3 scripts/mongo_query.py find optimizer_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}'
```

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
