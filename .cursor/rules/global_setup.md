---
description: "Shared project context — customize the WORKSTREAM block; keep repo-wide data and tooling sections accurate."
alwaysApply: true
---

# Project context blueprint

Use this file in two ways: (1) keep **Shared repo standards** up to date for every task; (2) edit the **Active workstream** block below (or maintain separate rule files per workstream with `alwaysApply: false` and `globs` / manual inclusion).

If the workstream table still contains placeholder brackets, infer intent from the user’s message; when unclear, ask which workstream applies and still follow **Shared repo standards**.

---

## Active workstream — CUSTOMIZE

Replace the bracketed fields. Duplicate this entire section into another rule file (e.g. `.cursor/rules/meta_analyst.md`) when a workstream needs its own `globs` or should not always apply.

| Field | Value |
|--------|--------|
| **Team / product** | `[e.g. Metasearch, Search platform, Bookability]` |
| **Mission** | `[One sentence: what “good” looks like for this workstream]` |
| **Primary questions** | `[e.g. revenue vs cost, result quality, conversion, defect rate]` |
| **KPIs / definitions** | `[Link to doc or bullet definitions — revenue, bookings, error rate, latency, etc.]` |
| **Business framing** | `[Always tie findings to: impact, tradeoffs, owners, next steps]` |

### Domain specifics (optional subsections)

Add only what this workstream needs. Remove unused headings.

**Economics / costing (if relevant)**  
`[e.g. CPC vs CPA, FX, margin — link to internal rate cards or tables]`

**Segmentation rules (if relevant)**  
`[e.g. markets = currencies, device, route type — never cross-convert unless explicitly documented]`

**IDs, enums, mappings (if relevant)**  
`[e.g. affiliate IDs, partners, feature flags — table format]`

**Workstream-specific SQL or metric rules**  
`[e.g. issuance averages, booking filters, dedupe keys — paste expressions here]`

---

## Shared repo standards

### Database access

**ClickHouse** — always use the repo CLI (loads credentials from `.env`):

```bash
set -a && source .env && set +a && python3 scripts/clickhouse_query.py query "SELECT ..."
```

**MySQL (genesis)** — same pattern:

```bash
set -a && source .env && set +a && python3 scripts/mysql_query.py query "SELECT ..."
```

**MongoDB** — URI from `.env` (`MONGODB_URI`); use `collections`, `describe`, `find`, or `aggregate` (not SQL):

```bash
set -a && source .env && set +a && python3 scripts/mongo_query.py collections [database]
set -a && source .env && set +a && python3 scripts/mongo_query.py find <collection> [database] --sort '{"created_at": -1}' --limit 50
```

Do not invent connection strings; use these scripts unless the user explicitly points elsewhere.

### Query hygiene (baseline)

- Prefer filters and grain that match how the business segments data (market, channel, device, etc.) — use the **Active workstream** section for definitions.
- Document or reuse existing expressions for rates, counts, and deduplication; do not silently change denominators between queries.
- When comparing time periods, state the window and timezone assumptions.

### Git commits

Do not add editor or tool attribution trailers to commits — in particular never use `--trailer "Made-with: Cursor"` (or any similar `Made-with:` / co-authored trailer for tools). Use a normal message only unless the user explicitly asks for attribution.

### Table documentation

Before relying on a table, check **`db-docs/`** (by engine):

- `db-docs/clickhouse/` — tables accessed via `scripts/clickhouse_query.py`
- `db-docs/mysql/` — tables accessed via `scripts/mysql_query.py`
- `db-docs/mongodb/` — collections accessed via `scripts/mongo_query.py`

If a table is not documented yet, say so and offer to add docs using the **document-table** skill (see project skills under `.cursor/skills/`) and the template in `db-docs/README.md`.

### Skills and reusable workflows

This repo is a shared toolkit. After finishing an analysis that could repeat, offer to capture it as a skill (naming: **`{workstream-prefix}:{kebab-case-name}`**, e.g. `meta-analyst:channel-performance`, `search-health:latency-regression`).

Use existing skills when the user’s request matches their descriptions (analyze, document-table, explore tables, etc.).

### Project structure (reference)

```text
scripts/
├── clickhouse_query.py    # ClickHouse CLI
├── mysql_query.py         # MySQL (genesis) CLI
├── mongo_query.py         # MongoDB CLI
├── sync_genesis.sh        # Optional: pull genesis before codebase-memory use
└── …                      # Domain-specific scripts (e.g. kayak/, checks/)
db-docs/
├── clickhouse/
├── mysql/
└── mongodb/
reports/                   # Ephemeral output (gitignored)
```

---

## Optional extensions (enable when your setup uses them)

### Local application codebase (genesis)

If questions involve application code: `GENESIS_PATH` in `.env` should point at the local clone. If it is missing on first use, ask the user for the path and add it to `.env`.

When using **codebase-memory-mcp** (or similar): follow that tool’s workflow (sync, `detect_changes`, re-index) so answers reflect current code. A hook or script may run `scripts/sync_genesis.sh` before queries — do not assume the index is fresh without checking.

**Trigger:** phrases like “codebase”, “check code”, “where is X implemented” should prefer the graph / MCP tools over blind grep when the server is available.

### Third-party editor plugins

Optional; suggest only during setup. Examples: workflow plugins, session notes plugins — install and `/reload-plugins` per product docs.

---

## Example: filled workstream (metasearch / “Meta-Analyst”)

Use this as a pattern for how much detail to add under **Active workstream** — not as default unless this rule is duplicated for that team.

| Field | Example |
|--------|--------|
| **Team / product** | Flighthub Metasearch — gross profit from affiliate metasearch |
| **Mission** | Grow gross profit (revenue minus click cost) with sustainable competitiveness |
| **Business framing** | Revenue impact, competitive position, margin, actionable next steps |

**Economics (example):** Gross profit = revenue − click cost; model CPC/CPA per partner; use billed tables where they exist, otherwise rate cards.

**SQL notes (example):** Market = currency (no cross-convert); guarded averages for rates; booking counts with agreed `multiticket_relationship` filter and issuance / revenue issuance multipliers per metric.

**IDs (example):** Maintain affiliate ID tables in the workstream rule, not in the shared baseline.

---

_End of blueprint. Customize **Active workstream**; keep **Shared repo standards** aligned with this repository._
