"""
Prebuilt queries used by ``qa-validate`` and ``qa-search-telemetry``.

Each helper returns plain Python lists/dicts; callers embed the result in
runner JSON output without further shaping.

When validating a booking we intentionally over-fetch: the agent interprets
the evidence using ``.cursor/skills/qa_automation/references/validation_checklist.md``.
No judgment lives in this file.
"""
from __future__ import annotations

from typing import Any

from qa_automation.db.run import (
    clickhouse_query,
    mongo_count,
    mongo_find,
    mysql_query,
)


# ---------- MySQL: booking resolution ----------

def resolve_booking(booking_id: int | None, id_hash: str | None) -> dict[str, Any] | None:
    """Return a single ``ota.bookings`` row by id OR id_hash, whichever is given."""
    if booking_id is not None:
        rows = mysql_query(
            "SELECT * FROM ota.bookings WHERE id = %s",
            (booking_id,),
        )
    elif id_hash is not None:
        rows = mysql_query(
            "SELECT * FROM ota.bookings WHERE id_hash = %s",
            (id_hash,),
        )
    else:
        raise ValueError("resolve_booking: pass booking_id or id_hash")
    return rows[0] if rows else None


def resolve_booking_by_transaction_id(transaction_id: str) -> dict[str, Any] | None:
    rows = mysql_query(
        "SELECT * FROM ota.bookings WHERE debug_transaction_id = %s "
        "ORDER BY booking_date DESC LIMIT 1",
        (transaction_id,),
    )
    return rows[0] if rows else None


# ---------- MySQL: evidence dump ----------

def booking_contestants(booking_id: int) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.booking_contestants WHERE booking_id = %s ORDER BY id",
        (booking_id,),
    )


def booking_passengers(booking_id: int) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.booking_passengers WHERE booking_id = %s ORDER BY id",
        (booking_id,),
    )


def booking_segments(booking_id: int) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.booking_segments WHERE booking_id = %s ORDER BY id",
        (booking_id,),
    )


def booking_statement_items(booking_id: int) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.booking_statement_items WHERE booking_id = %s ORDER BY id",
        (booking_id,),
    )


def booking_tasks(booking_id: int) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.booking_tasks WHERE booking_id = %s ORDER BY id DESC LIMIT 50",
        (booking_id,),
    )


def bookability_contestant_attempts_for_search(search_hash: str) -> list[dict]:
    return mysql_query(
        "SELECT * FROM ota.bookability_contestant_attempts "
        "WHERE search_hash = %s ORDER BY date_created LIMIT 200",
        (search_hash,),
    )


def bookability_customer_attempts_for_search(search_hash: str) -> list[dict]:
    return mysql_query(
        "SELECT bca.* FROM ota.bookability_customer_attempts bca "
        "JOIN ota.bookability_contestant_attempts bcon "
        "  ON bcon.customer_attempt_id = bca.id "
        "WHERE bcon.search_hash = %s "
        "GROUP BY bca.id ORDER BY bca.date_created LIMIT 50",
        (search_hash,),
    )


# ---------- ClickHouse: errors for this booking / search ----------

def jupiter_booking_errors_for_search(search_id: str) -> list[dict]:
    return clickhouse_query(
        "SELECT * FROM jupiter.jupiter_booking_errors_v2 "
        "WHERE search_id = {search_id:String} "
        "ORDER BY timestamp LIMIT 200",
        parameters={"search_id": search_id},
    )


# Columns we keep in the compact projection used by diagnostic surfaces
# (qa-book error bodies, CLI summaries). Anything beyond this lands in the
# qa-validate evidence dump via ``jupiter_booking_errors_for_search``.
_JUPITER_ERR_COMPACT_COLS = (
    "timestamp",
    "gds",
    "gds_account_id",
    "validating_carrier",
    "route",
    "departure_date",
    "return_date",
    "number_of_adults",
    "number_of_children",
    "number_of_infants_on_seat",
    "number_of_infants_on_lap",
    "booking_step",
    "package_id",
    "error_message",
    "main_group_error",
    "sub_group_error",
    "front_end_message",
    "classification_category",
    "classification_subcategory",
)


