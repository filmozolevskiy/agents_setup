"""
qa-validate: dump raw evidence about a booking across MySQL/ClickHouse/MongoDB.

No pass/fail judgment — the agent reads the evidence against
``.cursor/skills/qa_automation/references/validation_checklist.md``.
"""
from __future__ import annotations

import argparse

from qa_automation.db import queries
from qa_automation.runners._common import (
    die_from_exception,
    emit_error,
    emit_ok,
    load_env,
)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-validate",
        description="Emit a raw evidence blob across MySQL/ClickHouse/MongoDB for a booking.",
    )
    p.add_argument("--booking-id", type=int, default=None)
    p.add_argument("--id-hash", default=None)
    p.add_argument("--transaction-id", default=None,
                   help="Mongo transaction_id / MySQL debug_transaction_id / CH search_id")
    p.add_argument("--mongo-limit", type=int, default=10)
    p.add_argument("--search-telemetry-window-hours", type=int, default=24,
                   help="Hours back in search_api_stats.gds_raw.date_added. "
                        "The table has no sorting key — widen only if the booking "
                        "is older than the default 24h.")
    return p


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    if args.booking_id is None and not args.id_hash and not args.transaction_id:
        emit_error(
            "missing_join_key",
            detail="pass at least one of --booking-id / --id-hash / --transaction-id",
        )

    try:
        booking = None
        if args.booking_id is not None:
            booking = queries.resolve_booking(booking_id=args.booking_id, id_hash=None)
        elif args.id_hash:
            booking = queries.resolve_booking(booking_id=None, id_hash=args.id_hash)
        elif args.transaction_id:
            booking = queries.resolve_booking_by_transaction_id(args.transaction_id)

        if booking is None:
            emit_error(
                "booking_not_found",
                detail="no ota.bookings row matched the provided join key",
                booking_id=args.booking_id,
                id_hash=args.id_hash,
                transaction_id=args.transaction_id,
            )

        booking_id = booking["id"]
        id_hash = booking.get("id_hash")
        debug_transaction_id = booking.get("debug_transaction_id") or args.transaction_id

        mysql_evidence = {
            "bookings": booking,
            "booking_contestants": queries.booking_contestants(booking_id),
            "booking_passengers": queries.booking_passengers(booking_id),
            "booking_segments": queries.booking_segments(booking_id),
            "booking_statement_items": queries.booking_statement_items(booking_id),
            "booking_statement_transactions": (
                queries.booking_statement_transactions(booking_id)
            ),
            "payhub_capture_summary": queries.payhub_capture_summary(booking_id),
            "payhub_ledger_summary": queries.payhub_ledger_summary(booking_id),
            "agency_supplier_payout_fop": queries.agency_supplier_payout_fop(booking_id),
            "booking_tasks": queries.booking_tasks(booking_id),
        }
        if debug_transaction_id:
            mysql_evidence["bookability_contestant_attempts_for_search"] = (
                queries.bookability_contestant_attempts_for_search(debug_transaction_id)
            )
            mysql_evidence["bookability_customer_attempts_for_search"] = (
                queries.bookability_customer_attempts_for_search(debug_transaction_id)
            )

        clickhouse_evidence: dict[str, object] = {}
        if debug_transaction_id:
            try:
                clickhouse_evidence["jupiter_booking_errors_v2"] = (
                    queries.jupiter_booking_errors_for_search(debug_transaction_id)
                )
            except Exception as exc:
                clickhouse_evidence["jupiter_booking_errors_v2_error"] = str(exc)
            try:
                clickhouse_evidence["search_telemetry_rows"] = (
                    queries.clickhouse_search_telemetry(
                        debug_transaction_id,
                        window_hours=args.search_telemetry_window_hours,
                    )
                )
                clickhouse_evidence["search_telemetry_table"] = (
                    queries._search_telemetry_table()
                )
                clickhouse_evidence["search_telemetry_window_hours"] = (
                    args.search_telemetry_window_hours
                )
            except Exception as exc:
                clickhouse_evidence["search_telemetry_error"] = str(exc)

        mongo_evidence: dict[str, object] = {}
        if debug_transaction_id:
            try:
                mongo_evidence["debug_logs_count"] = (
                    queries.debug_logs_count(debug_transaction_id)
                )
                mongo_evidence["debug_logs_top"] = (
                    queries.debug_logs_top(debug_transaction_id, limit=args.mongo_limit)
                )
                mongo_evidence["optimizer_logs_count"] = (
                    queries.optimizer_logs_count(debug_transaction_id)
                )
            except Exception as exc:
                mongo_evidence["error"] = str(exc)

        emit_ok({
            "join_keys": {
                "booking_id": booking_id,
                "id_hash": id_hash,
                "debug_transaction_id": debug_transaction_id,
            },
            "mysql": mysql_evidence,
            "clickhouse": clickhouse_evidence,
            "mongodb": mongo_evidence,
        })
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc)


if __name__ == "__main__":
    main()
