"""
qa-search-telemetry: ClickHouse lookup confirming which content sources
responded during a search.

Defaults to ``search_api_stats.gds_raw`` — one row per
(``search_id``, ``content_source``, ``api_call``) with ``response``,
``response_time``, ``num_packages_returned``, ``num_packages_blocked``,
``num_packages_won``.

``gds_raw`` is a Distributed table with no sorting key, so every query MUST
include a ``date_added`` window. We default the window to 24h; override via
``--window-hours`` if the search is older. Override the table itself via
``QA_CH_SEARCH_TELEMETRY_TABLE`` or bring your own query with ``--sql``.
"""
from __future__ import annotations

import argparse
import os

from qa_automation.db.run import clickhouse_query
from qa_automation.runners._common import (
    die_from_exception,
    emit_error,
    emit_ok,
    load_env,
)


_DEFAULT_TABLE = "search_api_stats.gds_raw"


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-search-telemetry",
        description="ClickHouse lookup: which content sources responded during a search.",
    )
    p.add_argument("--transaction-id", default=None,
                   help="Storefront transaction id (matches gds_raw.search_id).")
    p.add_argument("--search-hash", default=None,
                   help="Alias for --transaction-id (both map to gds_raw.search_id).")
    p.add_argument("--window-hours", type=int, default=24,
                   help="Hours back from NOW to scan in gds_raw.date_added. "
                        "gds_raw has no sorting key — keep this as tight as possible "
                        "(default 24h).")
    p.add_argument("--route", default=None,
                   help="[fallback] e.g. YUL-LAX when search_id is unknown; "
                        "used only by --sql overrides.")
    p.add_argument("--depart", default=None,
                   help="[fallback] YYYY-MM-DD; used only by --sql overrides.")
    p.add_argument("--sql", default=None,
                   help="Custom CH SQL. Placeholders: {search_id} {route} {depart} {window_hours}.")
    return p


def _default_sql(table: str) -> str:
    """Default query shape for ``search_api_stats.gds_raw``.

    Returns per-(content_source, api_call, search_type) aggregates with
    success/error counts and total/average response_time. The agent reads
    the first several fields:

    - ``content_source``, ``api_call``, ``search_type`` — identity
    - ``attempt_count``, ``success_count``, ``error_count``
    - ``last_error_response`` — non-"success" response tag, if any
    - ``packages_returned`` / ``packages_blocked`` / ``packages_won``
    - ``total_response_time_ms``, ``avg_response_time_ms``
    - ``first_seen`` / ``last_seen``

    Note: ``response_time`` in gds_raw is an Int32 — we keep the raw value
    and only rename it to ``*_ms`` for the agent. Some environments store
    seconds here; double-check if you see suspiciously small numbers.
    """
    return (
        f"SELECT "
        f"  content_source, "
        f"  anyIf(api_call, api_call != '') AS api_call, "
        f"  any(search_type) AS search_type, "
        f"  count() AS attempt_count, "
        f"  countIf(response = 'success') AS success_count, "
        f"  countIf(response != 'success') AS error_count, "
        f"  anyIf(response, response != 'success') AS last_error_response, "
        f"  sum(num_packages_returned) AS packages_returned, "
        f"  sum(num_packages_blocked) AS packages_blocked, "
        f"  sum(num_packages_won) AS packages_won, "
        f"  sum(response_time) AS total_response_time_ms, "
        f"  round(avg(response_time), 1) AS avg_response_time_ms, "
        f"  min(date_added) AS first_seen, "
        f"  max(date_added) AS last_seen "
        f"FROM {table} "
        f"WHERE date_added >= now() - INTERVAL {{window_hours}} HOUR "
        f"  AND search_id = {{search_id:String}} "
        f"GROUP BY content_source "
        f"ORDER BY content_source"
    )


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    search_id = args.transaction_id or args.search_hash
    if not search_id and not (args.route and args.depart):
        emit_error(
            "missing_join_key",
            detail="pass --transaction-id / --search-hash, or both --route and --depart "
                   "(route/depart only supported via --sql override for gds_raw).",
        )

    sql = args.sql
    table = os.environ.get("QA_CH_SEARCH_TELEMETRY_TABLE") or _DEFAULT_TABLE

    if sql is None:
        sql = _default_sql(table)

    # Only replace our own plain placeholders — the CH driver handles
    # typed placeholders like {search_id:String} itself, and those collide
    # with ``str.format``'s format-spec syntax.
    rendered_sql = sql
    for k, v in (
        ("route", args.route or ""),
        ("depart", args.depart or ""),
        ("window_hours", str(args.window_hours)),
    ):
        rendered_sql = rendered_sql.replace("{" + k + "}", v)

    try:
        rows = clickhouse_query(
            rendered_sql,
            parameters={"search_id": search_id or ""},
        )
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc)
        return

    sources_called = [
        {
            "content_source": r.get("content_source"),
            "status": "ok" if (r.get("error_count") or 0) == 0 and (r.get("success_count") or 0) > 0 else "error",
            "attempt_count": r.get("attempt_count"),
            "success_count": r.get("success_count"),
            "error_count": r.get("error_count"),
            "last_error_response": r.get("last_error_response") or None,
            "packages_returned": r.get("packages_returned"),
            "packages_blocked": r.get("packages_blocked"),
            "packages_won": r.get("packages_won"),
            "avg_response_time_ms": r.get("avg_response_time_ms"),
            "first_seen": str(r.get("first_seen")) if r.get("first_seen") is not None else None,
            "last_seen": str(r.get("last_seen")) if r.get("last_seen") is not None else None,
        }
        for r in rows
        if r.get("content_source")
    ]

    emit_ok({
        "join_key": {
            "transaction_id": search_id,
            "search_hash": search_id,
            "route": args.route,
            "depart": args.depart,
            "window_hours": args.window_hours,
        },
        "table": table,
        "sql": rendered_sql,
        "sources_called": sources_called,
        "clickhouse_rows": rows,
    })


if __name__ == "__main__":
    main()
