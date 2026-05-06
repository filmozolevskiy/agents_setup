"""
Prebuilt queries used by ``qa-validate`` and ``qa-search-telemetry``.

Each helper returns plain Python lists/dicts; callers embed the result in
runner JSON output without further shaping.

When validating a booking we intentionally over-fetch: the agent interprets
the evidence using ``.cursor/skills/qa_automation/references/validation_checklist.md``.
No judgment lives in this file.
"""
from __future__ import annotations

from decimal import Decimal
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


def booking_statement_transactions(booking_id: int) -> list[dict]:
    """All processor-operation rows for the booking (full evidence dump).

    Includes every processor (Payhub, agency, Gordian, xcover, …) and every
    operation type (``auth``, ``auth_capture``, ``capture``, ``refund``,
    ``void``, …) so the agent can interpret refund/void chains alongside
    the captures. The ``payhub_capture_summary`` helper does the
    aggregation used by the verdict.
    """
    return mysql_query(
        "SELECT * FROM ota.booking_statement_transactions "
        "WHERE booking_id = %s ORDER BY transaction_date, id",
        (booking_id,),
    )


def payhub_capture_summary(booking_id: int) -> dict[str, Any]:
    """Aggregate the customer-side capture across all successful Payhub
    ``auth_capture`` rows.

    A booking with ancillaries added at checkout can produce more than one
    capture row; we sum across them. ``auth``-only, ``refund`` and ``void``
    rows are excluded.

    Returns a single dict (always — even for bookings with zero capture rows):

    * ``sum`` — ``Decimal`` grand total (``None`` when ``row_count == 0``).
    * ``currency_set`` — sorted list of distinct currencies seen.
    * ``row_count`` — number of capture rows aggregated.
    * ``billing_info_ids`` — sorted list of distinct ``billing_info_id``
      values from the matching ``booking_statement_items`` paid-sale rows
      (joined via ``paid_transaction_id``); used by the double-payment
      guard to identify which card was charged.
    """
    summary_rows = mysql_query(
        "SELECT SUM(amount) AS `sum`, "
        "       GROUP_CONCAT(DISTINCT currency) AS currency_set, "
        "       COUNT(*) AS row_count "
        "FROM ota.booking_statement_transactions "
        "WHERE booking_id = %s "
        "  AND processor = 'payhub' "
        "  AND type      = 'auth_capture' "
        "  AND status    = 'success'",
        (booking_id,),
    )
    bi_rows = mysql_query(
        "SELECT DISTINCT bsi.billing_info_id "
        "FROM ota.booking_statement_items bsi "
        "JOIN ota.booking_statement_transactions bst "
        "  ON bst.id = bsi.paid_transaction_id "
        "WHERE bsi.booking_id        = %s "
        "  AND bsi.payment_processor = 'payhub' "
        "  AND bsi.transaction_type  = 'sale' "
        "  AND bsi.status            = 'paid' "
        "  AND bst.processor         = 'payhub' "
        "  AND bst.type              = 'auth_capture' "
        "  AND bst.status            = 'success' "
        "  AND bsi.billing_info_id IS NOT NULL",
        (booking_id,),
    )
    return {
        "sum": _to_decimal(summary_rows[0]["sum"]) if summary_rows else None,
        "currency_set": _split_csv(summary_rows[0]["currency_set"] if summary_rows else None),
        "row_count": int(summary_rows[0]["row_count"]) if summary_rows else 0,
        "billing_info_ids": sorted({int(r["billing_info_id"]) for r in bi_rows}),
    }


def payhub_ledger_summary(booking_id: int) -> dict[str, Any]:
    """Aggregate the per-line customer ledger across all paid Payhub sale rows.

    No ``bsi.type`` filter — we want the **grand total** across ``fare``,
    ``service_fees``, ``ancillary_*``, ``seatmap_fee``, etc. The
    ``type_breakdown`` field surfaces the per-category split for forensic
    use; the verdict only consumes the grand total.

    Returns a single dict:

    * ``sum`` — ``Decimal`` grand total of ``customer_amount`` (``None`` when
      ``row_count == 0``).
    * ``currency_set`` — sorted list of distinct currencies seen.
    * ``row_count`` — number of ledger rows aggregated.
    * ``billing_info_ids`` — sorted list of distinct non-null
      ``billing_info_id`` values across the rows.
    * ``type_breakdown`` — list of ``{"type": <bsi.type>, "sum": Decimal,
      "row_count": int}`` entries, ordered by descending sum. Forensic
      detail; not used by the verdict.
    """
    summary_rows = mysql_query(
        "SELECT SUM(customer_amount) AS `sum`, "
        "       GROUP_CONCAT(DISTINCT currency) AS currency_set, "
        "       GROUP_CONCAT(DISTINCT billing_info_id) AS billing_info_ids, "
        "       COUNT(*) AS row_count "
        "FROM ota.booking_statement_items "
        "WHERE booking_id = %s "
        "  AND payment_processor = 'payhub' "
        "  AND transaction_type  = 'sale' "
        "  AND status            = 'paid'",
        (booking_id,),
    )
    breakdown_rows = mysql_query(
        "SELECT type, "
        "       SUM(customer_amount) AS `sum`, "
        "       COUNT(*) AS row_count "
        "FROM ota.booking_statement_items "
        "WHERE booking_id = %s "
        "  AND payment_processor = 'payhub' "
        "  AND transaction_type  = 'sale' "
        "  AND status            = 'paid' "
        "GROUP BY type "
        "ORDER BY `sum` DESC",
        (booking_id,),
    )
    s = summary_rows[0] if summary_rows else {}
    return {
        "sum": _to_decimal(s.get("sum")),
        "currency_set": _split_csv(s.get("currency_set")),
        "row_count": int(s.get("row_count") or 0),
        "billing_info_ids": _split_csv_int(s.get("billing_info_ids")),
        "type_breakdown": [
            {
                "type": r["type"],
                "sum": _to_decimal(r["sum"]),
                "row_count": int(r["row_count"]),
            }
            for r in breakdown_rows
        ],
    }


