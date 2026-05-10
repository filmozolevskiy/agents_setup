"""
qa-cleanup: cancel a test booking via ResPro. Idempotent.

Exits 0 whether the booking was cancelled this call or was already cancelled.
Non-zero only if the cancel attempt actively failed (selector not found, etc.).
"""
from __future__ import annotations

import argparse

from qa_automation.browser import launch_browser, launch_context
from qa_automation.cleanup.respro_cleanup import cancel_booking
from qa_automation.runners._common import (
    allocate_scenario_dir,
    die_from_exception,
    emit_ok,
    list_screenshots,
    load_env,
)
from qa_automation.utils.env import Env


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-cleanup",
        description="Cancel a test booking via ResPro. Idempotent.",
    )
    p.add_argument("--booking-id", type=int, required=True)
    p.add_argument("--scenario-dir", default=None)
    p.add_argument("--label", default=None)
    p.add_argument("--env", choices=["staging", "production"], default=None,
                   help="Override QA_ENV for this run (default: from env)")
    return p


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    scenario_dir = allocate_scenario_dir(
        args.label or f"cleanup-{args.booking_id}",
        existing=args.scenario_dir,
    )
    import os
    qa_env = Env(args.env) if args.env else Env(os.environ.get("QA_ENV", "staging").lower())

    try:
        with launch_browser() as (_, browser):
            with launch_context(browser, scenario_dir) as context:
                outcome = cancel_booking(
                    args.booking_id,
                    context,
                    scenario_dir,
                    qa_env,
                )

        emit_ok({
            "scenario_dir": scenario_dir,
            "booking_id": args.booking_id,
            "cancelled": outcome.cancelled,
            "was_already_cancelled": outcome.was_already_cancelled,
            "screenshots": list_screenshots(scenario_dir),
        })
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc, scenario_dir=scenario_dir)


if __name__ == "__main__":
    main()
