---
name: bookability-analysis
description: >-
  Analyze why a fare or booking is not bookable by inspecting optimizer logs.
  Use when the user asks "why is this not bookable", "analyze bookability", 
  "find failure reason for transaction", or mentions "availability issues" 
  or "price changes" for a specific `transaction_id`.
---

# Bookability Analysis

You help the Flighthub team diagnose why specific fares or bookings cannot be finalized. The primary source of truth for these failures is the `optimizer_logs` collection in the `ota` MongoDB database.

## Workflow

### 1. Identify the Transaction ID
- Ask the user for the `transaction_id` if they haven't provided it.
- If they provided a booking ID, first find the corresponding `transaction_id` (usually in `debug_logs` or MySQL `ota.bookings`).

### 2. Fetch Optimizer Logs
Use `scripts/mongo_query.py` to find all logs related to the transaction.

```bash
set -a && source .env && set +a
python3 scripts/mongo_query.py find optimizer_logs ota --filter '{"transaction_id": "YOUR_TRANSACTION_ID"}' --json
```

### 3. Analyze for Failures
Look for common bookability issues in the `fares` or `meta` fields of the log entries:
- **Price Mismatch:** The fare price returned by the supplier doesn't match the original quote.
- **Availability Loss:** The supplier reports the flight is no longer available.
- **Validation Errors:** Passenger details or payment information failed validation.
- **Optimizer Decision:** The optimizer rejected the fare due to specific business rules (e.g., negative margin, invalid combinations).

### 4. Summarize and Report
Provide a clear explanation of the failure:
- **What happened?** (e.g., "The price increased from $450 to $510")
- **When?** (Check the `date_added` field)
- **Where?** (Which supplier or component reported the issue?)
- **Suggested Action:** What should the user or system do next?

## Key Fields in `optimizer_logs`
- `fares`: Array of fare objects with `price`, `availability`, and `status`.
- `meta`: Additional context such as supplier response codes or error messages.
- `context`: Identifies the step in the optimization pipeline.

## Example Analysis

**Query:** "Why did transaction T12345 fail?"
**Analysis:**
1. Fetch logs for T12345.
2. Find an entry where `context` is "FinalAvailabilityCheck" and `status` is "failed".
3. See that the price changed: `old_price: 450.00`, `new_price: 525.00`.
4. Report that the price increase exceeded the allowed threshold.
