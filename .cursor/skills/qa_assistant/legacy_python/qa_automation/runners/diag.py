"""
qa-diag: probe every selector in ``pages/selectors.py`` against a live URL.

The agent invokes this first when a Playwright timeout looks like selector
rot. Output names each selector, whether it was found, and how many elements
matched. A screenshot is saved for visual diagnosis.
"""
from __future__ import annotations

import argparse

from qa_automation.browser import launch_browser, launch_context
from qa_automation.pages.selectors import VERIFIED_ON, all_selectors_for
from qa_automation.runners._common import (
    allocate_scenario_dir,
    die_from_exception,
    emit_error,
    emit_ok,
    list_screenshots,
    load_env,
)


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-diag",
        description="Probe every selector in pages/selectors.py against a URL.",
    )
    p.add_argument("--url", required=True)
    p.add_argument(
        "--page",
        required=True,
        choices=["search", "results", "checkout", "confirmation", "respro", "summit"],
    )
    p.add_argument("--label", default=None)
    p.add_argument("--timeout-ms", type=int, default=10_000,
                   help="How long to wait for the page to settle before probing")
    return p


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    try:
        selectors = all_selectors_for(args.page)
    except ValueError as exc:
        emit_error("unknown_page", detail=str(exc))

    scenario_dir = allocate_scenario_dir(args.label or f"diag-{args.page}")

    try:
        with launch_browser() as (_, browser):
            with launch_context(browser, scenario_dir) as context:
                page = context.new_page()
                page.goto(args.url, wait_until="networkidle")
                page.wait_for_timeout(args.timeout_ms)
                (scenario_dir / "001-diag-page.png").parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(scenario_dir / "001-diag-page.png"))

                probes = []
                for name, selector in selectors.items():
                    try:
                        count = page.locator(selector).count()
                    except Exception as exc:
                        probes.append({
                            "name": f"{args.page}.{name}",
                            "selector": selector,
                            "count": None,
                            "error": str(exc),
                        })
                        continue
                    probes.append({
                        "name": f"{args.page}.{name}",
                        "selector": selector,
                        "count": count,
                        "found": count > 0,
                    })

        missing = [p for p in probes if p.get("count") == 0]
        emit_ok({
            "scenario_dir": scenario_dir,
            "page_key": args.page,
            "url": args.url,
            "selectors_verified_on": VERIFIED_ON,
            "probes": probes,
            "missing_selectors": [p["name"] for p in missing],
            "screenshots": list_screenshots(scenario_dir),
        })
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc, scenario_dir=scenario_dir)


if __name__ == "__main__":
    main()