def jupiter_booking_errors_compact(search_id: str, *, limit: int = 10) -> list[dict]:
    """Compact, agent-friendly projection of ``jupiter.jupiter_booking_errors_v2``.

    Identical filter to ``jupiter_booking_errors_for_search`` but returns
    only the columns that are useful in a diagnostic error body. Intended
    for the post-submit fallback in ``qa-book``; ``qa-validate`` keeps the
    full ``SELECT *`` projection.
    """
    cols = ", ".join(_JUPITER_ERR_COMPACT_COLS)
    return clickhouse_query(
        f"SELECT {cols} FROM jupiter.jupiter_booking_errors_v2 "
        "WHERE search_id = {search_id:String} "
        "ORDER BY timestamp LIMIT {limit:UInt32}",
        parameters={"search_id": search_id, "limit": limit},
    )


_DEFAULT_SEARCH_TELEMETRY_TABLE = "search_api_stats.gds_raw"


def clickhouse_search_telemetry(
    search_id: str,
    *,
    window_hours: int = 24,
) -> list[dict]:
    """Raw per-(search_id, content_source, api_call) rows from
    ``search_api_stats.gds_raw``.

    The table is Distributed and has no partition key / sorting key, so any
    query MUST include a ``date_added`` window or it does a full scan (tens
    of seconds to minutes). Default window is 24h, which covers any in-flight
    QA scenario.

    Override the table via ``QA_CH_SEARCH_TELEMETRY_TABLE``; if you do, the
    override must still expose columns ``search_id``, ``content_source``,
    ``response``, ``response_time``, ``num_packages_returned``,
    ``num_packages_blocked``, ``num_packages_won``, ``api_call``,
    ``search_type``, ``date_added``.
    """
    table = _search_telemetry_table()
    return clickhouse_query(
        f"SELECT search_id, content_source, api_call, search_type, "
        f"       num_packages_returned, num_packages_blocked, num_packages_won, "
        f"       response, response_time, office_id, cache_status, date_added "
        f"FROM {table} "
        f"WHERE date_added >= now() - INTERVAL {{window_hours:UInt32}} HOUR "
        f"  AND search_id = {{search_id:String}} "
        f"ORDER BY date_added LIMIT 500",
        parameters={"search_id": search_id, "window_hours": window_hours},
    )


def _search_telemetry_table() -> str:
    """Return the CH telemetry table, honouring a ``QA_CH_SEARCH_TELEMETRY_TABLE`` override."""
    import os
    return (
        os.environ.get("QA_CH_SEARCH_TELEMETRY_TABLE")
        or _DEFAULT_SEARCH_TELEMETRY_TABLE
    )


# ---------- MongoDB: debug_logs evidence ----------

def debug_logs_count(transaction_id: str) -> int:
    return mongo_count("debug_logs", {"transaction_id": transaction_id})


def debug_logs_top(transaction_id: str, limit: int = 10) -> list[dict]:
    """Return a trimmed projection of the most relevant debug_logs docs."""
    projection = {
        "_id": 1,
        "context": 1,
        "content_source": 1,
        "transaction_id": 1,
        "timestamp": 1,
        "Response": 1,
        "Request": 1,
        "booking_step": 1,
    }
    docs = mongo_find(
        "debug_logs",
        {"transaction_id": transaction_id},
        projection=projection,
        sort=[("timestamp", 1)],
        limit=limit,
    )
    # Trim very large Response/Request payloads to a preview.
    return [_trim_payloads(d) for d in docs]


def _trim_payloads(doc: dict, max_chars: int = 4000) -> dict:
    for k in ("Response", "Request"):
        if k in doc and isinstance(doc[k], (str, dict, list)):
            import json as _json
            try:
                s = doc[k] if isinstance(doc[k], str) else _json.dumps(doc[k], default=str)
            except Exception:
                s = str(doc[k])
            if len(s) > max_chars:
                doc[f"{k}_preview"] = s[:max_chars] + f"... [truncated, {len(s)} chars total]"
                del doc[k]
            else:
                doc[f"{k}_has"] = True
                del doc[k]
    return doc


def optimizer_logs_count(transaction_id: str) -> int:
    return mongo_count("optimizer_logs", {"transaction_id": transaction_id})


