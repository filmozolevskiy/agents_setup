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
- **`/qa_automation`** — drive a real test booking on FlightHub / JustFly staging and validate it across MySQL / ClickHouse / MongoDB (`qa-search` → `qa-search-telemetry` → `qa-book` → `qa-validate` → `qa-cleanup`).
- **`/table_analysis`** — find which table or collection holds the data you need (when `db-docs/` does not cover it) and / or save its purpose, schema, and gotchas under `db-docs/`.
- **`/trello_assistant`** — create or update cards on the Content Integration Trello board.

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
qa_automation/      # Playwright-backed QA runners (qa-search, qa-book, qa-validate, …)
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

## MCP servers

Some skills talk to external services through MCP (Model Context Protocol) servers. Only one is required today; the rest are optional and only matter if you want the agent to reach those products directly.


| MCP                                                | Used by                     | Required            | What it does                                                         |
| -------------------------------------------------- | --------------------------- | ------------------- | -------------------------------------------------------------------- |
| **Trello** (`@delorenj/mcp-server-trello`)         | `/trello_assistant`         | Yes, for that skill | Read/create/update cards on the Content Integration board.           |
| **GitHub** (`@modelcontextprotocol/server-github`) | Ad-hoc (PR / issue lookups) | Optional            | Read repos, PRs, issues when a skill or question needs code context. |
| **Atlassian** (`https://mcp.atlassian.com/v1/mcp`) | Ad-hoc (Jira / Confluence)  | Optional            | Query Jira tickets and Confluence pages.                             |
| **Lucid** (`https://mcp.lucid.app/mcp`)            | Ad-hoc (diagrams)           | Optional            | Read Lucidchart diagrams referenced in tickets.                      |


No skill in this repo requires GitHub, Atlassian, or Lucid — add them only if you want them available to the agent generally.

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

## Quick connection test

```bash
set -a && source .env && set +a

python3 scripts/clickhouse_query.py query "SELECT 1"
python3 scripts/mysql_query.py      query "SELECT 1"
python3 scripts/mongo_query.py      collections ota
```

If all three print results, the setup is ready.