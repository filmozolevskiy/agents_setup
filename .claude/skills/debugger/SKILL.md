---
name: debugger
description: >-
  Use when debugging, analyzing, or investigating anything on the FlightHub / JustFly
  platform — "debug this booking", "investigate this transaction", "why is
  this fare not bookable", "failure rate for <content source / carrier /
  office>", "bookability report", "similar-errors report", "what went wrong
  for booking_id / search_hash", "analyze these logs", "trace this error",
  "something looks off with payments / ticketing / this supplier", "why was
  fare X missed or mistagged", "contestant-forming leak audit", "optimizer
  matching audit", "reprice analysis", "contestants for attempt N". Single
  front door for evidence-based investigation: reads a partitioned
  system-knowledge base to orient, gathers evidence across MySQL /
  ClickHouse / MongoDB (via db_access), genesis code (via codebase_access)
  and Datadog. Covers bookability and optimizer investigations through its
  knowledge base.
  Hands off to deploy_blamer (regression with a clean onset time) or
  qa_assistant (live reproduction). Maintains the knowledge base: after an
  investigation it proposes durable-fact updates.
---

# Debugger

Single front door for investigating the FlightHub / JustFly platform. It replaces the former `bookability` and `optimizer` skills; what they knew now lives in [`knowledge/booking-flow.md`](knowledge/booking-flow.md), [`knowledge/optimizer.md`](knowledge/optimizer.md) and the other subsystem files.

Three jobs:

1. **Orient** — read the system-knowledge base (`knowledge/`) so the investigation starts from how the subsystem actually behaves.
2. **Investigate** — form a hypothesis, gather evidence, and follow the matched knowledge file or investigate directly.
3. **Maintain** — after an investigation, propose durable discoveries back into the knowledge base.

## When to use

- The user names a symptom, an ID (`booking_id`, `search_hash` / `transaction_id`, `attempt_id`), or a supplier and asks what went wrong.
- Bookability questions: failure rates, "why is this fare not bookable", similar-errors reports.
- Optimizer questions: why a fare was missed or mistagged, contestant-forming leaks, reprice analysis.
- The symptom spans subsystems (a Datadog error spike, an app-log exception, a data mismatch between stores).

## When NOT to use

- "What changed / which PR caused this regression" with a clean onset time → [`deploy_blamer`](../deploy_blamer/SKILL.md).
- Driving a real test booking → [`qa_assistant`](../qa_assistant/SKILL.md).
- Looking up a table's schema or finding which table holds a concept → [`db_access`](../db_access/SKILL.md).
- Watching production after a deploy → [`post_deploy_tracker`](../post_deploy_tracker/SKILL.md).

## Workflow

### 1. Orient from the knowledge base

Read [`knowledge/_index.md`](knowledge/_index.md) first. It has a symptom → subsystem lookup and a one-line scope per file. Match the symptom to a subsystem, then read **only** the matched subsystem file(s). Do not preload all of them.

The subsystem file tells you how the area works, what normal vs abnormal looks like, the known failure modes, and which log contexts / tables / code paths / Datadog surfaces to check. Follow its links for schema (`db_access/db-docs/`), code (genesis), and terms (glossary); the file does not restate them.

If no subsystem matches, say so, investigate from first principles, and propose a knowledge-base gap at the end (§ 5).

### 2. Form a hypothesis

State the symptom, the subsystem(s) it points at, and the most likely cause(s), as a short hypothesis. Prefix anything not yet backed by an artefact with `Assumption:` per the constitution.

### 3. Gather evidence

Load the owning skill's foundations before querying. Do not invent connection strings or grep an unsynced clone.

| Source | Tooling | Load first |
|--------|---------|------------|
| MySQL / ClickHouse / MongoDB | `.claude/skills/db_access/scripts/{mysql,clickhouse,mongo}_query.py` | [`../db_access/SKILL.md`](../db_access/SKILL.md); for Mongo, [`../db_access/references/mongodb_query_mechanics.md`](../db_access/references/mongodb_query_mechanics.md) |
| genesis application code | `Grep` / `Read` against `$GENESIS_PATH` after sync | [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md) — run `sync_genesis.sh` first, always |
| Datadog (traces, APM, app-logs, error tracking, RUM) | Datadog MCP (`datadog`) | Setup: https://docs.datadoghq.com/bits_ai/mcp_server/setup/; load the matching skill with `load_datadog_skill` |
| Feature flags / experiments | GrowthBook MCP | [`../growthbook_assistant/SKILL.md`](../growthbook_assistant/SKILL.md) |

Datadog is the surface the DB-based knowledge files lack. Reach for it when the symptom is a runtime error, latency, an exception with no clean DB row, or a cross-service trace — not when a `debug_logs` context or a MySQL row already answers the question.

### 4. Route when another skill owns it

| Evidence points at | Hand off to |
|--------------------|-------------|
| A regression with a clean onset time | [`deploy_blamer`](../deploy_blamer/SKILL.md) |
| Need a live reproduction on staging / production | [`qa_assistant`](../qa_assistant/SKILL.md) |
| A table you cannot identify or that has no doc | [`db_access`](../db_access/SKILL.md) |

