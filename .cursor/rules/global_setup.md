---
description: "Shared project context — customize the WORKSTREAM block; keep repo-wide data and tooling sections accurate."
alwaysApply: true
---

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

The CLI accepts **JSON only**—no BSON dates in pipeline strings. For time-bounded aggregations on large
collections (e.g. `ota.debug_logs`), use **mongosh**, **Compass**, or **Python + pymongo** with
`datetime` after sourcing `.env`. Prefer **`date_added` bounds**, **exact `context`** when known, and
match supplier text on the right field (often **`Response`** for Downtowntravel book logs)—details in
`.cursor/skills/bookability_analysis/SKILL.md` (section *Effective queries on debug_logs*).

Do not invent connection strings; use these scripts unless the user explicitly points elsewhere.


### Query hygiene (baseline)

- Prefer filters and grain that match how the business segments data (dates, content sorces, airlines, etc.)
- Document or reuse existing expressions for rates, counts, and deduplication; do not silently change denominators between queries.
- When comparing time periods, state the window and timezone assumptions.


### Table documentation

Before relying on a table, check **`db-docs/`** (by engine):

- `db-docs/clickhouse/` — tables accessed via `scripts/clickhouse_query.py`
- `db-docs/mysql/` — tables accessed via `scripts/mysql_query.py`
- `db-docs/mongodb/` — collections accessed via `scripts/mongo_query.py`

If a table is not documented yet, say so and offer to add docs using the **document_table** skill (see `.cursor/skills/document_table/`) and the template in `db-docs/README.md`.


### Skill routing reference
When you add a skill folder or change behavior, update **this table** and the skill’s **`SKILL.md`** together.

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **`document_table`** | “Document” a table or collection; “what does this table do”; add something to **db-docs/**; user names a table/collection and wants purpose, structure, or docs (even without saying “document”). | Inspect ClickHouse / MySQL / MongoDB via `scripts/clickhouse_query.py`, `scripts/mysql_query.py`, `scripts/mongo_query.py`; infer purpose; write docs under **`db-docs/clickhouse/`**, **`db-docs/mysql/`**, or **`db-docs/mongodb/`** (see **`db-docs/README.md`**). Folder: **`.cursor/skills/document_table/`**. |
| **`explore_tables`** | “Which table has…”, “find table”, “explore tables”, “check database”, “search database”, “what table stores…”; need data but **db-docs/** does not cover the right object. (Hosts may also invoke this when generic analysis cannot match a documented table.) | Search ClickHouse, MySQL, and MongoDB schemas; present candidates; document chosen tables/collections into **db-docs/** for reuse; then continue analysis. Folder: **`.cursor/skills/explore_tables/`**. |
| **`trello_content_integration`** | Creating or updating Trello on **Content Integration**; backlog tickets for GDS/content sources, bookability, optimizer, payhub; user says “Trello”, “CI board”, or “file a card”. | Use **user-trello** MCP; **before create**: scan open lists for duplicate/similar cards (`get_lists` + `get_cards_by_list_id`, then `get_card` on candidates); avoid duplicate tickets, link similar ones in the description; **Backlog** only for new cards; titles `SOURCE: summary`; ⊙ bug vs ⊙ need templates; mandatory fields + AI footer. Folder: **`.cursor/skills/trello_content_integration/`**. |

### Skills — layout, use, and changes

**Where general rules live** — Repo-wide policies (database access, query hygiene, git conventions, cross-cutting agent behavior) belong in **`.cursor/rules/`**. Add or edit rules there when the guidance applies regardless of which skill is in play.

**Where skill content lives** — Each skill has its own directory under **`.cursor/skills/<skill_name>/`**. The agent entry point is **`SKILL.md`**. Keep everything that explains *how* to run that workflow—steps, checklists, examples, query or output conventions—in that folder: extra markdown, snippets, templates, or reference files next to `SKILL.md`. Do not spread skill-specific instructions across unrelated paths.

**Using skills** — When the user’s task matches a skill’s description, read and follow **`SKILL.md`** first; open sibling files in the same folder only when `SKILL.md` points to them.

**Adding or modifying skills** — Create or update **`.cursor/skills/<skill_name>/`**, change **`SKILL.md`**, and add or edit supporting files in that same directory and modify the skill routing reference in `.cursor/rules/global_setup.md`. If new guidance applies to every session, put it in **`.cursor/rules/`** instead of duplicating it inside every skill.

### Project structure (reference)

```text
.cursor/
├── rules/                 # General rules (e.g. global_setup.md)
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

Do not add editor or tool attribution trailers to commits — in particular never use `--trailer "Made-with: Cursor"` (or any similar `Made-with:` / co-authored trailer for tools).