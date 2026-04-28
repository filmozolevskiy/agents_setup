"""
qa-report: write a per-step QA validation report (markdown) for one run.

Reads a JSON document from stdin (or ``--input``) shaped like::

    {
      "header": {
        "booking_id": 297983572,
        "env": "production",
        "site": "flighthub",
        "content_source": "amadeus",
        "route": "YUL-LAX",
        "depart": "2026-07-15",
        "scenario_dir": "qa_automation/reports/20260428-110135-prod-amadeus-ac-yul-yvr"
      },
      "records": [
        {
          "booking_id": 297983572,
          "validation": "Shown vs charged total",
          "verdict": "PASS",
          "explanation": "$437.20 shown at checkout = $437.20 sum of statement_items",
          "proof": "`SELECT SUM(amount) FROM ota.booking_statement_items WHERE booking_id = 297983572`"
        }
      ]
    }

Writes ``{scenario_dir}/report.md`` (or ``--out``) and emits a single JSON
object on stdout::

    {"report_path": "qa_automation/reports/.../report.md",
     "overall_verdict": "PASS",
     "validations_count": 1}

Usage::

    cat records.json | uv run qa-report
    uv run qa-report --input records.json --out reports/.../report.md
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from qa_automation.reporting import (
    ReportHeader,
    ValidationRecord,
    overall_verdict,
    render_report,
    write_report,
)
from qa_automation.runners._common import (
    REPO_ROOT,
    die_from_exception,
    emit_error,
    emit_ok,
    load_env,
)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-report",
        description=(
            "Render a per-step QA validation report (markdown) from a JSON "
            "envelope of {header, records}."
        ),
    )
    p.add_argument(
        "--input",
        default=None,
        help="Path to JSON envelope. Defaults to stdin.",
    )
    p.add_argument(
        "--out",
        default=None,
        help=(
            "Output path for report.md. Defaults to "
            "{header.scenario_dir}/report.md."
        ),
    )
    p.add_argument(
        "--filename",
        default="report.md",
        help="Filename to write inside scenario_dir when --out is omitted.",
    )
    return p


def _load_envelope(path: str | None) -> dict[str, Any]:
    raw = Path(path).read_text(encoding="utf-8") if path else sys.stdin.read()
    if not raw.strip():
        emit_error(
            "empty_input",
            detail="qa-report needs a JSON envelope on stdin or via --input",
        )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        emit_error("invalid_json", detail=str(exc))


def _coerce_header(raw: dict[str, Any]) -> ReportHeader:
    if not isinstance(raw, dict):
        emit_error("invalid_envelope", detail="`header` must be an object")
    if "booking_id" not in raw:
        emit_error("invalid_envelope", detail="header.booking_id is required")
    if "env" not in raw:
        emit_error("invalid_envelope", detail="header.env is required")
    extras = raw.get("extras") or {}
    if extras and not isinstance(extras, dict):
        emit_error("invalid_envelope", detail="header.extras must be an object")
    return ReportHeader(
        booking_id=raw["booking_id"],
        env=str(raw["env"]),
        site=raw.get("site"),
        content_source=raw.get("content_source"),
        route=raw.get("route"),
        depart=raw.get("depart"),
        return_=raw.get("return") or raw.get("return_"),
        scenario_dir=raw.get("scenario_dir"),
        extras={str(k): str(v) for k, v in extras.items()},
    )


def _coerce_records(raw: list[Any]) -> list[ValidationRecord]:
    out: list[ValidationRecord] = []
    for i, item in enumerate(raw):
        if not isinstance(item, dict):
            emit_error("invalid_envelope", detail=f"records[{i}] must be an object")
        try:
            out.append(
                ValidationRecord(
                    booking_id=item["booking_id"],
                    validation=str(item["validation"]),
                    verdict=item["verdict"],
                    explanation=str(item["explanation"]),
                    proof=str(item["proof"]),
                )
            )
        except KeyError as exc:
            emit_error(
                "invalid_envelope",
                detail=f"records[{i}] missing required field: {exc.args[0]}",
            )
        except (TypeError, ValueError) as exc:
            emit_error("invalid_record", detail=f"records[{i}]: {exc}")
    return out


def _resolve_out_dir(scenario_dir: str) -> Path:
    candidate = Path(scenario_dir).expanduser()
    if not candidate.is_absolute():
        candidate = REPO_ROOT / candidate
    return candidate


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()
    try:
        envelope = _load_envelope(args.input)
        if not isinstance(envelope, dict):
            emit_error("invalid_envelope", detail="top-level JSON must be an object")
        if "header" not in envelope or "records" not in envelope:
            emit_error(
                "invalid_envelope",
                detail="envelope must have `header` (object) and `records` (array)",
            )
        if not isinstance(envelope["records"], list):
            emit_error("invalid_envelope", detail="`records` must be an array")

        header = _coerce_header(envelope["header"])
        records = _coerce_records(envelope["records"])

        if args.out:
            out_path = Path(args.out).expanduser()
            if not out_path.is_absolute():
                out_path = REPO_ROOT / out_path
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(render_report(header, records), encoding="utf-8")
        else:
            if not header.scenario_dir:
                emit_error(
                    "missing_out_path",
                    detail=(
                        "pass --out, or set header.scenario_dir to write "
                        "report.md inside it"
                    ),
                )
            out_path = write_report(
                _resolve_out_dir(header.scenario_dir),
                header,
                records,
                filename=args.filename,
            )

        try:
            display_path = str(out_path.resolve().relative_to(REPO_ROOT))
        except ValueError:
            display_path = str(out_path)

        emit_ok(
            {
                "report_path": display_path,
                "overall_verdict": overall_verdict(records),
                "validations_count": len(records),
            }
        )
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc)


if __name__ == "__main__":
    main()