# ---------- MongoDB: booker-exception diagnosis ----------

# Contexts that pinpoint a booking failure raised inside the air booker.
# Ordered roughly from most-specific to most-general; we match any of them.
_BOOKER_EXCEPTION_CONTEXTS = [
    "tripstack-booker-exception",
    "amadeus-booker-exception",
    "kiwi-booker-exception",
    "atlas-booker-exception",
    "flightroutes24-booker-exception",
    "sabre-booker-exception",
    "booker-exception-log-result",
    "handle-booker-exception",
    "handling-booking-exception",
    "booker-segment-not-available",
    "booker-manager-single-ticket",
]


def _flatten_extjson(v):
    """Flatten BSON extended-JSON wrappers (``{"$date": ...}``, ``{"$oid":
    ...}``) into plain strings so the result embeds cleanly in agent output.
    ``mongo_find`` runs values through ``bson.json_util.dumps`` which
    introduces these wrappers; callers who don't need round-tripping want
    flat scalars.
    """
    if isinstance(v, dict):
        if set(v.keys()) == {"$date"}:
            return v["$date"]
        if set(v.keys()) == {"$oid"}:
            return v["$oid"]
    return v


def diagnose_booker_failure(transaction_id: str) -> dict | None:
    """For a checkout that never reached the confirmation portal, pull the
    booker exception (if any) from ``debug_logs`` and return a concise
    diagnosis. Returns ``None`` if no booker-failure logs are present
    (booking may still be in flight, or the failure was client-side).

    The shape is intentionally narrow so it can be embedded directly in
    ``qa-book`` JSON output and consumed by an agent without parsing.
    """
    docs = mongo_find(
        "debug_logs",
        {
            "transaction_id": transaction_id,
            "$or": [
                {"context": {"$in": _BOOKER_EXCEPTION_CONTEXTS}},
                {"level": {"$in": ["error", "critical"]}},
            ],
        },
        projection={
            "_id": 1,
            "context": 1,
            "level": 1,
            "date_added": 1,
            "exception": 1,
            "message": 1,
            "_scopes": 1,
        },
        sort=[("date_added", 1)],
        limit=200,
    )
    if not docs:
        return None

    parsed_exception: dict | None = None
    booker: str | None = None
    exception_doc_id: str | None = None
    for d in docs:
        ctx = d.get("context") or ""
        if ctx.endswith("-booker-exception") and "exception" in d:
            booker = ctx[: -len("-booker-exception")]
            raw = d["exception"]
            try:
                import json as _json
                parsed_exception = (
                    raw if isinstance(raw, dict) else _json.loads(raw)
                )
            except Exception:
                parsed_exception = {"raw": str(raw)[:1000]}
            exception_doc_id = _flatten_extjson(d.get("_id"))
            break

    # Only surface booker-related contexts here — generic ``error``/
    # ``critical`` rows (xcover, fraud-prevention, etc.) are noise relative
    # to "did we book?" and the agent has ``qa-validate`` for the full
    # evidence dump.
    key_contexts: list[dict] = []
    for d in docs:
        if d.get("context") in _BOOKER_EXCEPTION_CONTEXTS:
            key_contexts.append(
                {
                    "context": d.get("context"),
                    "level": d.get("level"),
                    "date_added": _flatten_extjson(d.get("date_added")),
                }
            )
        if len(key_contexts) >= 20:
            break

    if not key_contexts and parsed_exception is None:
        return None

    diagnosis: dict[str, object] = {
        "transaction_id": transaction_id,
        "booker": booker,
        "key_contexts": key_contexts,
        "first_booker_event_at": (
            key_contexts[0]["date_added"] if key_contexts else None
        ),
    }
    if parsed_exception is not None:
        diagnosis["exception_class"] = parsed_exception.get("class")
        diagnosis["exception_message"] = parsed_exception.get("message")
        file = parsed_exception.get("file")
        line = parsed_exception.get("line")
        if file:
            diagnosis["exception_at"] = f"{file}:{line}" if line else str(file)
        diagnosis["raw_exception_doc_id"] = exception_doc_id
    return diagnosis
