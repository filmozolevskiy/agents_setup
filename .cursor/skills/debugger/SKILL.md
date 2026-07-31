---
name: debugger
description: >-
  Use when the user wants to debug, analyze, or investigate a symptom on the
  FlightHub / JustFly platform and no single specialist obviously owns it —
  "debug this booking", "investigate this transaction", "analyze these logs",
  "why did this booking behave weird", "what's going on with this search",
  "trace this error", "something looks off with payments / ticketing / this
  supplier", "look into this debug log". Generalist front door: reads a
  partitioned system-knowledge base to orient, forms a hypothesis, gathers
  evidence across MySQL / ClickHouse / MongoDB (via db_access), genesis code
  (via codebase_access), and Datadog (traces / APM / app-logs / error
  tracking), then hands off to a specialist skill (bookability, optimizer,
  deploy_blamer, qa_assistant) when the symptom fits one. Also maintains the
  knowledge base: after an investigation it proposes durable-fact updates.
  Not for pure bookability-rate reports (use bookability) or optimizer
  matching-leak audits (use optimizer) once the symptom is known.
---

# Debugger

Generalist debugging front door for the FlightHub / JustFly platform. Three jobs:

1. **Orient** — read a partitioned system-knowledge base (`knowledge/`) so the investigation starts from how the subsystem actually behaves, not from scratch.
2. **Investigate or route** — form a hypothesis, gather evidence across all data and code sources, and hand off to a specialist skill when the symptom squarely fits one.
3. **Maintain** — after an investigation, propose durable discoveries back into the right knowledge file so the next session starts smarter.

This skill does not duplicate the specialists' query logic. It orchestrates them and owns the cross-subsystem knowledge they do not.

## When to use

- The user names a symptom but not a specialist: "debug this booking", "investigate transaction X", "analyze these logs", "why is this behaving weird", "trace this error", "something's off with this supplier / payment / ticket".
- The symptom spans subsystems or has no obvious owner (a Datadog error spike, an app-log exception, a data mismatch between stores).
- The user gives an ID (`booking_id`, `search_hash` / `transaction_id`, `attempt_id`) and asks the open question "what went wrong?" — start here, orient, then route.

## When NOT to use

- Pure bookability-rate reporting ("failure rate for Amadeus last week", "bookability for office X") → `bookability` directly.
- Optimizer matching-leak audit once the symptom is known to be matching ("where is unififi missing contestants", "fare-basis leak scan") → `optimizer` directly.
- "What changed / which PR caused this regression" with a clean onset time → `deploy_blamer` directly.
- Driving a real test booking → `qa_assistant` directly.
- Looking up a table's schema or finding which table holds a concept → `db_access` directly.

Debugger is the front door when the owner is unclear. Once the owner is clear, it hands off — it does not re-implement the specialist.

## Workflow

### 1. Orient from the knowledge base

Read [`knowledge/_index.md`](knowledge/_index.md) first. It has a symptom→subsystem lookup and a one-line scope per file. Match the user's symptom to a subsystem, then read **only** the matched subsystem file(s). Do not preload all of them.

The subsystem file tells you how the area works, what normal vs abnormal looks like, the known failure modes, and which log contexts / tables / code paths / Datadog surfaces to check. It cross-references the schema (`db_access/db-docs/`), the code (genesis), and the glossary — follow those links for detail; the knowledge file does not restate them.

If no subsystem matches, say so and investigate from first principles — then propose a knowledge-base gap at the end (§ 5).

### 2. Form a hypothesis

State the symptom, the subsystem(s) it points at, and the most likely cause(s) from the knowledge file, as a short hypothesis. This drives which evidence to pull. Prefix anything not yet backed by an artefact with `Assumption:` per the constitution.

### 3. Gather evidence

Use whichever sources the hypothesis needs. Load the owning skill's foundations before querying — do not invent connection strings or grep an unsynced clone.

| Source | Tooling | Load first |
|--------|---------|------------|
| MySQL / ClickHouse / MongoDB | `.cursor/skills/db_access/scripts/{mysql,clickhouse,mongo}_query.py` | [`../db_access/SKILL.md`](../db_access/SKILL.md) foundations; for Mongo, [`../db_access/references/mongodb_query_mechanics.md`](../db_access/references/mongodb_query_mechanics.md) |
| genesis application code | `Grep` / `Read` against `$GENESIS_PATH` after sync | [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md) — run `sync_genesis.sh` first, always |
| Datadog (traces, APM, app-logs, error tracking, RUM) | Datadog MCP (`plugin-datadog-datadog` / `project-0-agents_setup-datadog`) | Datadog setup: `~/.cursor/plugins/.../datadog/skills/ddsetup/SKILL.md`; if the server is unresponsive, `ddconfig` |

Query discipline is inherited, not re-invented: bound every SQL / ClickHouse query with a CTE that names the slice once; never run `find {}` on `debug_logs` / `optimizer_logs`; state window and timezone on every number; cite a runnable artefact (query, permalink, file path + line range, MCP response) for every claim. See `db_access` and `bookability` query-discipline sections.

Datadog is the surface the specialists lack. Reach for it when the symptom is a runtime error, latency, an exception with no clean DB row, or a cross-service trace — not when a `debug_logs` context or a MySQL row already answers the question.

### 4. Route to a specialist or investigate directly

Once the evidence points at a known owner, hand off. Read that skill and run its workflow; do not paraphrase it here.

