# Responding to TODOs / direct requests on an existing card

When the card description or user leaves a TODO (e.g. `TODO: Write a query to verify this`) or asks for a specific artefact on an existing card, deliver exactly that — no more.

## Rules

- "Write a query" → the reply is the query. Paste query output only when the TODO explicitly asks for numbers or examples.
- Do not expand into a verification essay. No multi-section narratives, runbook prose, dev-work notes, code-path pointers, affiliate / content-source provenance, multi-week trend tables, architectural clarifications, glossary reminders — unless the TODO explicitly asks.
- One short lead sentence naming the slice (window, filter) is fine. The rest is the artefact and, when asked, a small result sample.
- If you notice something important outside the ask, mention it in one line at the end (`Side note: …`). Never grow it into another section.
- Same rule for comments and description updates: match the scope of the ask, not the breadth of your investigation.

## Confirm the data grain before querying

The card title prefix (`OPTIMIZER:`, `BOOKABILITY:`, `PAYHUB:` …) reflects product area, not data grain. Do not let it steer the table choice.

For multi-ticket "find the combination of CARRIER_A + CARRIER_B" TODOs the grain is `ota.bookability_contestant_attempts` (master/slave self-joined on `search_hash`) even on `OPTIMIZER:`-titled cards — several low-cost carriers (e.g. Flair / F8) do not surface in `optimizer_candidates` the same way, and optimizer-side queries silently return zero. See [`../../bookability/SKILL.md#multi-ticket-pair-audits`](../../bookability/SKILL.md#multi-ticket-pair-audits). Treat it as the default starting point for these TODOs.

## Query structure still applies

Aggregation or example queries on a card — even single-line TODO replies — follow the debuggable-CTE / leading-`$match` rule from [`card_anatomy.md`](card_anatomy.md#query-structure--always-debuggable-mandatory). The slice lives in one named place; the outer statement is swappable between count and examples without re-validating the filter. Never ship two separately-filtered queries (one for counts, one for examples) on a card.
