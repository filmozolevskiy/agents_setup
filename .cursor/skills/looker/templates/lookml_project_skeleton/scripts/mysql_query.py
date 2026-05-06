#!/usr/bin/env python3
"""CLI tool for querying the MySQL `ota` database that backs this Looker project.

Usage:
    python scripts/mysql_query.py query "SELECT count(*) FROM ota.optimizer_candidates"
    python scripts/mysql_query.py tables [database]
    python scripts/mysql_query.py describe <table> [database]
    python scripts/mysql_query.py batch --start 2026-03-01 --end 2026-03-20 --chunk-days 1 \\
        "SELECT count(*) AS n FROM ota.optimizer_candidates \\
         WHERE created_at BETWEEN '{start}' AND '{end}'"

Credentials are read from environment variables (typically loaded from .env):
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
    MYSQL_SSL (optional: set to "1" to require TLS)

Batch mode:
    Use {start} and {end} placeholders in your SQL for the date range.
    Each chunk runs as a separate query; numeric columns are summed across
    chunks, grouped by any non-numeric columns (e.g. affiliate_id, currency).

Access is read-only; this script is intended for agents/humans to inspect
schemas and validate query patterns against real data without touching the DB.
"""

import argparse
import os
import sys
from datetime import date, timedelta
from decimal import Decimal

import pymysql
import pymysql.cursors


def get_connection():
    host = os.environ.get("MYSQL_HOST")
    if not host:
        print("Error: MYSQL_HOST environment variable is not set.", file=sys.stderr)
        print("Hint: copy .env.example to .env, fill credentials, then run:", file=sys.stderr)
        print("      set -a && source .env && set +a", file=sys.stderr)
        sys.exit(1)

    kwargs = dict(
        host=host,
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE") or None,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        connect_timeout=30,
        read_timeout=600,
        write_timeout=600,
    )

    if os.environ.get("MYSQL_SSL") == "1":
        kwargs["ssl"] = {"ssl": {}}

    return pymysql.connect(**kwargs)


def is_numeric(value):
    """Numeric for batch aggregation purposes (sum-able)."""
    if isinstance(value, bool):
        return False
    return isinstance(value, (int, float, Decimal))


def to_float(value):
    if value is None:
        return 0.0
    if isinstance(value, Decimal):
        return float(value)
    return float(value)


def print_table(headers, rows):
    if not headers:
        print("(no columns)")
        return

    str_rows = [[("" if v is None else str(v)) for v in row] for row in rows]
    col_widths = [len(h) for h in headers]
    for row in str_rows:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(val))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-+-".join("-" * w for w in col_widths))
    for row in str_rows:
        print(" | ".join(val.ljust(col_widths[i]) for i, val in enumerate(row)))


def cmd_query(args):
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(args.sql)
            rows = cur.fetchall()
            headers = [d[0] for d in cur.description] if cur.description else []
    finally:
        conn.close()

    if not rows:
        if headers:
            print_table(headers, [])
        print("(no rows)")
        return

    print_table(headers, rows)
    print(f"\n({len(rows)} rows)")


