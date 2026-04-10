#!/usr/bin/env python3
"""CLI tool for querying MongoDB. Used by Claude Code skills.

Usage:
    python scripts/mongo_query.py collections [database]
    python scripts/mongo_query.py describe <collection> [database]
    python scripts/mongo_query.py find <collection> [--filter JSON] [--projection JSON]
        [--sort JSON] [--limit N] [--json]
    python scripts/mongo_query.py aggregate <collection> '<pipeline-json-array>' [--json]

Credentials are read from environment variables:
    MONGODB_URI — connection string (e.g. from MongoDB Compass export)
    MONGODB_DATABASE — optional default database when the URI has no database path

The find subcommand defaults to --limit 100 unless you pass a different --limit.
Use --json for Extended-JSON-friendly output (ObjectId, dates, etc.).

Aggregate/find --filter JSON cannot embed BSON Date (no ISODate in JSON). For date-bounded
aggregations on large collections (e.g. ota.debug_logs), use mongosh, Compass, or a short pymongo
script. See .cursor/skills/bookability_analysis/SKILL.md (Effective queries on debug_logs).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

from bson import json_util
from pymongo import MongoClient
from pymongo.uri_parser import parse_uri


ALLOWED_DATABASE = "ota"
ALLOWED_COLLECTIONS = ["debug_logs", "optimizer_logs"]


def get_client() -> MongoClient:
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        print("Error: MONGODB_URI environment variable is not set.", file=sys.stderr)
        sys.exit(1)

    return MongoClient(uri, serverSelectionTimeoutMS=10_000)


def get_database(client: MongoClient, database: str | None = None):
    db_name = database
    if not db_name:
        parsed = parse_uri(os.environ["MONGODB_URI"])
        db_name = parsed.get("database") or os.environ.get("MONGODB_DATABASE")

    if not db_name:
        print(
            "Error: No database in connection URI and MONGODB_DATABASE is not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    if db_name.lower() != ALLOWED_DATABASE.lower():
        print(f"Error: Exploration is limited to database '{ALLOWED_DATABASE}'.", file=sys.stderr)
        sys.exit(1)

    return client[db_name]


def validate_collection(collection: str):
    if collection not in ALLOWED_COLLECTIONS:
        print(
            f"Error: Exploration is limited to collections: {', '.join(ALLOWED_COLLECTIONS)}.",
            file=sys.stderr,
        )
        sys.exit(1)


def print_table(headers: list[str], rows: list[dict[str, Any]]):
    if not rows:
        print("(no rows)")
        return

    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, h in enumerate(headers):
            col_widths[i] = max(col_widths[i], len(str(row.get(h, ""))))

    header_line = " | ".join(h.ljust(col_widths[i]) for i, h in enumerate(headers))
    print(header_line)
    print("-+-".join("-" * w for w in col_widths))

    for row in rows:
        print(" | ".join(str(row.get(h, "")).ljust(col_widths[i]) for i, h in enumerate(headers)))

    print(f"\n({len(rows)} rows)")


def _cell_value(val: Any) -> str:
    if val is None:
        return ""
    if isinstance(val, (dict, list)):
        return json.dumps(val, default=str)
    return str(val)


def documents_to_table_rows(docs: list[dict]) -> tuple[list[str], list[dict[str, str]]]:
    keys: set[str] = set()
    for doc in docs:
        keys.update(doc.keys())
    headers = sorted(keys)
    rows = []
    for doc in docs:
        rows.append({h: _cell_value(doc.get(h)) for h in headers})
    return headers, rows


def cmd_collections(args):
    client = get_client()
    db = get_database(client, args.database)
    infos = list(db.list_collections())
    if not infos:
        print(f"No collections in database '{db.name}'.")
        return

    # Limit to allowed collections
    rows = [
        {"name": c["name"], "type": c.get("type", "")}
        for c in infos
        if c["name"] in ALLOWED_COLLECTIONS
    ]
    if not rows:
        print(f"No allowed collections in database '{db.name}'.")
        return

    print_table(["name", "type"], rows)
    print(f"({len(rows)} collections)")


def cmd_describe(args):
    validate_collection(args.collection)
    client = get_client()
    db = get_database(client, args.database)
    coll = db[args.collection]

    try:
        count = coll.estimated_document_count()
    except Exception as e:
        print(f"Warning: could not estimate document count: {e}", file=sys.stderr)
        count = None

    idx_rows = []
    for spec in coll.list_indexes():
        keys = spec.get("key")
        key_str = ", ".join(f"{k}: {v}" for k, v in keys.items()) if keys else ""
        idx_rows.append(
            {
                "name": spec.get("name", ""),
                "key": key_str,
                "unique": str(spec.get("unique", False)),
            }
        )

    print(f"Collection: {db.name}.{args.collection}")
    if count is not None:
        print(f"Estimated documents: {count}")
    print()
    if idx_rows:
        print_table(["name", "key", "unique"], idx_rows)
        print(f"({len(idx_rows)} indexes)")
    else:
        print("(no indexes)")

    if args.sample > 0:
        print()
        samples = list(coll.aggregate([{"$sample": {"size": args.sample}}]))
        if not samples:
            print("(sample: no documents)")
            return
        if args.json:
            print(json_util.dumps(samples, indent=2))
        else:
            headers, rows = documents_to_table_rows(samples)
            print_table(headers, rows)
            print(f"(sample: {len(samples)} documents)")


def cmd_find(args):
    validate_collection(args.collection)
    client = get_client()
    db = get_database(client, args.database)
    coll = db[args.collection]

    try:
        filter_doc = json.loads(args.filter) if args.filter else {}
    except json.JSONDecodeError as e:
        print(f"Error: invalid --filter JSON: {e}", file=sys.stderr)
        sys.exit(1)

    projection = None
    if args.projection:
        try:
            projection = json.loads(args.projection)
        except json.JSONDecodeError as e:
            print(f"Error: invalid --projection JSON: {e}", file=sys.stderr)
            sys.exit(1)

    sort = None
    if args.sort:
        try:
            sort = list(json.loads(args.sort).items())
        except json.JSONDecodeError as e:
            print(f"Error: invalid --sort JSON: {e}", file=sys.stderr)
            sys.exit(1)

    cursor = coll.find(filter_doc, projection)
    if sort:
        cursor = cursor.sort(sort)
    cursor = cursor.limit(args.limit)
    docs = list(cursor)

    if args.json:
        print(json_util.dumps(docs, indent=2))
        if docs:
            print(f"\n({len(docs)} documents)", file=sys.stderr)
    else:
        if not docs:
            print("(no rows)")
            return
        headers, rows = documents_to_table_rows(docs)
        print_table(headers, rows)


def cmd_aggregate(args):
    validate_collection(args.collection)
    client = get_client()
    db = get_database(client, args.database)
    coll = db[args.collection]

    try:
        pipeline = json.loads(args.pipeline)
    except json.JSONDecodeError as e:
        print(f"Error: invalid pipeline JSON: {e}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(pipeline, list):
        print("Error: pipeline must be a JSON array of stages.", file=sys.stderr)
        sys.exit(1)

    docs = list(coll.aggregate(pipeline))

    if args.json:
        print(json_util.dumps(docs, indent=2))
        if docs:
            print(f"\n({len(docs)} documents)", file=sys.stderr)
    else:
        if not docs:
            print("(no rows)")
            return
        headers, rows = documents_to_table_rows(docs)
        print_table(headers, rows)


def main():
    parser = argparse.ArgumentParser(description="Query MongoDB from the command line.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    p_coll = subparsers.add_parser(
        "collections",
        help="List collections in a database (Mongo equivalent of tables)",
    )
    p_coll.add_argument("database", nargs="?", help="Database name (default: from URI or env)")
    p_coll.set_defaults(func=cmd_collections)

    p_desc = subparsers.add_parser("describe", help="Show indexes, count, and optional sample docs")
    p_desc.add_argument("collection", help="Collection name")
    p_desc.add_argument("database", nargs="?", help="Database name (default: from URI or env)")
    p_desc.add_argument(
        "--sample",
        type=int,
        default=3,
        metavar="N",
        help="Number of random documents to sample (0 to skip; default: 3)",
    )
    p_desc.add_argument(
        "--json",
        action="store_true",
        help="Print Extended JSON (ObjectId, BSON types)",
    )
    p_desc.set_defaults(func=cmd_describe)

    p_find = subparsers.add_parser("find", help="Run a find query with JSON filter")
    p_find.add_argument("collection", help="Collection name")
    p_find.add_argument("database", nargs="?", help="Database name (default: from URI or env)")
    p_find.add_argument("--filter", default="{}", help='Filter as JSON object (default: "{}")')
    p_find.add_argument("--projection", help="Projection as JSON object")
    p_find.add_argument(
        "--sort",
        help='Sort as JSON object, e.g. \'{"created_at": -1}\'',
    )
    p_find.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Max documents to return (default: 100)",
    )
    p_find.add_argument(
        "--json",
        action="store_true",
        help="Print Extended JSON (ObjectId, BSON types)",
    )
    p_find.set_defaults(func=cmd_find)

    p_agg = subparsers.add_parser(
        "aggregate",
        help="Run an aggregation pipeline (JSON array of stages)",
    )
    p_agg.add_argument("collection", help="Collection name")
    p_agg.add_argument("pipeline", help="Pipeline as a JSON array string")
    p_agg.add_argument("database", nargs="?", help="Database name (default: from URI or env)")
    p_agg.add_argument(
        "--json",
        action="store_true",
        help="Print Extended JSON (ObjectId, BSON types)",
    )
    p_agg.set_defaults(func=cmd_aggregate)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
