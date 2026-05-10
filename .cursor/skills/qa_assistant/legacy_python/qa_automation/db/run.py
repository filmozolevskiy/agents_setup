"""
Thin client wrappers used by ``qa-validate`` and ``qa-search-telemetry``.

Uses the same Python libraries as ``scripts/{mysql,mongo,clickhouse}_query.py``
(pymysql, pymongo, clickhouse-connect) rather than subprocessing those CLIs —
the CLIs print human-readable tables, not JSON, so in-process calls are
simpler and strictly more robust. Credentials come from the same ``.env``.

Each function returns plain Python data structures (lists of dicts, etc.)
that are safe to embed directly in the runner's JSON output.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Iterable

logger = logging.getLogger(__name__)


# ---------------------------- MySQL ----------------------------

def mysql_query(sql: str, params: tuple | dict | None = None) -> list[dict[str, Any]]:
    """Run a parametrized SELECT against the genesis MySQL, return list-of-dicts."""
    import pymysql
    import pymysql.cursors

    host = os.environ.get("MYSQL_HOST")
    if not host:
        raise RuntimeError("MYSQL_HOST not set; did you source .env?")

    conn = pymysql.connect(
        host=host,
        port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "root"),
        password=os.environ.get("MYSQL_PASSWORD", ""),
        database=os.environ.get("MYSQL_DATABASE"),
        cursorclass=pymysql.cursors.DictCursor,
        charset="utf8mb4",
        connect_timeout=10,
        read_timeout=60,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_jsonable_row(r) for r in rows]


def _jsonable_row(row: dict[str, Any]) -> dict[str, Any]:
    """Coerce MySQL-returned values (datetime, decimal, bytes) into JSON-safe types."""
    import datetime as dt
    from decimal import Decimal

    out: dict[str, Any] = {}
    for k, v in row.items():
        if isinstance(v, (dt.datetime, dt.date)):
            out[k] = v.isoformat()
        elif isinstance(v, Decimal):
            out[k] = float(v)
        elif isinstance(v, bytes):
            try:
                out[k] = v.decode("utf-8")
            except UnicodeDecodeError:
                out[k] = v.hex()
        else:
            out[k] = v
    return out


# ---------------------------- ClickHouse ----------------------------

def clickhouse_query(sql: str, parameters: dict | None = None) -> list[dict[str, Any]]:
    """Run a SELECT against ClickHouse, return list-of-dicts."""
    import clickhouse_connect

    host = os.environ.get("CLICKHOUSE_HOST")
    if not host:
        raise RuntimeError("CLICKHOUSE_HOST not set; did you source .env?")

    client = clickhouse_connect.get_client(
        host=host,
        port=int(os.environ.get("CLICKHOUSE_PORT", "8123")),
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=os.environ.get("CLICKHOUSE_DATABASE", "default"),
        secure=True,
        send_receive_timeout=60,
        settings={"max_execution_time": 60},
    )
    try:
        result = client.query(sql, parameters=parameters or {})
    finally:
        client.close()
    return [
        {h: _jsonable_scalar(v) for h, v in zip(result.column_names, row)}
        for row in result.result_rows
    ]


def _jsonable_scalar(v: Any) -> Any:
    import datetime as dt
    from decimal import Decimal
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bytes):
        try:
            return v.decode("utf-8")
        except UnicodeDecodeError:
            return v.hex()
    return v


# ---------------------------- MongoDB ----------------------------

def mongo_find(
    collection: str,
    filter_: dict | None = None,
    *,
    projection: dict | None = None,
    sort: Iterable[tuple[str, int]] | None = None,
    limit: int = 100,
    database: str | None = None,
) -> list[dict[str, Any]]:
    """Run a find() and return JSON-friendly documents (ObjectId -> str, etc.)."""
    from bson import json_util
    from pymongo import MongoClient
    from pymongo.uri_parser import parse_uri

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI not set; did you source .env?")

    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    try:
        db_name = database
        if not db_name:
            parsed = parse_uri(uri)
            db_name = parsed.get("database") or os.environ.get("MONGODB_DATABASE")
        if not db_name:
            raise RuntimeError("No Mongo database in URI or MONGODB_DATABASE")

        cur = client[db_name][collection].find(filter_ or {}, projection)
        if sort:
            cur = cur.sort(list(sort))
        cur = cur.limit(limit)
        docs = list(cur)
    finally:
        client.close()

    return json.loads(json_util.dumps(docs))


def mongo_count(
    collection: str,
    filter_: dict | None = None,
    *,
    database: str | None = None,
) -> int:
    from pymongo import MongoClient
    from pymongo.uri_parser import parse_uri

    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI not set; did you source .env?")

    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    try:
        db_name = database
        if not db_name:
            parsed = parse_uri(uri)
            db_name = parsed.get("database") or os.environ.get("MONGODB_DATABASE")
        if not db_name:
            raise RuntimeError("No Mongo database in URI or MONGODB_DATABASE")
        return client[db_name][collection].count_documents(filter_ or {})
    finally:
        client.close()
