# scripts

CLI helpers for working with this Looker project.

## mysql_query.py

Query the MySQL database that backs the `__CONNECTION__` Looker
connection. Used by agents (and humans) to inspect tables, validate
query patterns, and sanity-check aggregates against real data before
codifying them in LookML.

> Access is **read-only**. Inspect schemas, validate query shapes, and
> sanity-check aggregates. Never use this to modify data.

### Setup

1. Create a virtualenv and install requirements:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` and fill in credentials:

   ```bash
   cp .env.example .env
   # then edit .env and fill MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE
   ```

3. Export variables (the script reads from `os.environ`):

   ```bash
   set -a && source .env && set +a
   ```

### Usage

```bash
# Run an ad-hoc query
python scripts/mysql_query.py query "SELECT count(*) FROM __SQL_TABLE_NAME__ WHERE created_at > now() - interval 1 day"

# List tables in a database (defaults to MYSQL_DATABASE)
python scripts/mysql_query.py tables

# Describe a table's columns (uses INFORMATION_SCHEMA)
python scripts/mysql_query.py describe <table>
```

### Subcommands

| Subcommand | Purpose |
|-----------|---------|
| `query <sql>` | Run any SQL statement and print the result as a table. |
| `tables [db]` | List tables in `db` (or `MYSQL_DATABASE`) with engine, approx row count, and size. |
| `describe <table> [db]` | Print columns, types, nullability, default, key type, and column comment. |
| `batch <sql> --start --end [--chunk-days N]` | Run the same query repeatedly across date windows; numeric columns are summed and non-numeric columns are treated as group keys. |

### Notes

- Connection settings come from environment variables (`MYSQL_HOST`,
  `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`,
  optional `MYSQL_SSL=1`).
- `.env` is gitignored. Never commit credentials.
- Query timeout is 600 seconds. Use `batch` for long aggregations.