| Evidence points at | Hand off to |
|--------------------|-------------|
| A booking / fare failure, single-booking flow, or bookability rate | [`../bookability/SKILL.md`](../bookability/SKILL.md) |
| Optimizer matching / contestant-forming / tagging | [`../optimizer/SKILL.md`](../optimizer/SKILL.md) |
| A regression with a clean onset time → find the deploy | [`../deploy_blamer/SKILL.md`](../deploy_blamer/SKILL.md) |
| Need a live reproduction on staging / production | [`../qa_assistant/SKILL.md`](../qa_assistant/SKILL.md) |
| A table you cannot identify or that has no doc | [`../db_access/SKILL.md`](../db_access/SKILL.md) |

Investigate directly (no handoff) only when no specialist fits: Datadog-level runtime issues, cross-subsystem correlation, or a novel symptom the knowledge base does not yet cover.

### 5. Report, then propose knowledge-base updates

**Report:** evidence-backed findings, no fixed template. Lead with the answer (what went wrong, or the best-supported hypothesis). Follow the constitution's writing style and glossary — plain business-facing language, internal identifiers only inside runnable `Proof` blocks. Every claim carries an inline artefact. Dump long query output under `reports/` (gitignored), cite the path.

**Maintain (mandatory close-out):** review what the investigation confirmed and surface any *durable, reusable* fact. Propose where each lands and let the user approve before writing. Never write silently.

| Discovery type | Proposed destination |
|----------------|---------------------|
| How a subsystem behaves; a new failure mode; a log context / code path / Datadog dashboard worth checking next time | this skill's `knowledge/<subsystem>.md` (+ bump its `_index.md` scope/last-updated line) |
| A table / column meaning, a per-content-source log hint, a stable enum value | `.cursor/skills/db_access/db-docs/<store>/<table>.md` |
| A new product surface, internal screen, or supplier term | `../../GLOSSARY.md` |
| An analyst-side trap (a cluster that looks like X but is Y) | the specialist's pitfalls file (e.g. `../bookability/references/known_pitfalls.md`) |

Durability bar: propose only facts that will help a *future, different* investigation and that an artefact in this session proves. Skip one-off observations, restatements of existing docs, and anything you could not back with evidence. If nothing durable surfaced, say so — do not manufacture an update.

## Knowledge base

Lives under [`knowledge/`](knowledge/). One file per subsystem plus an index. Content is **behavior and process only** — how the area works, what breaks, where to look. Schemas stay in `db_access/db-docs/`; term definitions stay in `GLOSSARY.md`; code stays in genesis. Knowledge files link to those; they do not copy them.

| File | Scope |
|------|-------|
| [`knowledge/_index.md`](knowledge/_index.md) | Symptom→subsystem lookup + per-file scope and last-updated. Read this first, every time. |
| [`knowledge/booking-flow.md`](knowledge/booking-flow.md) | Checkout → availability → pre-air-booker → book → post-air-booker end-to-end flow and its failure modes. |
| [`knowledge/optimizer.md`](knowledge/optimizer.md) | Repricing / contestant-forming behavior; how the optimizer picks and can reroute a booking. |
| [`knowledge/payments.md`](knowledge/payments.md) | Payhub flow (Verify → 3DS → IssueCard → Sale → CancelCard), virtual cards, statements. |
| [`knowledge/content-sources.md`](knowledge/content-sources.md) | Per-supplier / GDS behavior, offices, marketing-vs-operating carrier, per-source log hints. |
| [`knowledge/search.md`](knowledge/search.md) | Search → results page; which content sources responded; search telemetry. |
| [`knowledge/ticketing.md`](knowledge/ticketing.md) | Ticketer flow, `AirTicketRQ`, session close, statement finalization. |
| [`knowledge/ancillaries.md`](knowledge/ancillaries.md) | Baggage and ancillary optimization behavior. |
| [`knowledge/observability.md`](knowledge/observability.md) | Cross-cutting map of where evidence lives per subsystem — Mongo log contexts, ClickHouse tables, MySQL tables, Datadog services / dashboards. |

The files are **seeded from existing docs and grow via the § 5 maintenance loop**. A thin section is honest, not broken — extend it when an investigation confirms something durable.

## What not to do

- Do not preload every knowledge file. Read `_index.md`, then only the matched subsystem file(s). Loading the whole base defeats the point of partitioning.
- Do not re-implement a specialist's workflow. When the owner is clear, hand off and run their skill.
- Do not claim the front-door role for narrow, already-owned asks (bookability rates, optimizer leak scans, deploy blame with a known window). Route straight to the owner.
- Do not restate schemas, code, or glossary terms inside knowledge files. Link out.
- Do not write knowledge / db-docs / glossary updates silently. Propose, get approval, then write.
- Do not append one-off observations to the knowledge base. The durability bar in § 5 is the gate.
- Do not skip the genesis sync before reading code, or invent DB connection strings. Load the owning skill's foundations first.
- Do not mutate production data. All SQL is `SELECT`; all Mongo is `find` / `aggregate`; Datadog is read-only.

## References

- Knowledge base index: [`knowledge/_index.md`](knowledge/_index.md).
- DB foundations and query CLIs: [`../db_access/SKILL.md`](../db_access/SKILL.md).
- genesis code access: [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- Specialists to hand off to: [`../bookability/SKILL.md`](../bookability/SKILL.md), [`../optimizer/SKILL.md`](../optimizer/SKILL.md), [`../deploy_blamer/SKILL.md`](../deploy_blamer/SKILL.md), [`../qa_assistant/SKILL.md`](../qa_assistant/SKILL.md).
- Constitution + glossary: [`../../../CLAUDE.md`](../../../CLAUDE.md), [`../../../GLOSSARY.md`](../../../GLOSSARY.md).
- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
