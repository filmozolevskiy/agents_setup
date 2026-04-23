---
description: "Shared project context. Keep data and tooling sections accurate."
alwaysApply: true
---

## Writing style

Applies to every agent output: chat replies, reports, docs, skill files, comments.

- Plain language. No jargon unless needed. If a technical term is needed, use it without apology.
- Short sentences. One idea per sentence.
- Direct. State the fact or the instruction. No hedging, no filler, no pleasantries.
- No "I'll now", "Let me", "Sure", "Great", "Happy to", "I hope this helps", "Feel free to".
- Cut adjectives and adverbs that do not change meaning ("simply", "just", "actually", "really", "basically").
- Prefer imperatives over descriptions: "Run X" over "You can run X" or "It's a good idea to run X".
- Lead with the answer. Put context after, only if needed.
- No restating the user's question. No recapping what was already said.
- Drop every sentence that does not change the reader's next action or understanding.

Apply the same rules when editing existing files. When in doubt, cut.


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

For query hygiene on `ota.debug_logs` and `ota.optimizer_logs` (collection choice, `transaction_id` / `context` / `Response` filters, why the CLI rejects `ISODate(...)`, when to switch to mongosh / Compass / `pymongo`), load `.cursor/rules/mongodb.md`. For bookability Mongo patterns (supplier evidence hierarchy, permalink harvest), see `.cursor/skills/bookability_analysis/`.


### Query rules

- Filter and group data the way the business does: dates, content sources, airlines, etc.
- Reuse existing expressions for rates, counts, and dedup. Do not change denominators between queries.
- When comparing time periods, state the window and timezone.


### Table documentation

Check `db-docs/` before using a table:

- `db-docs/clickhouse/` — ClickHouse tables
- `db-docs/mysql/` — MySQL tables
- `db-docs/mongodb/` — MongoDB collections

If a table is not documented, say so. Offer to add docs using the `document_table` skill (`.cursor/skills/document_table/`) and the template in `db-docs/README.md`.


### Skill routing

Pick the skill that matches the task. Full rules live in each `SKILL.md`. When you add or rename a skill, update this table and the `SKILL.md` together.

| Skill | Pick when |
|-------|-----------|
| [`bookability_analysis`](../skills/bookability_analysis/SKILL.md) | Bookability questions: failure rates for a content source / carrier / office, single booking flow (`booking_id` / `search_hash` → what went wrong), deep or similar-errors analysis. |
| [`document_table`](../skills/document_table/SKILL.md) | User names a table or collection and wants its purpose, columns, or docs under `db-docs/`. |
| [`explore_tables`](../skills/explore_tables/SKILL.md) | User needs data but no `db-docs/` entry fits ("which table has…", "find table", etc.). |
| [`trello_content_integration`](../skills/trello_content_integration/SKILL.md) | Creating or updating cards on the Content Integration Trello board (backlog for GDS / content sources, bookability, optimizer, payhub). |

### Skills layout

- **General rules** go in `.cursor/rules/`. Use for anything that applies to every session: database access, query rules, git, cross-cutting behavior.
- **Skill content** goes in `.cursor/skills/<skill_name>/`. Entry point is `SKILL.md`. Put all steps, checklists, examples, and reference files in that folder. Do not scatter skill files elsewhere.
- **Using a skill:** read `SKILL.md` first. Open sibling files only when `SKILL.md` points to them.
- **Adding or changing a skill:** edit files in `.cursor/skills/<skill_name>/` and update the skill routing table above. If the guidance applies to every session, put it in `.cursor/rules/` instead.

### Project structure

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

For questions about application code, `GENESIS_PATH` in `.env` must point to the local clone. If missing, ask the user for the path and add it to `.env`.

## Git commits

Do not add editor or tool attribution trailers. Never use `--trailer "Made-with: Cursor"` or any `Made-with:` / co-authored trailer for tools.