def cmd_batch(args):
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    chunk_days = args.chunk_days

    if "{start}" not in args.sql or "{end}" not in args.sql:
        print("Error: SQL must contain {start} and {end} placeholders.", file=sys.stderr)
        sys.exit(1)

    conn = get_connection()

    headers = None
    numeric_cols = []
    key_cols = []
    aggregated = {}
    chunks_run = 0

    try:
        current = start
        while current <= end:
            chunk_end = min(current + timedelta(days=chunk_days - 1), end)
            sql = args.sql.replace("{start}", str(current)).replace("{end}", str(chunk_end))

            print(
                f"  [{chunks_run + 1}] {current} -> {chunk_end} ...",
                end=" ",
                flush=True,
                file=sys.stderr,
            )
            with conn.cursor() as cur:
                cur.execute(sql)
                rows = cur.fetchall()
                cur_headers = [d[0] for d in cur.description] if cur.description else []
            row_count = len(rows)
            print(f"{row_count} rows", file=sys.stderr)

            if headers is None and rows:
                headers = cur_headers
                first_row = rows[0]
                numeric_cols = [h for h, v in zip(headers, first_row) if is_numeric(v)]
                key_cols = [h for h in headers if h not in numeric_cols]
            elif headers is None:
                headers = cur_headers
                numeric_cols = []
                key_cols = list(headers)

            for row in rows:
                row_dict = dict(zip(headers, row))
                key = tuple(row_dict[k] for k in key_cols) if key_cols else ()
                if key not in aggregated:
                    aggregated[key] = {c: 0.0 for c in numeric_cols}
                for c in numeric_cols:
                    aggregated[key][c] += to_float(row_dict.get(c))

            current = chunk_end + timedelta(days=1)
            chunks_run += 1
    finally:
        conn.close()

    print(f"\n  {chunks_run} batches completed.\n", file=sys.stderr)

    if not aggregated:
        print("(no rows)")
        return

    all_headers = key_cols + numeric_cols
    out_rows = [list(key) + [aggregated[key][c] for c in numeric_cols] for key in aggregated]

    print_table(all_headers, out_rows)
    print(f"\n({len(out_rows)} rows, {chunks_run} batches)")


def cmd_tables(args):
    db = args.database or os.environ.get("MYSQL_DATABASE")
    if not db:
        print(
            "Error: no database specified and MYSQL_DATABASE env var is not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    TABLE_NAME      AS name,
                    ENGINE          AS engine,
                    TABLE_ROWS      AS approx_rows,
                    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 2) AS size_mb
                FROM information_schema.tables
                WHERE TABLE_SCHEMA = %s
                ORDER BY TABLE_NAME
                """,
                (db,),
            )
            rows = cur.fetchall()
            headers = [d[0] for d in cur.description] if cur.description else []
    finally:
        conn.close()

    if not rows:
        print(f"No tables found in database '{db}'.")
        return

    print_table(headers, rows)
    print(f"\n({len(rows)} tables)")


def cmd_describe(args):
    db = args.database or os.environ.get("MYSQL_DATABASE")
    if not db:
        print(
            "Error: no database specified and MYSQL_DATABASE env var is not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    COLUMN_NAME    AS name,
                    COLUMN_TYPE    AS type,
                    IS_NULLABLE    AS nullable,
                    COLUMN_DEFAULT AS `default`,
                    COLUMN_KEY     AS key_type,
                    COLUMN_COMMENT AS comment
                FROM information_schema.columns
                WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
                ORDER BY ORDINAL_POSITION
                """,
                (db, args.table),
            )
            rows = cur.fetchall()
            headers = [d[0] for d in cur.description] if cur.description else []
    finally:
        conn.close()

    if not rows:
        print(f"Table '{args.table}' not found in database '{db}'.")
        sys.exit(1)

    print_table(headers, rows)
    print(f"\n({len(rows)} columns)")


def main():
    parser = argparse.ArgumentParser(
        description="Query the MySQL `ota` database from the command line.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_query = subparsers.add_parser("query", help="Execute a SQL query")
    p_query.add_argument("sql", help="SQL query to execute")

    p_batch = subparsers.add_parser(
        "batch",
        help=(
            "Run a query in date chunks and aggregate numeric results. "
            "Use {start} and {end} placeholders in your SQL."
        ),
    )
    p_batch.add_argument("sql", help="SQL template with {start} and {end} placeholders")
    p_batch.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    p_batch.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    p_batch.add_argument(
        "--chunk-days",
        type=int,
        default=1,
        help="Days per batch chunk (default: 1)",
    )

    p_tables = subparsers.add_parser("tables", help="List tables in a database")
    p_tables.add_argument("database", nargs="?", help="Database name (default: from env)")

    p_describe = subparsers.add_parser("describe", help="Show columns of a table")
    p_describe.add_argument("table", help="Table name")
    p_describe.add_argument("database", nargs="?", help="Database name (default: from env)")

    args = parser.parse_args()

    commands = {
        "query": cmd_query,
        "batch": cmd_batch,
        "tables": cmd_tables,
        "describe": cmd_describe,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
