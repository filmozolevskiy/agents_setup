# Agents Setup

AI agents setup for Flighthub employees. Turns common data-investigation work (bookability, optimizer, content integration) into slash commands anyone on the team can run from Cursor or Claude Code.

## How it works

The repo wires three things together:

1. **CLI wrappers** (`.cursor/skills/db_access/scripts/`) — talk to ClickHouse, MySQL (genesis), and MongoDB (ota) using credentials from `.env`.
2. **Table docs** (`.cursor/skills/db_access/db-docs/`) — tell the agent which table / collection holds what, before it writes any query.
3. **Skills** (`.cursor/skills/<name>/SKILL.md`, exposed as slash commands via `.claude/commands/`) — encode the investigation recipes: which tables to join, which filters to apply, how to classify results, what format to return.

Invoke a slash command. The agent reads the matching `SKILL.md`, runs its steps, queries via the CLIs, and writes output (reports, findings, Trello cards, table docs) back into the repo.

## Skills

- **`/bookability_analysis`** — why a fare or booking is not bookable; failure rates per content source / carrier / office; full flow trace for a `booking_id` / `search_hash`.
- **`/optimizer_analysis`** — audit Optimizer matching: why a fare was missed or mistagged, per-attempt / per-search / per-booking drill-downs, content-source-wide leak scans.
- **`/qa_assistant`** — drive a real test booking on FlightHub / JustFly staging and validate it across MySQL / ClickHouse / MongoDB (`qa-search` → `qa-search-telemetry` → `qa-book` → `qa-validate` → `qa-cleanup`).
- **`/db_access`** — find which table or collection holds the data you need (when `.cursor/skills/db_access/db-docs/` does not cover it) and / or save its purpose, schema, and gotchas under `.cursor/skills/db_access/db-docs/`.
- **`/skill_creator`** — scaffold a new project-local skill (SKILL.md + `.claude/commands/<name>.md` wrapper + Skills Index rows in `CLAUDE.md` and `.cursor/rules/rules.mdc`); ships a `lint_skill.py` validator that flags missing wrappers and broken frontmatter.
- **`/trello_assistant`** — create or update cards on the Content Integration Trello board.

Full agent contract: `CLAUDE.md`. Detailed workflow: each skill's `SKILL.md`.

## Repo layout

```text
.claude/commands/   # Slash-command wrappers (e.g. /optimizer_analysis)
.cursor/
├── rules/          # Global rules (db access, writing style, mongo hygiene)
└── skills/         # Per-skill folders, each with a SKILL.md
.cursor/skills/db_access/scripts/
├── clickhouse_query.py   # ClickHouse CLI
├── mysql_query.py        # MySQL CLI
└── mongo_query.py        # MongoDB CLI (collections / describe / find / aggregate)
.cursor/skills/codebase_access/
├── SKILL.md
├── scripts/sync_genesis.sh   # Fast-forwards the local genesis clone before any code read
└── codebase/                  # Default genesis checkout (gitignored)
.cursor/skills/qa_assistant/legacy_python/   # Playwright-backed QA runners (qa-search, qa-book, qa-validate, …); cd here + uv sync
.cursor/skills/db_access/db-docs/
├── clickhouse/     # Documented CH tables
├── mysql/          # Documented MySQL tables
└── mongodb/        # Documented Mongo collections
reports/            # Ephemeral output from skills (gitignored)
CLAUDE.md           # Agent rules + skill routing
.env.example        # Template for the gitignored .env (copy and fill in)
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
2. **Create `.env`** at the repo root by copying the template. `.env` is gitignored. Never commit it.
  ```bash
   cp .env.example .env
  ```
   Then fill in real values. `.env.example` lists every variable the repo reads, grouped by area (ClickHouse, MySQL, MongoDB, optional genesis path, QA automation). Only the database blocks are required for the core skills; the QA section is only needed for `/qa_assistant`.
3. **Load `.env` before running any CLI.** Every script reads credentials from environment variables. Export them first:
  ```bash
   set -a && source .env && set +a
  ```

## MCP servers

Some skills talk to external services through MCP (Model Context Protocol) servers. Only one is required today; the rest are optional and only matter if you want the agent to reach those products directly.


| MCP                                                | Used by                     | Required            | What it does                                                         |
| -------------------------------------------------- | --------------------------- | ------------------- | -------------------------------------------------------------------- |
| **Trello** (`@delorenj/mcp-server-trello`)         | `/trello_assistant`         | Yes, for that skill | Read/create/update cards on the Content Integration board.           |
| **ClickHouse** (`mcp-clickhouse`, repo-local)      | Ad-hoc CH queries           | Optional            | `run_query`, `list_databases`, `list_tables` against phoenix-db.     |
| **Looker** (`genai-toolbox --prebuilt looker`, repo-local) | Ad-hoc Looker work  | Optional            | List models / Explores / dimensions, run queries, run saved Looks.   |
| **GitHub** (`@modelcontextprotocol/server-github`) | Ad-hoc (PR / issue lookups) | Optional            | Read repos, PRs, issues when a skill or question needs code context. |
| **Atlassian** (`https://mcp.atlassian.com/v1/mcp`) | Ad-hoc (Jira / Confluence)  | Optional            | Query Jira tickets and Confluence pages.                             |
| **Lucid** (`https://mcp.lucid.app/mcp`)            | Ad-hoc (diagrams)           | Optional            | Read Lucidchart diagrams referenced in tickets.                      |