Otherwise investigate here. For bookability rates and single-booking traces, use the "How to measure bookability" and "Tracing one booking" sections of [`knowledge/booking-flow.md`](knowledge/booking-flow.md). For matching audits, use the mistake classes and multi-ticket rules in [`knowledge/optimizer.md`](knowledge/optimizer.md).

### Query discipline

- Start every SQL / ClickHouse query with a CTE that names the slice once (filters, window, joins). End with the aggregate; keep the example-listing `SELECT` as a commented-out counterpart. In Mongo, the leading `$match` plays the same role.
- Bound every query: `created_at` / `date_added` window or an indexed ID filter. Never run `find {}` on `debug_logs` / `optimizer_logs`; never `SELECT *` without filter + `LIMIT`.
- Reuse denominators and anchors within one investigation. Do not redefine a rate or the optimizer anchor candidate between queries.
- State window and timezone on every number.
- Supplier payload wins over SQL state for root-cause narrative. Flag the difference as "SQL vs Mongo mismatch".

Subsystem-specific rules (join keys, base filters, classification lenses, multi-ticket handling, `reprice_and_drop` exclusion) are in the matching knowledge file.

### 5. Report, then propose knowledge-base updates

**Report:** lead with the answer. Use business-facing language; internal identifiers go only in runnable `Proof` cells. Every claim carries an artefact. Put long dumps under `reports/` (gitignored) and cite the path.

**Maintain (mandatory close-out):** surface any *durable, reusable* fact the investigation confirmed. Propose where it lands; get approval before writing. Never write silently.

| Discovery type | Proposed destination |
|----------------|---------------------|
| How a subsystem behaves; a new failure mode; a log context / code path / Datadog dashboard to check next time | `knowledge/<subsystem>.md` (+ bump `_index.md` scope / last-updated) |
| A table / column meaning, per-content-source log hint, stable enum or tag value | `.claude/skills/db_access/db-docs/<store>/<table>.md` |
| A new product surface, internal screen, or supplier term | `../../GLOSSARY.md` |
| An analyst-side trap (a cluster that looks like X but is Y), a mistake-classification rule, a tolerance | the "Known traps" / mistake-class section of the matching knowledge file |

Durability bar: propose only facts that help a *future, different* investigation and that an artefact in this session proves. If nothing durable surfaced, say so.

## Knowledge base

Lives under [`knowledge/`](knowledge/). One file per subsystem plus an index. Content is **behavior and process only**. Schemas stay in `db_access/db-docs/`; terms stay in `GLOSSARY.md`; code stays in genesis.

| File | Scope |
|------|-------|
| [`knowledge/_index.md`](knowledge/_index.md) | Symptom → subsystem lookup + per-file scope and last-updated. Read first, every time. |
| [`knowledge/booking-flow.md`](knowledge/booking-flow.md) | Checkout → availability → pre-air-booker → book → post-air-booker flow and failure modes. |
| [`knowledge/optimizer.md`](knowledge/optimizer.md) | Repricing / contestant-forming behavior; how the optimizer can reroute a booking. |
| [`knowledge/payments.md`](knowledge/payments.md) | Payhub flow, virtual cards, statements. |
| [`knowledge/content-sources.md`](knowledge/content-sources.md) | Per-supplier / GDS behavior, offices, per-source log hints. |
| [`knowledge/search.md`](knowledge/search.md) | Search → results page; which content sources responded. |
| [`knowledge/ticketing.md`](knowledge/ticketing.md) | Ticketer flow, `AirTicketRQ`, session close, statement finalization. |
| [`knowledge/ancillaries.md`](knowledge/ancillaries.md) | Baggage and ancillary optimization behavior. |
| [`knowledge/observability.md`](knowledge/observability.md) | Where evidence lives per subsystem — Mongo contexts, ClickHouse / MySQL tables, Datadog. |

## What not to do

- Do not preload every knowledge file. Read `_index.md`, then only the matched subsystem file(s).
- Do not restate schemas, code, or glossary terms inside knowledge files. Link out.
- Do not write knowledge / db-docs / glossary updates silently. Propose, get approval, then write.
- Do not skip the genesis sync before reading code, or invent DB connection strings.
- Do not mutate production data. All SQL is `SELECT`; all Mongo is `find` / `aggregate`; Datadog is read-only.
- Do not use `optimizer_logs` in a bookability investigation. Deep dives there use `ota.debug_logs`.

## References

- DB foundations and query CLIs: [`../db_access/SKILL.md`](../db_access/SKILL.md).
- genesis code access: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- Trello formatting for follow-up cards: [`../trello_assistant/SKILL.md`](../trello_assistant/SKILL.md).
- Handoffs: [`../deploy_blamer/SKILL.md`](../deploy_blamer/SKILL.md), [`../qa_assistant/SKILL.md`](../qa_assistant/SKILL.md).
- Constitution + glossary: [`../../../CLAUDE.md`](../../../CLAUDE.md), [`../../../GLOSSARY.md`](../../../GLOSSARY.md).
