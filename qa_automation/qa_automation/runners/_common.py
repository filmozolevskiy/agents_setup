"""
Shared runner plumbing: env loading, scenario-dir allocation, JSON emission,
error shaping.

Every runner is a thin ``main()`` that:
  1. Calls ``load_env()`` once at the top.
  2. Parses its args.
  3. Runs the work.
  4. Calls ``emit_ok({...})`` on success or ``emit_error(...)`` on failure.

All runners therefore emit exactly one JSON object on stdout. Logs go to stderr
so stdout stays parseable.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import sys
import traceback
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, NoReturn

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS_DIR = REPO_ROOT / "qa_automation" / "reports"

logger = logging.getLogger("qa_automation")


# ---------- env ----------

def load_env() -> None:
    """Load .env from the repo root so all runners see the same credentials."""
    load_dotenv(REPO_ROOT / ".env", override=False)
    logging.basicConfig(
        level=os.environ.get("QA_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)-5s %(name)s %(message)s",
        stream=sys.stderr,
    )


# ---------- scenario dir ----------

def utc_stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S")


def allocate_scenario_dir(label: str | None, existing: str | None = None) -> Path:
    """Return a per-run scenario dir under qa_automation/reports/.

    Priority:
      1. If ``existing`` is given, use that path (co-locate screenshots across runners).
      2. Else build ``qa_automation/reports/{UTC}-{label}``.

    The directory is created if missing.
    """
    if existing:
        p = Path(existing).resolve()
    else:
        stem = utc_stamp()
        if label:
            stem = f"{stem}-{_sanitize_label(label)}"
        p = REPORTS_DIR / stem
    p.mkdir(parents=True, exist_ok=True)
    return p


def _sanitize_label(label: str) -> str:
    keep = []
    for ch in label:
        if ch.isalnum() or ch in "-_.":
            keep.append(ch)
        elif ch.isspace():
            keep.append("-")
    return "".join(keep).strip("-") or "scenario"


def list_screenshots(scenario_dir: Path) -> list[str]:
    if not scenario_dir.exists():
        return []
    return sorted(p.name for p in scenario_dir.iterdir() if p.suffix == ".png")


# ---------- JSON I/O ----------

def _coerce(obj: Any) -> Any:
    from decimal import Decimal

    if is_dataclass(obj) and not isinstance(obj, type):
        return {k: _coerce(v) for k, v in asdict(obj).items()}
    if isinstance(obj, Path):
        # Store paths relative to repo root when possible for cleaner agent output.
        try:
            return str(obj.resolve().relative_to(REPO_ROOT))
        except ValueError:
            return str(obj)
    if isinstance(obj, dt.datetime):
        return obj.isoformat()
    if isinstance(obj, dt.date):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        # Serialize as a JSON string to preserve exact precision; agents and
        # tests can convert back via ``Decimal(s)``.
        return str(obj)
    if isinstance(obj, (set, tuple)):
        return [_coerce(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _coerce(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_coerce(v) for v in obj]
    return obj


def emit_ok(payload: dict[str, Any]) -> NoReturn:
    sys.stdout.write(json.dumps(_coerce(payload), indent=2, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(0)


def emit_error(
    error: str,
    *,
    detail: str | None = None,
    exit_code: int = 1,
    **extra: Any,
) -> NoReturn:
    body: dict[str, Any] = {"error": error}
    if detail:
        body["detail"] = detail
    body.update(extra)
    sys.stdout.write(json.dumps(_coerce(body), indent=2, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()
    sys.exit(exit_code)


# ---------- error shaping ----------

# imported lazily to avoid hard dep if runner doesn't use page objects
def shape_selector_error(exc: Exception) -> dict[str, Any] | None:
    """If ``exc`` is a SelectorNotFound, return a JSON-friendly dict. Else None."""
    from qa_automation.pages.base_page import SelectorNotFound  # local import

    if isinstance(exc, SelectorNotFound):
        body = {"name": exc.name}
        if exc.url:
            body["url"] = exc.url
        if exc.screenshot:
            body["screenshot"] = exc.screenshot
        if exc.detail:
            body["detail"] = exc.detail
        return body
    return None


def die_from_exception(exc: BaseException, *, scenario_dir: Path | None = None) -> NoReturn:
    """Turn any exception into a JSON error body and exit non-zero."""
    selector_body = shape_selector_error(exc) if isinstance(exc, Exception) else None
    extra: dict[str, Any] = {}
    if scenario_dir is not None:
        extra["scenario_dir"] = scenario_dir
        extra["screenshots"] = list_screenshots(scenario_dir)

    if selector_body is not None:
        detail = selector_body.pop("detail", None)
        emit_error("selector_not_found", detail=detail, **selector_body, **extra)

    # Well-known domain exceptions from page objects
    name = type(exc).__name__
    if name == "SourceNotAvailableError":
        emit_error(
            "source_not_available_in_ui",
            detail=str(exc),
            retry_hint="try different date, route, or package_index",
            **extra,
        )
    if name == "CheckoutRenderTimeout":
        emit_error(
            "checkout_render_timeout",
            detail=str(exc),
            retry_hint="staging slow or package backend 500 — retry or pick another package",
            **extra,
        )

    # Fallback: generic exception
    emit_error(
        "unhandled_exception",
        detail=str(exc),
        exception_type=type(exc).__name__,
        traceback=traceback.format_exception(type(exc), exc, exc.__traceback__),
        **extra,
    )
