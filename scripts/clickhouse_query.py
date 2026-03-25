#!/usr/bin/env python3
"""CLI tool for querying ClickHouse. Used by Claude Code skills.

Usage:
    python scripts/clickhouse_query.py query "SELECT count() FROM my_table"
    python scripts/clickhouse_query.py tables [database]
    python scripts/clickhouse_query.py describe <table> [database]
    python scripts/clickhouse_query.py batch --start 2026-03-01 --end 2026-03-20 --chunk-days 1 "SELECT SUM(x) FROM t WHERE day_added BETWEEN '{start}' AND '{end}'"

Credentials are read from environment variables:
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
    CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE

Batch mode:
    Use {start} and {end} placeholders in your SQL for the date range.
    Each chunk runs as a separate query; numeric columns are summed across
    chunks, grouped by any non-numeric columns (e.g. affiliate_name, currency).
"""

import argparse
import os
import sys
from datetime import date, timedelta

import clickhouse_connect


def get_client():
    host = os.environ.get("CLICKHOUSE_HOST")
    if not host:
        print("Error: CLICKHOUSE_HOST environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    return clickhouse_connect.get_client(
        host=host,
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
        secure=True,
        send_receive_timeout=600,
        settings={"max_execution_time": 600},
    )


def print_table(headers, rows):
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, val in enumerate(row):
            col_widths[i] = max(col_widths[i], len(str(val)))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-+-".join("-" * w for w in col_widths))
    for row in rows:
        print(" | ".join(str(val).ljust(col_widths[i]) for i, val in enumerate(row)))


def cmd_query(args):
    client = get_client()
    result = client.query(args.sql)

    if not result.result_rows:
        print("(no rows)")
        return

    print_table(result.column_names, result.result_rows)
    print(f"\n({len(result.result_rows)} rows)")


def cmd_batch(args):
    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end)
    chunk_days = args.chunk_days

    if "{start}" not in args.sql or "{end}" not in args.sql:
        print("Error: SQL must contain {start} and {end} placeholders.", file=sys.stderr)
        sys.exit(1)

    client = get_client()

    headers = None
    numeric_cols = []
    key_cols = []
    aggregated = {}  # key_tuple -> {col: value}
    chunks_run = 0

    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=chunk_days - 1), end)
        sql = args.sql.replace("{start}", str(current)).replace("{end}", str(chunk_end))

        print(f"  [{chunks_run + 1}] {current} → {chunk_end} ...", end=" ", flush=True, file=sys.stderr)
        result = client.query(sql)
        row_count = len(result.result_rows)
        print(f"{row_count} rows", file=sys.stderr)

        if headers is None and result.result_rows:
            headers = result.column_names
            first_row = result.result_rows[0]
            numeric_cols = [h for h, v in zip(headers, first_row) if isinstance(v, (int, float))]
            key_cols = [h for h in headers if h not in numeric_cols]
        elif headers is None:
            headers = result.column_names
            numeric_cols = []
            key_cols = list(headers)

        for row in result.result_rows:
            row_dict = dict(zip(headers, row))
            key = tuple(row_dict[k] for k in key_cols) if key_cols else ()
            if key not in aggregated:
                aggregated[key] = {c: 0 for c in numeric_cols}
            for c in numeric_cols:
                val = row_dict.get(c, 0) or 0
                aggregated[key][c] += val

        current = chunk_end + timedelta(days=1)
        chunks_run += 1

    print(f"\n  {chunks_run} batches completed.\n", file=sys.stderr)

    if not aggregated:
        print("(no rows)")
        return

    all_headers = key_cols + numeric_cols
    out_rows = [list(key) + [aggregated[key][c] for c in numeric_cols] for key in aggregated]

    print_table(all_headers, out_rows)
    print(f"\n({len(out_rows)} rows, {chunks_run} batches)")


def cmd_tables(args):
    client = get_client()
    db = args.database or os.environ.get("CLICKHOUSE_DATABASE", "default")
    result = client.query(
        "SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size "
        "FROM system.tables WHERE database = {db:String} ORDER BY name",
        parameters={"db": db},
    )

    if not result.result_rows:
        print(f"No tables found in database '{db}'.")
        return

    print_table(result.column_names, result.result_rows)
    print(f"\n({len(result.result_rows)} tables)")


def cmd_describe(args):
    client = get_client()
    db = args.database or os.environ.get("CLICKHOUSE_DATABASE", "default")
    result = client.query(
        "SELECT name, type, default_kind, comment "
        "FROM system.columns WHERE database = {db:String} AND table = {table:String} "
        "ORDER BY position",
        parameters={"db": db, "table": args.table},
    )

    if not result.result_rows:
        print(f"Table '{args.table}' not found in database '{db}'.")
        sys.exit(1)

    print_table(result.column_names, result.result_rows)
    print(f"\n({len(result.result_rows)} columns)")


def main():
    parser = argparse.ArgumentParser(description="Query ClickHouse from the command line.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # query
    p_query = subparsers.add_parser("query", help="Execute a SQL query")
    p_query.add_argument("sql", help="SQL query to execute")

    # batch
    p_batch = subparsers.add_parser(
        "batch",
        help="Run a query in date chunks and aggregate numeric results. "
             "Use {start} and {end} placeholders in your SQL.",
    )
    p_batch.add_argument("sql", help="SQL template with {start} and {end} placeholders")
    p_batch.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    p_batch.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    p_batch.add_argument("--chunk-days", type=int, default=1,
                         help="Days per batch chunk (default: 1)")

    # tables
    p_tables = subparsers.add_parser("tables", help="List tables in a database")
    p_tables.add_argument("database", nargs="?", help="Database name (default: from env)")

    # describe
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
