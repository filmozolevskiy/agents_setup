# optimizer_logs

**Database:** `ota`
**Purpose:** Logs specifically related to the booking optimizer, tracking fare selection, optimization logic, and transaction details.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `ObjectId` | Unique identifier for the log entry |
| `meta` | `Object` | Metadata associated with the log |
| `_scopes` | `Array` | Execution scopes or contexts |
| `fares` | `Array` | Detailed fare information being optimized |
| `context` | `String` | Description of the optimization step or context |
| `level` | `String` | Log level (e.g., info, error, debug) |
| `source` | `String` | Source component (usually optimizer-related) |
| `transaction_id` | `String` | Unique ID for the user transaction |
| `ip` | `String` | Client IP address |
| `server_ip` | `String` | Server IP address |
| `date_added` | `ISODate` | Timestamp when the log was created |
| `user_agent` | `String` | Client user agent string |
| `pid` | `Int` | Process ID |

**Indexes:**
- `_id_`: `_id: 1`
- (Note: Based on debug_logs, likely has similar indexes for `transaction_id` and `date_added`)

**Common queries:**
```javascript
// Find optimizer logs for a specific transaction
db.optimizer_logs.find({ "transaction_id": "TRANS-123" }).sort({ "date_added": -1 })

// Check optimization steps for a specific IP
db.optimizer_logs.find({ "ip": "1.2.3.4" }).limit(50)
```

**Notes:**
- Focuses on the "fares" field which contains the core data being processed by the optimizer.
- Like `debug_logs`, this is likely a capped collection in the `ota` database.