No skill in this repo requires GitHub, Atlassian, Lucid, ClickHouse-MCP, or Looker — add them only if you want them available to the agent generally. The repo-level `.cursor/mcp.json` already wires up ClickHouse and Looker for everyone who clones the repo (see [Repo-local MCPs (ClickHouse, Looker)](#repo-local-mcps-clickhouse-looker) below).

### Get credentials

- **Trello:** log in, then grab `TRELLO_API_KEY` and `TRELLO_TOKEN` from [trello.com/power-ups/admin](https://trello.com/power-ups/admin) → your app → *API Key* → *Token*. The token needs read + write on the Content Integration board.
- **GitHub:** create a fine-grained personal access token at [github.com/settings/tokens](https://github.com/settings/tokens) with `repo` + `read:org`.
- **Atlassian / Lucid:** remote MCP endpoints, no token in the config — you authenticate in-browser on first use.

### Configure in Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json` (user-level, applies to every project). Create or edit that file:

```json
{
  "mcpServers": {
    "trello": {
      "command": "npx",
      "args": ["-y", "@delorenj/mcp-server-trello"],
      "env": {
        "TRELLO_API_KEY": "<your key>",
        "TRELLO_TOKEN": "<your token>"
      }
    },
    "GitHub": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "<your token>"
      }
    },
    "Atlassian-MCP-Server": { "url": "https://mcp.atlassian.com/v1/mcp" },
    "Lucid":                { "url": "https://mcp.lucid.app/mcp" }
  }
}
```

Keep only the entries you want. Restart Cursor after editing. If `npx` is not on Cursor's `PATH`, point `command` at an absolute path (e.g. `/usr/local/bin/npx`) and add `"PATH": "..."` under `env`.

### Configure in Claude Code

Claude Code reads `.mcp.json` at the repo root (project-level, shareable) and/or `~/.claude.json` (user-level). Same schema as above. Do **not** commit tokens — put real values in the user-level file, or use env vars:

```json
{
  "mcpServers": {
    "trello": {
      "command": "npx",
      "args": ["-y", "@delorenj/mcp-server-trello"],
      "env": {
        "TRELLO_API_KEY": "${TRELLO_API_KEY}",
        "TRELLO_TOKEN":  "${TRELLO_TOKEN}"
      }
    }
  }
}
```

### Verify

In Cursor: open the MCP panel (Settings → MCP) and confirm each server shows *Connected*. In Claude Code: run `/mcp` in a session and check the server list. For Trello specifically, ask the agent to `set_active_board 61d5cf784c6396541499e7ce` and `get_lists` — if that returns the Content Integration lists, the MCP is wired up.

### Repo-local MCPs (ClickHouse, Looker)

Two MCP servers are wired up at the repo level via `.cursor/mcp.json`, so anyone who opens the repo in Cursor gets them automatically. Both read credentials from the repo `.env` (gitignored) through small wrapper scripts that live alongside the skill that owns each MCP:

- `.cursor/skills/db_access/scripts/mcp_clickhouse.sh` → [`mcp-clickhouse`](https://github.com/ClickHouse/mcp-clickhouse) launched via `uvx`. Tools: `run_query`, `list_databases`, `list_tables`. Reads `CLICKHOUSE_HOST`/`PORT`/`USER`/`PASSWORD`/`DATABASE` from `.env`; defaults `CLICKHOUSE_SECURE` based on the port.
- `.cursor/skills/looker/scripts/mcp_looker.sh` → Google [`genai-toolbox`](https://googleapis.github.io/genai-toolbox/) `--prebuilt looker`. Tools: `get_models` / `get_explores` / `get_dimensions` / `get_measures` / `query` / `query_sql` / `run_look` / etc. Reads `LOOKER_BASE_URL`/`LOOKER_CLIENT_ID`/`LOOKER_CLIENT_SECRET`/`LOOKER_VERIFY_SSL` from `.env`.

One-time install (downloads the toolbox binary into `bin/`, which is gitignored):

```bash
./.cursor/skills/looker/scripts/install_mcp_toolbox.sh
uvx --from mcp-clickhouse mcp-clickhouse --help  # warms the uvx cache (optional)
```

Then add the credentials your wrappers need to `.env` (Looker keys; ClickHouse keys are already there if the CLI works) and restart Cursor.

Why these are MCP servers in addition to the existing CLIs (`scripts/clickhouse_query.py` etc.): the CLIs stay the canonical path for queries that get pasted onto Trello cards (the cards need raw SQL, not MCP tool calls). The MCPs save a step when the agent is iterating on schema discovery or wants to chain a few exploratory queries without shelling out each time. Use whichever fits.

## Quick connection test

```bash
set -a && source .env && set +a

python3 .cursor/skills/db_access/scripts/clickhouse_query.py query "SELECT 1"
python3 .cursor/skills/db_access/scripts/mysql_query.py      query "SELECT 1"
python3 .cursor/skills/db_access/scripts/mongo_query.py      collections ota
```

If all three print results, the setup is ready.