# Agents Setup

AI agents setup for Flighthub employees. Turns common data-investigation work (bookability, optimizer, content integration) into slash commands anyone on the team can run from Claude Code.

## How it works

The repo wires three things together:

1. **CLI wrappers** (`.claude/skills/db_access/scripts/`) — talk to ClickHouse, MySQL (genesis), and MongoDB (ota) using credentials from `.env`.
2. **Table docs** (`.claude/skills/db_access/db-docs/`) — tell the agent which table / collection holds what, before it writes any query.
3. **Skills** (`.claude/skills/<name>/SKILL.md`, loaded by Claude Code as `/<name>` slash commands) — encode the investigation recipes: which tables to join, which filters to apply, how to classify results, what format to return.

Invoke a slash command. The agent reads the matching `SKILL.md`, runs its steps, queries via the CLIs, and writes output (reports, findings, Trello cards, table docs) back into the repo.

## Skills

- **`/debugger`** — single front door for investigations: bookability (failure rates, `booking_id` / `search_hash` flow trace, similar-errors reports), optimizer matching audits (missed / mistagged fares, leak scans), and cross-system debugging with Datadog. Keeps a knowledge base of how each subsystem behaves.
- **`/qa_assistant`** — drive a real test booking on FlightHub / JustFly staging and validate it across MySQL / ClickHouse / MongoDB (`qa-search` → `qa-search-telemetry` → `qa-book` → `qa-validate` → `qa-cleanup`).
- **`/db_access`** — find which table or collection holds the data you need (when `.claude/skills/db_access/db-docs/` does not cover it) and / or save its purpose, schema, and gotchas under `.claude/skills/db_access/db-docs/`.
- **`/deploy_blamer`** — correlate a production regression to the genesis PR(s) most likely to have caused it; returns a ranked table of merges in the window.
- **`/post_deploy_tracker`** — autonomous watcher that verifies a shipped fix landed in production; loops on `debugger` bookability / optimizer queries and reports confirmed hits inline in the chat session.
- **`/trello_assistant`** — create or update cards on the Content Integration Trello board.

Full agent contract: `CLAUDE.md`. Detailed workflow: each skill's `SKILL.md`.

## Repo layout

```text
.mcp.json                  # MCP server registry (shared, committed; no secrets)
.claude/
├── settings.json           # Enabled project MCP servers
└── skills/                 # Per-skill folders, each with a SKILL.md
    ├── debugger/           # Investigations: knowledge base + bookability / optimizer notess
    ├── codebase_access/    # Local genesis checkout + sync script
    ├── db_access/          # Shared DB CLIs + schema docs
    │   ├── scripts/
    │   │   ├── clickhouse_query.py
    │   │   ├── mysql_query.py
    │   │   └── mongo_query.py
    │   └── db-docs/        # Documented CH / MySQL / Mongo tables
    ├── deploy_blamer/      # Regression → genesis PR correlation
    ├── looker_assistant/   # Looker MCP + LookML scaffolding
    ├── post_deploy_tracker/# Autonomous post-deploy verification watcher
    ├── qa_assistant/       # Test-booking runner (Playwright TS scaffold)
    │   └── scaffold/       # npm project — qa-search, qa-book, qa-validate, …
    └── trello_assistant/   # Trello card management
reports/                    # Ephemeral output from skills (gitignored)
CLAUDE.md                   # Agent constitution + skill routing
.env.example                # Template for the gitignored .env
requirements.txt            # Python deps for DB CLIs (clickhouse-connect, pymysql, pymongo)
```

## Setup

1. **Clone and install Python deps** (Python 3.10+):
  ```bash
   git clone <this-repo>
   cd agents_setup
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
  ```
2. **Install Node deps for the QA scaffold** (Node 18+):
  ```bash
   cd .claude/skills/qa_assistant/scaffold
   npm install
   cd -
  ```
3. **Create `.env`** at the repo root by copying the template. `.env` is gitignored. Never commit it.
  ```bash
   cp .env.example .env
  ```
   Fill in real values. `.env.example` lists every variable the repo reads, grouped by area. Only the database blocks are required for the core skills; the brand×env URL matrix and scaffold sections are needed for `/qa_assistant`.
4. **Load `.env` before running any Python CLI.** Export vars first:
  ```bash
   set -a && source .env && set +a
  ```
   The QA scaffold (`npx tsx runners/…`) loads `.env` automatically.

## MCP servers

All MCP servers are registered in `.mcp.json` at the repo root. Claude Code asks you to approve them the first time you open the repo. `.claude/settings.json` lists the approved names.

