# Classification Guide

Every error signature in the report must be tagged with exactly one of three labels. Apply these
rules after reading the `debug_logs` evidence for the signature. When signals conflict, **supplier
evidence wins** over MySQL `contestant_error` — see the evidence hierarchy in
[`../bookability_analysis/references/debug_logs_query_patterns.md`](../bookability_analysis/references/debug_logs_query_patterns.md).

---

## [Provider-side]

The content source / GDS / supplier caused the failure. The correct action is to report the issue
to the provider or create a Trello card for the Content Integration team to follow up with them.

**Classify as Provider-side when:**
- `debug_logs` shows a well-formed outbound request **and** a clear supplier rejection response
  in `Response` (or equivalent raw payload field)
- Explicit supplier error codes are present: GDS codes (e.g. `NDC-1348`, `INVALID_FARE`),
  HTTP 4xx from the supplier API, supplier-specific status strings
- Supplier messages indicating availability or policy rejection:
  - "Flight not available", "No available solution", "No seats", "Sold out"
  - Fare/price/itinerary rejected by supplier rules
  - Age/passenger-type policy violation (`INVALID_AGE_FOR_PAX_TYPE`, etc.)
  - "Similar order already exists" (supplier-side void/cancel semantics)
- The supplier response body is present and non-empty, and the rejection is clearly from the
  supplier side of the wire

---

## [Our-side]

Our code, configuration, or infrastructure caused the failure. The correct action is an internal
fix — no need to report to the provider.

**Classify as Our-side when:**
- `debug_logs` shows **no supplier `Response`** at all — the failure happened before we reached
  the supplier (our validation, our serialization, our network)
- Our request to the supplier was **malformed** (bad XML/JSON shape, missing required fields,
  wrong encoding) — the supplier returned a parse or format error, not a business-logic rejection
- **Timeout or connection error** originating from our network stack (distinguish from supplier
  timeout: if the supplier returned a timeout error code in `Response` it may be provider-side)
- Our internal flow blocked the attempt **before calling the supplier**:
  - `pre-air-booker` validation failure
  - Loss-limit / fare-increase block (`loss_limit_fare_increase`)
  - Optimizer rejection
- Office ID, credentials, or API key misconfiguration visible in the log
- Stack trace in our application code with no accompanying supplier response
- Our payment/payhub path failed (note: `payment_error` is already excluded from the scan — if
  one slips through with a generic code, reclassify it here)

---

## [Needs investigation]

Insufficient evidence to classify confidently. Flag for manual review before taking action.

**Classify as Needs investigation when:**
- **No `debug_logs` match** for any of the sampled `transaction_id`s — logs may have been
  rotated (capped collection) or the hash correlation failed
- **No clear supplier `Response`** found in the spot-checked logs for the error_message reported in ClickHouse
- **ClickHouse vs Mongo mismatch**: the `error_message` in `jupiter_booking_errors_v2` does not
  match what the supplier response shows in Mongo — state the mismatch explicitly and do not guess
- **Mixed signals** within the same ClickHouse error bucket: different spot-checked transactions show
  different root causes — split into sub-groups if possible, otherwise flag
- **Ambiguous supplier response**: `Response` field is present but empty, partially truncated,
  or contains only a generic wrapper (e.g. `{"reason": "failed"}`) with no actionable code
- Fewer than 2 corroborating spot-checks confirm the same pattern (single-log evidence only)

---

## Classification decision checklist

For each signature, work through this in order:

1. Did Mongo return log entries for the sampled `transaction_id`s?
   - No → **Needs investigation** (log gap)
   - Yes → continue

2. Is there a supplier `Response` (or equivalent raw payload) in the matching log lines?
   - No `Response` / only our stack traces → **Our-side**
   - Yes → continue

3. Does the `Response` contain a clear supplier rejection code or message?
   - Yes, supplier explicitly rejected → **Provider-side**
   - No, supplier returned an error but it's about our request format → **Our-side**
   - Ambiguous / empty body / generic wrapper → **Needs investigation**

4. Do 2–3 spot-checked transactions show the same pattern?
   - Yes → classify confidently
   - No, mixed patterns → **Needs investigation** or split into sub-signatures

5. Does the Mongo classification contradict the MySQL `contestant_error`?
   - Yes → flag **"ClickHouse vs Mongo mismatch"** in the report and use Mongo evidence for classification
