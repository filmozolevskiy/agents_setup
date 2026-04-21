# Report Format

Canonical output structure for the Content Integration Issues Report. Follow this exactly so the
report is consistent and scannable.

---

## Full report structure

```
# Content Integration Issues Report
Period: {YYYY-MM-DD HH:MM} → {YYYY-MM-DD HH:MM} UTC  |  Generated: {YYYY-MM-DD}

## Summary
| Source | Failures (bookability) | [Provider-side] | [Our-side] | [Needs investigation] |
|--------|------------------------|-----------------|------------|-----------------------|
| DTT    | 45                     | 32              | 8          | 5                     |
| AMADEUS| 12                     | 10              | 2          | 0                     |

_Failures = contestant failures (status = 0) excluding payment_error, with a valid search_hash,
above the threshold of ≥ {threshold} per bucket._

---

## {content_source}

**Total qualifying failures:** {N}  |  **Buckets investigated:** {M}

### [{tag}] {short error label}

**MySQL error code:** `{contestant_error}`  
**Scale:** {N} occurrences / {M} distinct transaction_id ({window}, in debug_logs)  
**Evidence:** {One-line plain-language summary of what the supplier logs show}  
**Suggested action:** {Report to provider | Fix on our side | Investigate further — see notes}

> **SQL vs Mongo mismatch** _(include only when applicable)_: MySQL shows `{code}` but Mongo
> shows `{actual supplier message}`. Mongo evidence used for classification.

Example logs:
- {permalink_1}
- {permalink_2}
- {permalink_3}

---

### [{tag}] {next signature}
...

---

## {next_content_source}
...

---

## Follow-up options

For **[Provider-side]** issues, you can ask me to draft a plain-text/Slack message to send to
the content source — just say "draft message to {source}" or "message {source} about {issue}".

For any issue, I can create a Trello card on the Content Integration board — say "create trello
card for {source}: {issue label}".
```

---

## Formatting rules

**Summary table**
- One row per content source that had qualifying failures in the window.
- Counts in the tag columns are counts of **distinct error signatures**, not raw failure counts.
  (Use raw failure counts for the "Failures" column.)
- Sort rows by total failures descending.

**Per-source sections**
- One `###` heading per distinct error signature (not per MySQL error code — signatures are the
  normalized supplier messages identified in Mongo).
- If a MySQL error bucket produced multiple distinct Mongo signatures, create a separate `###`
  block for each.
- Sort signatures within a source by occurrence count descending (most frequent first).

**Scale line**
- Always state both the log-line count and the distinct `transaction_id` count.
- State the window explicitly (e.g. "7d", "30d", or the exact dates if unusual).
- If counts come from a JSON-safe aggregate without `ISODate` bounds, note "approx." and state
  the caveat.

**Evidence line**
- One sentence, plain language. Examples:
  - "Supplier returns NDC-1348 INVALID_AGE_FOR_PAX_TYPE in BookFlight response."
  - "Our request arrives malformed — supplier returns a parse error with no business-logic code."
  - "No debug_logs entries found for sampled transaction_ids; likely rotated."

**Example logs**
- Use the permalink URL shape from
  [`harvest_permalinks.md`](../bookability_analysis/references/harvest_permalinks.md#permalink-url-shape):
  `https://reservations.voyagesalacarte.ca/debug-logs/log-group/{transaction_id}#{log_id}`
- Prefer **supplier-side** log documents (raw request/response) as the primary link; add local
  exception links only when they add context.
- 2–5 links per signature is enough; use Variant B (one per `transaction_id`) to avoid retry
  inflation.

**Needs investigation blocks**
- State explicitly why classification was not possible (no Mongo match, mixed signals, ambiguous
  response, SQL/Mongo mismatch).
- Still include any example permalinks you did find, even if inconclusive.

**What not to include in the report**
- Internal stack traces verbatim (summarize instead)
- Runbook prose explaining how to count or query — put that in the `mongo_query:` block on the
  Trello card, not in the report body
- More than 5 example links per signature (use `mongo_query:` harvest for the full set)
- Payment/payhub failures (`payment_error`) — already excluded from the scan
