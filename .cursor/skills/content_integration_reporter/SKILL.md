---
name: content-integration-reporter
description: >-
  Use when proactively scanning all content sources for bookability issues,
  automatically investigating debug logs to find error patterns, classifying
  failures as provider-side / our-side / needs investigation, and producing
  a structured report with log permalinks and follow-up actions.
  Trigger phrases: "scan content sources", "check integrations for issues",
  "content integration report", "what's broken with our integrations",
  "find bookability issues across sources", "weekly integration health check".
---

# Content Integration Issue Reporter

Automates the full scan loop for GDS / content source integration problems: surface issues, classify them, produce a report ready for follow-up. No manual per-source investigation.

## When to use

| Trigger | Action |
|---------|--------|
| "Scan integrations", "content integration report", "check all sources" | Full scan across all sources for the window (default: last 7 days) |
| User names a single source + "reporter" | Scan only that source |
| After report: "message {source}" or "draft message to {source}" | Draft a plain-text / Slack message for provider-side issues |
| After report: "create trello card for {source}" / "file ticket for {issue}" | Hand off to `trello_content_integration` |

## Workflow

Six phases. Full templates in the references.

1. **Scope** — confirm date window and any source filter.
2. **ClickHouse scan** — query `jupiter.jupiter_booking_errors_v2` for all integration errors, excluding availability/pricing noise (`FLIGHT_AVAILABILITY_ERRORS`, `FARE_INCREASES`, `PRICING_DISCREPANCY_ERRORS`, `PAYMENT_ERRORS`).
3. **Mongo auto deep-dive** — for every significant error bucket, query `debug_logs` automatically.
4. **Prevalence** — count occurrences (7d + 30d) and harvest representative permalinks.
5. **Report** — produce the structured issues report.
6. **Follow-ups** — offer a Slack draft or Trello card.

Full steps and SQL / Mongo templates: [`references/scan_workflow.md`](references/scan_workflow.md).

## Classification

Tag every error signature before putting it in the report:

- **[Provider-side]** — supplier rejected the booking. Action: report to the content source.
- **[Our-side]** — our code / config caused the failure. Action: internal fix.
- **[Needs investigation]** — not enough evidence. Action: manual review.

Decision rules: [`references/classification_guide.md`](references/classification_guide.md).

## Report format

Structure, summary table, per-signature blocks, follow-up section: [`references/report_format.md`](references/report_format.md).

## Cross-cutting references

- **Initial scan table:** `jupiter.jupiter_booking_errors_v2` (ClickHouse) — schema and query in `references/scan_workflow.md`.
- **Mongo batch `$in` pattern and reclassification rules:** [`../bookability_analysis/references/deep_bookability_analysis.md`](../bookability_analysis/references/deep_bookability_analysis.md).
- **Evidence hierarchy (supplier > local exception):** [`../bookability_analysis/references/debug_logs_query_patterns.md`](../bookability_analysis/references/debug_logs_query_patterns.md).
- **Permalink harvest pipelines (Variants A/B/C):** [`../bookability_analysis/references/harvest_permalinks.md`](../bookability_analysis/references/harvest_permalinks.md).
- **MongoDB query safety rules:** [`../../rules/mongodb.md`](../../rules/mongodb.md).
- **Trello card format for follow-up:** [`../trello_content_integration/SKILL.md`](../trello_content_integration/SKILL.md).

## Key data points (`jupiter.jupiter_booking_errors_v2`)

- `gds` — content source / GDS identifier.
- `error_message` — supplier / integration error text. Richer than MySQL error codes — use as the starting Mongo signature.
- `classification_category` / `classification_subcategory` — pre-classification from our pipeline.
- `search_id` = MongoDB `transaction_id` — join key between ClickHouse and debug_logs.
- `booking_step` — which step in the booking flow failed.

**Excluded categories** (not integration issues, skip):
- `FLIGHT_AVAILABILITY_ERRORS`, `FARE_INCREASES`, `PRICING_DISCREPANCY_ERRORS`, `PAYMENT_ERRORS`.

## Rules

- Do not skip the Mongo deep-dive for buckets with ≥ 5 failures. The whole point is automated correlation. ClickHouse `error_message` is a start; Mongo reveals whether the failure is in the supplier response or in our code.
- Supplier evidence wins when ClickHouse and Mongo disagree. Flag the mismatch explicitly.
- Amadeus uses lowercase `response` in debug_logs (not `Response`). Check both when querying Amadeus transactions.

## Post-run learning (mandatory)

At the end of every run, before presenting the report, update `db-docs/mongodb/debug_logs.md` (content-source hints table) with anything newly confirmed. This keeps future runs faster and more accurate.

**Add a row when you confirm:**
- A new `context` string that contains supplier request/response data for a GDS (e.g. `flightroutes24-api[ACCOUNT] pricing.do`).
- A `context` that looks promising but has no response data — note the caveat so future runs skip it.
- A field name that differs from the standard (`Response`) — e.g. Amadeus uses lowercase `response`.
- A stable error code or message pattern for a content source worth matching directly in future.

**Remove or correct a row when:**
- A previously noted context no longer exists or changed shape.
- A previously noted field is absent or renamed in recent logs.
- A hint turns out to be wrong or misleading after spot-checking.

**Do not add rows for:**
- One-off errors unlikely to recur.
- Anything already in the hints table.
- Availability / pricing errors (filtered at Phase 2).

After updating `db-docs/mongodb/debug_logs.md`, commit the change with a short message referencing the run date and what was learned. Do this even if only one row changed.
