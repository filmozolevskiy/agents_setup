# Project Setup

## Database access

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

For **query hygiene** on `ota.debug_logs` / `ota.optimizer_logs` (collection choice, `transaction_id` /
`context` / `Response` filtering, why the CLI rejects `ISODate(...)`, when to switch to mongosh /
Compass / `pymongo`), read **`.cursor/rules/mongodb.md`**. For **bookability-specific** Mongo patterns
(supplier evidence hierarchy, permalink harvest), see **`.cursor/skills/bookability_analysis/`**.

Do not invent connection strings; use these scripts unless the user explicitly points elsewhere.


### Query hygiene (baseline)

- Prefer filters and grain that match how the business segments data (dates, content sources, airlines, etc.)
- Document or reuse existing expressions for rates, counts, and deduplication; do not silently change denominators between queries.
- When comparing time periods, state the window and timezone assumptions.


### Table documentation

Before relying on a table, check **`db-docs/`** (by engine):

- `db-docs/clickhouse/` — tables accessed via `scripts/clickhouse_query.py`
- `db-docs/mysql/` — tables accessed via `scripts/mysql_query.py`
- `db-docs/mongodb/` — collections accessed via `scripts/mongo_query.py`

If a table is not documented yet, say so and offer to add docs using the **`/document_table`** skill and the template in `db-docs/README.md`.


### Skill routing reference

Invoke these as slash commands (e.g. `/bookability_analysis`). Full instructions live in each skill's `SKILL.md`.

| Skill | Pick when |
|-------|-----------|
| `/bookability_analysis` | Bookability questions — failure rates for a content source / carrier / office, single-booking flow (`booking_id` / `search_hash` → "what went wrong"), deep / similar-errors analysis. |
| `/document_table` | User names a table or collection and wants its purpose, columns, or docs under `db-docs/`. |
| `/explore_tables` | User needs data but no `db-docs/` entry covers the right table or collection ("which table has…", "find table", etc.). |
| `/trello_content_integration` | Creating or updating cards on the **Content Integration** Trello board (backlog tickets for GDS / content sources, bookability, optimizer, payhub). |


### Skills — layout, use, and changes

**Where general rules live** — Repo-wide policies (database access, query hygiene, cross-cutting agent behavior) belong in **`.cursor/rules/`** and this `CLAUDE.md`. Edit here when guidance applies regardless of which skill is in play.

**Where skill content lives** — Each skill has its own directory under **`.cursor/skills/<skill_name>/`**. The entry point is **`SKILL.md`**. Keep everything skill-specific there. The `.claude/commands/<skill_name>.md` files are thin wrappers that load the skill.

**Adding or modifying skills** — Create or update **`.cursor/skills/<skill_name>/`**, update the routing table above, and add a corresponding `.claude/commands/<skill_name>.md`.


### Project structure (reference)

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

If questions involve application code: `GENESIS_PATH` in `.env` should point at the local clone. If it is missing on first use, ask the user for the path and add it to `.env`.

## Git commits

Do not add editor or tool attribution trailers to commits — in particular never use `--trailer "Made-with: Cursor"` or any similar `Made-with:` / co-authored trailer for tools.
