"""
Per-step QA validation report (markdown).

The agent walks the ``qa-validate`` evidence blob against
``.cursor/skills/qa_automation/references/validation_checklist.md``,
emits one ``ValidationRecord`` per invariant, and asks this module to
render a single ``report.md`` per run. The body is overwhelmingly a
single table; prose is limited to a one-paragraph header
(booking id, env, content source, route/date) and an optional
one-line tail with the overall verdict.

Canonical column order: ``Booking ID | Validation | Verdict |
Explanation | Proof``. See
``.cursor/skills/qa_automation/references/report_format.md`` for the
spec and a worked example.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Literal

Verdict = Literal["PASS", "FAIL", "AMBIGUOUS", "SKIPPED"]
_VERDICTS: tuple[Verdict, ...] = ("PASS", "FAIL", "AMBIGUOUS", "SKIPPED")

_TABLE_HEADER = "| Booking ID | Validation | Verdict | Explanation | Proof |"
_TABLE_DIVIDER = "|------------|------------|---------|-------------|-------|"


@dataclass(frozen=True)
class ValidationRecord:
    """One row in the per-step report.

    ``proof`` is rendered verbatim into the table cell after pipe / newline
    escaping; the caller decides whether it's an inline-backticked query
    (e.g. `` `SELECT ...` ``) or a raw permalink URL.
    """

    booking_id: int | str
    validation: str
    verdict: Verdict
    explanation: str
    proof: str

    def __post_init__(self) -> None:
        if self.verdict not in _VERDICTS:
            raise ValueError(
                f"verdict must be one of {_VERDICTS!r}, got {self.verdict!r}"
            )
        if not self.validation.strip():
            raise ValueError("validation must be non-empty")
        if not self.explanation.strip():
            raise ValueError("explanation must be non-empty")
        if not self.proof.strip():
            raise ValueError("proof must be non-empty (query or permalink)")


@dataclass(frozen=True)
class ReportHeader:
    """Run-level context rendered as the report's first paragraph."""

    booking_id: int | str
    env: str
    site: str | None = None
    content_source: str | None = None
    route: str | None = None
    depart: str | None = None
    return_: str | None = None
    scenario_dir: str | None = None
    extras: dict[str, str] = field(default_factory=dict)


def overall_verdict(records: Iterable[ValidationRecord]) -> Verdict:
    """Reduce per-row verdicts to a run-level verdict.

    Priority: FAIL > AMBIGUOUS > SKIPPED > PASS. An empty record list is
    a SKIPPED run (nothing was validated).
    """
    seen: set[Verdict] = {r.verdict for r in records}
    if not seen:
        return "SKIPPED"
    if "FAIL" in seen:
        return "FAIL"
    if "AMBIGUOUS" in seen:
        return "AMBIGUOUS"
    if "PASS" in seen:
        return "PASS"
    return "SKIPPED"


def _escape_cell(value: str) -> str:
    """Make a string safe for a single markdown table cell.

    Pipes are escaped (``\\|``) so they don't split the cell, and embedded
    newlines collapse to a single space so the row stays on one line.
    """
    return (
        value.replace("\\", "\\\\")
        .replace("|", "\\|")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )


def _render_header(header: ReportHeader, total: int, verdict: Verdict) -> list[str]:
    bits: list[str] = [f"booking `{header.booking_id}`", f"env `{header.env}`"]
    if header.site:
        bits.append(f"site `{header.site}`")
    if header.content_source:
        bits.append(f"content source `{header.content_source}`")
    if header.route:
        route = header.route
        if header.depart:
            route = f"{route} on {header.depart}"
        if header.return_:
            route = f"{route} \u2192 {header.return_}"
        bits.append(route)
    elif header.depart:
        depart = header.depart
        if header.return_:
            depart = f"{depart} \u2192 {header.return_}"
        bits.append(depart)
    for key, val in header.extras.items():
        bits.append(f"{key} `{val}`")

    lines = ["# QA Validation Report", ""]
    lines.append(" \u2014 ".join(bits) + ".")
    lines.append("")
    lines.append(
        f"Overall verdict: **{verdict}** ({total} validation"
        f"{'s' if total != 1 else ''} run)."
    )
    if header.scenario_dir:
        lines.append("")
        lines.append(f"Scenario dir: `{header.scenario_dir}`")
    return lines


def render_report(header: ReportHeader, records: Iterable[ValidationRecord]) -> str:
    """Return the full markdown body for one QA run."""
    rows = list(records)
    verdict = overall_verdict(rows)
    lines = _render_header(header, total=len(rows), verdict=verdict)
    lines.append("")

    if not rows:
        lines.append("_No validations were exercised on this run._")
        lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    lines.append(_TABLE_HEADER)
    lines.append(_TABLE_DIVIDER)
    for r in rows:
        lines.append(
            "| "
            + " | ".join(
                _escape_cell(c)
                for c in (
                    str(r.booking_id),
                    r.validation,
                    r.verdict,
                    r.explanation,
                    r.proof,
                )
            )
            + " |"
        )
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_report(
    scenario_dir: Path | str,
    header: ReportHeader,
    records: Iterable[ValidationRecord],
    *,
    filename: str = "report.md",
) -> Path:
    """Write ``{scenario_dir}/{filename}`` and return its path."""
    out_dir = Path(scenario_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / filename
    out_path.write_text(render_report(header, records), encoding="utf-8")
    return out_path


__all__ = [
    "ReportHeader",
    "ValidationRecord",
    "Verdict",
    "overall_verdict",
    "render_report",
    "write_report",
]
