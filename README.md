# Agents Setup

AI agents setup for Flighthub employees. Turns common data-investigation work (bookability, optimizer, content integration) into slash commands anyone on the team can run from Cursor or Claude Code.

## How it works

The repo wires three things together:

1. **CLI wrappers** (`scripts/`) — talk to ClickHouse, MySQL (genesis), and MongoDB (ota) using credentials from `.env`.
2. **Table docs** (`db-docs/`) — tell the agent which table / collection holds what, before it writes any query.
3. **Skills** (`.cursor/skills/<name>/SKILL.md`, exposed as slash commands via `.claude/commands/`) — encode the investigation recipes: which tables to join, which filters to apply, how to classify results, what format to return.

Invoke a slash command. The agent reads the matching `SKILL.md`, runs its steps, queries via the CLIs, and writes output (reports, findings, Trello cards, table docs) back into the repo.

## Skills

- **`/bookability_analysis`** — why a fare or booking is not bookable; failure rates per content source / carrier / office; full flow trace for a `booking_id` / `search_hash`.
- **`/optimizer_analysis`** — audit Optimizer matching: why a fare was missed or mistagged, per-attempt / per-search / per-booking drill-downs, content-source-wide leak scans.
- **`/content_integration_reporter`** — proactive scan of all content sources for recent issues, with provider-side / our-side classification and log permalinks.
- **`/document_table`** — inspect a table or collection and save its purpose, schema, and gotchas under `db-docs/`.
- **`/explore_tables`** — find which table or collection holds the data you need when `db-docs/` does not cover it.
- **`/trello_content_integration`** — create or update cards on the Content Integration Trello board.

Full agent contract: `CLAUDE.md`. Detailed workflow: each skill's `SKILL.md`.

## Repo layout

```text
.claude/commands/   # Slash-command wrappers (e.g. /optimizer_analysis)
.cursor/
├── rules/          # Global rules (db access, writing style, mongo hygiene)
└── skills/         # Per-skill folders, each with a SKILL.md
scripts/
├── clickhouse_query.py   # ClickHouse CLI
├── mysql_query.py        # MySQL CLI
├── mongo_query.py        # MongoDB CLI (collections / describe / find / aggregate)
└── sync_genesis.sh       # Optional pull of the genesis codebase
db-docs/
├── clickhouse/     # Documented CH tables
├── mysql/          # Documented MySQL tables
└── mongodb/        # Documented Mongo collections
reports/            # Ephemeral output from skills (gitignored)
CLAUDE.md           # Agent rules + skill routing
requirements.txt    # clickhouse-connect, pymysql, pymongo
```

## Setup

1. **Clone and install Python deps** (Python 3.10+):

   ```bash
   git clone <this-repo>
   cd bookability_agent_setup
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Create `.env`** at the repo root. `.env` is gitignored. Never commit it.

   ```bash
   # ClickHouse (Phoenix analytics)
   CLICKHOUSE_HOST=<host>
   CLICKHOUSE_PORT=<port>
   CLICKHOUSE_USER=<user>
   CLICKHOUSE_PASSWORD=<password>
   CLICKHOUSE_DATABASE=default

   # MySQL (genesis / ota)
   MYSQL_HOST=<host>
   MYSQL_PORT=<port>
   MYSQL_USER=<user>
   MYSQL_PASSWORD=<password>
   MYSQL_DATABASE=ota

   # MongoDB (debug_logs / optimizer_logs)
   MONGODB_URI=mongodb://<host>:27017/
   MONGODB_DATABASE=ota

   # Optional: local genesis checkout for code-aware questions
   GENESIS_PATH=/absolute/path/to/genesis
   ```

3. **Load `.env` before running any CLI.** Every script reads credentials from environment variables. Export them first:

   ```bash
   set -a && source .env && set +a
   ```

## Quick connection test

```bash
set -a && source .env && set +a

python3 scripts/clickhouse_query.py query "SELECT 1"
python3 scripts/mysql_query.py      query "SELECT 1"
python3 scripts/mongo_query.py      collections ota
```

If all three print results, the setup is ready.
