# Project Setup

## Writing style

Follow `.cursor/rules/global_setup.md` § Writing style for every output: plain, direct, concise. No pleasantries, no filler. Cut anything that does not change the reader's next action.

## Database access

Use the repo CLIs. They load credentials from `.env`. Do not invent connection strings.

**ClickHouse:**

```bash
set -a && source .env && set +a && python3 scripts/clickhouse_query.py query "SELECT ..."
```

**MySQL (genesis):**

```bash
set -a && source .env && set +a && python3 scripts/mysql_query.py query "SELECT ..."
```

**MongoDB** — URI from `.env` (`MONGODB_URI`). Use `collections`, `describe`, `find`, `aggregate`. No SQL.

```bash
set -a && source .env && set +a && python3 scripts/mongo_query.py collections [database]
set -a && source .env && set +a && python3 scripts/mongo_query.py find <collection> [database] --sort '{"created_at": -1}' --limit 50
```

For query hygiene on `ota.debug_logs` and `ota.optimizer_logs` (collection choice, `transaction_id` / `context` / `Response` filters, why the CLI rejects `ISODate(...)`, when to switch to mongosh / Compass / `pymongo`), read `.cursor/rules/mongodb.md`. For bookability Mongo patterns (supplier evidence hierarchy, permalink harvest), see `.cursor/skills/bookability_analysis/`.

### Query rules

- Filter and group data the way the business does: dates, content sources, airlines, etc.
- Reuse existing expressions for rates, counts, and dedup. Do not change denominators between queries.
- When comparing time periods, state the window and timezone.

### Table documentation

Check `db-docs/` before using a table:

- `db-docs/clickhouse/` — ClickHouse tables
- `db-docs/mysql/` — MySQL tables
- `db-docs/mongodb/` — MongoDB collections

If a table is not documented, say so. Offer to add docs using the `/table_analysis` skill and the template in `db-docs/README.md`.

### Skill routing

Slash commands load each skill (e.g. `/bookability_analysis`). Full rules live in each `SKILL.md`.


| Skill                   | Pick when                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/bookability_analysis` | Bookability: failure rates for a content source / carrier / office, single booking flow (`booking_id` / `search_hash` → what went wrong), deep or similar-errors analysis.                                                       |
| `/optimizer_analysis`   | Optimizer: why a fare was missed or mistagged, per-attempt / per-search / per-booking drill-down, matching audit across a content source (MySQL `optimizer_candidates` + `optimizer_attempts` ↔ MongoDB `optimizer_logs.fares`). |
| `/qa_automation`        | Driving a real test booking on FlightHub / JustFly staging and validating it across MySQL / ClickHouse / MongoDB (`qa-search` → `qa-search-telemetry` → `qa-book` → `qa-validate` → `qa-cleanup`).                               |
| `/table_analysis`       | User names a table or collection and wants its purpose, columns, or docs under `db-docs/`, **or** needs data but no `db-docs/` entry fits ("which table has…", "find table", etc.).                                              |
| `/trello_assistant`     | Creating or updating cards on the Content Integration Trello board (backlog for GDS / content sources, bookability, optimizer, payhub).                                                                                          |


### Skills layout

- **General rules** go in `.cursor/rules/` and this `CLAUDE.md`. Use for anything that applies to every session: database access, query rules, git, cross-cutting behavior.
- **Skill content** goes in `.cursor/skills/<skill_name>/`. Entry point is `SKILL.md`. `.claude/commands/<skill_name>.md` is a thin wrapper that loads the skill.
- **Adding or changing a skill:** edit files in `.cursor/skills/<skill_name>/`, update the routing table above, and add or update `.claude/commands/<skill_name>.md`.

### Project structure

```text
.claude/
└── commands/              # Claude Code slash commands — thin wrappers loading .cursor/skills/

.cursor/
├── rules/                 # General rules (global_setup.md, mongodb.md)
└── skills/                # Per-skill folders: <name>/SKILL.md + supporting files

scripts/
├── clickhouse_query.py    # ClickHouse CLI
├── mysql_query.py         # MySQL CLI
├── mongo_query.py         # MongoDB CLI
├── sync_genesis.sh        # Optional: pull genesis before codebase-memory use

db-docs/
├── clickhouse/
├── mysql/
└── mongodb/
reports/                   # Ephemeral output (gitignored)
```

---

## Optional extensions

### Local application codebase (genesis)

For questions about application code, `GENESIS_PATH` in `.env` must point to the local clone. If missing, ask the user for the path and add it to `.env`.

## Git commits

Do not add editor or tool attribution trailers. Never use `--trailer "Made-with: Cursor"` or any `Made-with:` / co-authored trailer for tools.