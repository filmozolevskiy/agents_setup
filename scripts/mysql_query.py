#!/usr/bin/env python3
"""CLI tool for querying MySQL. Used by Claude Code skills.

Usage:
    python scripts/mysql_query.py query "SELECT * FROM my_table LIMIT 10"
    python scripts/mysql_query.py tables [database]
    python scripts/mysql_query.py describe <table> [database]

Credentials are read from environment variables:
    MYSQL_HOST, MYSQL_PORT, MYSQL_USER,
    MYSQL_PASSWORD, MYSQL_DATABASE
"""

import argparse
import os
import sys

import pymysql
import pymysql.cursors


def get_connection(database=None):
    host = os.environ.get("MYSQL_HOST")
    if not host:
        print("Error: MYSQL_HOST environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    return pymysql.connect(
        host=host,
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=database or os.environ.get("MYSQL_DATABASE"),
        cursorclass=pymysql.cursors.DictCursor,
    )


def print_table(headers, rows):
    if not rows:
        print("(no rows)")
        return

    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, h in enumerate(headers):
            col_widths[i] = max(col_widths[i], len(str(row[h])))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-+-".join("-" * w for w in col_widths))

    for row in rows:
        print(" | ".join(str(row[h]).ljust(col_widths[i]) for i, h in enumerate(headers)))

    print(f"\n({len(rows)} rows)")


def cmd_query(args):
    conn = get_connection()
    with conn:
        with conn.cursor() as cursor:
            cursor.execute(args.sql)
            rows = cursor.fetchall()

            if not rows:
                print("(no rows)")
                return

            headers = list(rows[0].keys())
            print_table(headers, rows)


def cmd_tables(args):
    db = args.database or os.environ.get("MYSQL_DATABASE")
    if not db:
        print("Error: No database specified and MYSQL_DATABASE is not set.", file=sys.stderr)
        sys.exit(1)

    conn = get_connection()
    with conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT TABLE_NAME as name, ENGINE as engine, TABLE_ROWS as `rows`, "
                "CONCAT(ROUND(DATA_LENGTH / 1024 / 1024, 2), ' MB') as size "
                "FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = %s ORDER BY TABLE_NAME",
                (db,),
            )
            rows = cursor.fetchall()

            if not rows:
                print(f"No tables found in database '{db}'.")
                return

            headers = ["name", "engine", "rows", "size"]
            print_table(headers, rows)
            print(f"({len(rows)} tables)")


def cmd_describe(args):
    db = args.database or os.environ.get("MYSQL_DATABASE")
    if not db:
        print("Error: No database specified and MYSQL_DATABASE is not set.", file=sys.stderr)
        sys.exit(1)

    conn = get_connection()
    with conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT COLUMN_NAME as name, COLUMN_TYPE as type, "
                "COLUMN_KEY as `key`, COLUMN_DEFAULT as `default`, EXTRA as extra "
                "FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s "
                "ORDER BY ORDINAL_POSITION",
                (db, args.table),
            )
            rows = cursor.fetchall()

            if not rows:
                print(f"Table '{args.table}' not found in database '{db}'.")
                sys.exit(1)

            headers = ["name", "type", "key", "default", "extra"]
            print_table(headers, rows)
            print(f"({len(rows)} columns)")


def main():
    parser = argparse.ArgumentParser(description="Query MySQL from the command line.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # query
    p_query = subparsers.add_parser("query", help="Execute a SQL query")
    p_query.add_argument("sql", help="SQL query to execute")

    # tables
    p_tables = subparsers.add_parser("tables", help="List tables in a database")
    p_tables.add_argument("database", nargs="?", help="Database name (default: from env)")

    # describe
    p_describe = subparsers.add_parser("describe", help="Show columns of a table")
    p_describe.add_argument("table", help="Table name")
    p_describe.add_argument("database", nargs="?", help="Database name (default: from env)")

    args = parser.parse_args()

    commands = {"query": cmd_query, "tables": cmd_tables, "describe": cmd_describe}
    commands[args.command](args)


if __name__ == "__main__":
    main()