Two kinds of server exist:

- **Local servers** start through a wrapper script. The script loads `.env`, checks the required variables, then runs the server. Secrets stay in `.env` (gitignored).
- **Hosted servers** use OAuth. No secret is stored in the repo. Run `/mcp` in Claude Code and authorize the server on first use.

| MCP | Type | Credentials | Used by |
| --- | --- | --- | --- |
| **trello** (`@delorenj/mcp-server-trello`) | Local, `.claude/skills/trello_assistant/scripts/mcp_trello.sh` | `TRELLO_API_KEY`, `TRELLO_TOKEN` | `/trello_assistant`, `/qa_strategy` |
| **GitHub** (`@modelcontextprotocol/server-github`) | Local, `.claude/skills/deploy_blamer/scripts/mcp_github.sh` | `GITHUB_PERSONAL_ACCESS_TOKEN` | `/deploy_blamer`, `/code_review` |
| **growthbook** (`@growthbook/mcp`) | Local, `.claude/skills/growthbook_assistant/scripts/mcp_growthbook.sh` | `GB_API_KEY`, `GB_EMAIL`, `GB_API_URL` | `/growthbook_assistant` |
| **clickhouse** (`mcp-clickhouse`) | Local, `.claude/skills/db_access/scripts/mcp_clickhouse.sh` | `CLICKHOUSE_*` | `/db_access` (schema discovery) |
| **looker** (`genai-toolbox --prebuilt looker`) | Local, `.claude/skills/looker_assistant/scripts/mcp_looker.sh` | `LOOKER_*` | `/looker_assistant` |
| **Notion** | Hosted (`https://mcp.notion.com/mcp`) | OAuth | `/notion_assistant` |
| **datadog** | Hosted (`https://mcp.us5.datadoghq.com/v1/mcp`) | OAuth | `/debugger` |
| **Atlassian** | Hosted (`https://mcp.atlassian.com/v1/mcp`) | OAuth | Ad-hoc (Jira / Confluence) |
| **Lucid** | Hosted (`https://mcp.lucid.app/mcp`) | OAuth | Ad-hoc (diagrams) |

### Get credentials

Ask the IT team for any credential you do not have. Do not search other files for tokens.

- **Trello:** `TRELLO_API_KEY` and `TRELLO_TOKEN` from [trello.com/power-ups/admin](https://trello.com/power-ups/admin). The token needs read and write access on the Content Integration board.
- **GitHub:** a fine-grained personal access token with `repo` and `read:org`.
- **GrowthBook:** a read-scope API key from GrowthBook → Settings → API Keys.
- **Looker:** a client ID and secret for your Looker user.

Put all values in `.env`. Use `.env.example` as the template.

### One-time install

The Looker server needs the toolbox binary. The script downloads it into `bin/` (gitignored):

```bash
./.claude/skills/looker_assistant/scripts/install_mcp_toolbox.sh
```

The wrapper scripts need `npx` (Node 18+) and `uvx` (from [uv](https://docs.astral.sh/uv/)) on your `PATH`.

### Verify

Run `/mcp` in a Claude Code session and check that each server shows *connected*. For Trello, ask the agent to `set_active_board 61d5cf784c6396541499e7ce` and `get_lists`. If it returns the Content Integration lists, the server works.

### Keep `.mcp.json` the only source

Register these servers only in `.mcp.json`. Do not run `claude mcp add` for them. An entry with the same name in `~/.claude.json` (user or local scope) overrides `.mcp.json`. If it points at an old path, the server fails with `ENOENT`.

- A `SessionStart` hook (`.claude/hooks/check_mcp_config.sh`) warns at the start of each session when such an entry exists. It prints the `claude mcp remove` command for each one.
- `.mcp.json` starts each wrapper from `git rev-parse --show-toplevel`, so servers start from any subfolder.
- In a git worktree, `.env` and `bin/` do not exist. The wrappers then load them from the main checkout.

The database CLIs (`clickhouse_query.py` and others) stay the standard path for queries that go onto Trello cards, because cards need reproducible SQL. Use the ClickHouse MCP only for fast schema discovery.

## Quick connection test

```bash
set -a && source .env && set +a

python3 .claude/skills/db_access/scripts/clickhouse_query.py query "SELECT 1"
python3 .claude/skills/db_access/scripts/mysql_query.py      query "SELECT 1"
python3 .claude/skills/db_access/scripts/mongo_query.py      collections ota
```

If all three print results, the setup is ready.