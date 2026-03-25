# debug_logs

**Database:** `ota`
**Purpose:** General debug and error logs from various OTA (Online Travel Agency) processes, capturing transaction context, fare families, and server metadata.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `ObjectId` | Unique identifier for the log entry |
| `meta` | `Object` | Metadata associated with the log |
| `_scopes` | `Array` | Execution scopes or contexts |
| `available_fare_families` | `Array` | List of fare families available at the time of log |
| `base_fare_family` | `String` | The base fare family used |
| `package` | `Object` | Package information if applicable |
| `context` | `String` | Description of where the log was triggered |
| `level` | `String` | Log level (e.g., info, error, debug) |
| `source` | `String` | Source component or service name |
| `transaction_id` | `String` | Unique ID for the user transaction |
| `ip` | `String` | Client IP address |
| `server_ip` | `String` | Server IP address that processed the request |
| `date_added` | `ISODate` | Timestamp when the log was created |
| `user_agent` | `String` | Client user agent string |
| `pid` | `Int` | Process ID |

**Indexes:**
- `_id_`: `_id: 1`
- `transaction_id_`: `transaction_id: 1`
- `context_`: `context: 1`
- `date_added_`: `date_added: 1`
- `ip_`: `ip: 1`

**Common queries:**
```javascript
// Find logs for a specific transaction
db.debug_logs.find({ "transaction_id": "TRANS-123" }).sort({ "date_added": -1 })

// Find error logs from the last hour
db.debug_logs.find({
  "level": "error",
  "date_added": { "$gt": new Date(Date.now() - 3600000) }
})
```

**Notes:**
- This is a capped collection, meaning old logs are automatically overwritten when it reaches its size limit.
- Sorting by `date_added` is recommended for time-series analysis.