def agency_supplier_payout_fop(booking_id: int) -> dict[str, Any]:
    """Single round-trip query feeding the double-payment guard.

    Returns one row with:

    * ``payhub_capture_count`` — number of successful Payhub auth_captures
      on the booking. Used to distinguish "Payhub side genuinely empty"
      from "Payhub had a capture but no paid-sale ledger row" (the latter
      would be flagged by the gateway-vs-ledger sub-check, not this one).
    * ``payhub_billing_info_ids`` — sorted list of distinct
      ``billing_info_id``s from Payhub paid-sale ledger rows (any
      ``bsi.type`` — full grand-total view of which card we charged).
    * ``agency_cc_billing_info_ids`` — sorted list of distinct
      ``billing_info_id``s from agency-side **fare** payouts where
      ``fop='credit_card'`` AND there is no corresponding
      ``booking_virtual_card_statement_items`` row (i.e. real customer
      credit-card passthrough, not a VCC).
    """
    rows = mysql_query(
        "SELECT "
        "  (SELECT COUNT(*) "
        "     FROM ota.booking_statement_transactions bst "
        "    WHERE bst.booking_id = %(booking_id)s "
        "      AND bst.processor = 'payhub' "
        "      AND bst.type      = 'auth_capture' "
        "      AND bst.status    = 'success') AS payhub_capture_count, "
        "  (SELECT GROUP_CONCAT(DISTINCT bsi.billing_info_id) "
        "     FROM ota.booking_statement_items bsi "
        "    WHERE bsi.booking_id        = %(booking_id)s "
        "      AND bsi.payment_processor = 'payhub' "
        "      AND bsi.transaction_type  = 'sale' "
        "      AND bsi.status            = 'paid') AS payhub_billing_info_ids, "
        "  (SELECT GROUP_CONCAT(DISTINCT bsi.billing_info_id) "
        "     FROM ota.booking_statement_items bsi "
        "     LEFT JOIN ota.booking_virtual_card_statement_items bvcsi "
        "            ON bvcsi.statement_item_id = bsi.id "
        "    WHERE bsi.booking_id        = %(booking_id)s "
        "      AND bsi.payment_processor = 'agency' "
        "      AND bsi.type              = 'fare' "
        "      AND bsi.transaction_type  = 'sale' "
        "      AND bsi.fop               = 'credit_card' "
        "      AND bvcsi.id IS NULL) AS agency_cc_billing_info_ids",
        {"booking_id": booking_id},
    )
    r = rows[0] if rows else {}
    return {
        "payhub_capture_count": int(r.get("payhub_capture_count") or 0),
        "payhub_billing_info_ids": _split_csv_int(r.get("payhub_billing_info_ids")),
        "agency_cc_billing_info_ids": _split_csv_int(r.get("agency_cc_billing_info_ids")),
    }


def _to_decimal(v: Any) -> Decimal | None:
    """Coerce a sum-like value back to ``Decimal`` for exact money math.

    The MySQL wrapper (``_jsonable_row``) converts ``Decimal`` to ``float``
    before this helper sees it, which is fine for evidence dumps but unsafe
    for comparisons. Going through ``Decimal(str(...))`` round-trips
    correctly for the float repr of any short-precision money value.
    """
    if v is None:
        return None
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def _split_csv(s: Any) -> list[str]:
    """Return a sorted list of distinct strings parsed from a
    ``GROUP_CONCAT`` result. Handles ``None`` and empty inputs."""
    if not s:
        return []
    if isinstance(s, (list, tuple, set)):
        return sorted({str(v) for v in s if v is not None and str(v) != ""})
    return sorted({p for p in str(s).split(",") if p})


def _split_csv_int(s: Any) -> list[int]:
    """Same as ``_split_csv`` but coerces to ``int``."""
    return sorted({int(p) for p in _split_csv(s)})


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
