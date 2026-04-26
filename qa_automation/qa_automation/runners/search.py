"""
qa-search: drive the homepage search form, land on /flight/search, enumerate
packages and the Debug Filters content-source list, print JSON and exit.

No booking is initiated. Output feeds ``qa-book`` and (optionally)
``qa-search-telemetry``.
"""
from __future__ import annotations

import argparse
import datetime as dt

from qa_automation.browser import launch_browser, launch_context
from qa_automation.network import capture_storefront_transaction_id
from qa_automation.pages.results_page import ResultsPage
from qa_automation.pages.search_page import SearchPage
from qa_automation.runners._common import (
    allocate_scenario_dir,
    die_from_exception,
    emit_ok,
    list_screenshots,
    load_env,
)
from qa_automation.utils.env import App, resolve_url


def _build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="qa-search",
        description="Drive the FlightHub/JustFly search form and enumerate packages.",
    )
    p.add_argument("--site", choices=["flighthub", "justfly"], default="flighthub")
    p.add_argument("--trip-type", choices=["oneway", "roundtrip"], default="oneway")
    p.add_argument("--origin", required=True, help="IATA code, e.g. YUL")
    p.add_argument("--dest", required=True, help="IATA code, e.g. LAX")
    p.add_argument(
        "--origin-hint",
        default=None,
        help="Autocomplete display hint, e.g. 'YUL - Montreal'. Defaults to the IATA code.",
    )
    p.add_argument("--depart", required=True, help="YYYY-MM-DD")
    p.add_argument("--return", dest="return_", default=None, help="YYYY-MM-DD (roundtrip only)")
    p.add_argument("--adt", type=int, default=1)
    p.add_argument("--chd", type=int, default=0)
    p.add_argument("--inf", type=int, default=0)
    p.add_argument("--pos", default=None, help="Point-of-sale hint (informational only)")
    p.add_argument("--currency", default=None, help="Currency hint (informational only)")
    p.add_argument("--label", default=None, help="Scenario dir suffix under qa_automation/reports/")
    p.add_argument("--max-packages", type=int, default=20, help="Cap on DOM package enumeration")
    return p


def _parse_date(s: str) -> dt.date:
    return dt.datetime.strptime(s, "%Y-%m-%d").date()


def main() -> None:
    load_env()
    args = _build_arg_parser().parse_args()

    scenario_dir = allocate_scenario_dir(args.label or f"search-{args.origin}-{args.dest}")
    site_app = App.FLIGHTHUB if args.site == "flighthub" else App.JUSTFLY
    base_url = resolve_url(site_app)

    try:
        depart = _parse_date(args.depart)
        return_date = _parse_date(args.return_) if args.return_ else None
        if args.trip_type == "roundtrip" and return_date is None:
            raise ValueError("--return is required for --trip-type roundtrip")

        with launch_browser() as (_, browser):
            with launch_context(browser, scenario_dir) as context:
                page = context.new_page()
                tx_capture = capture_storefront_transaction_id(page)

                search = SearchPage(page, scenario_dir, base_url)
                search.load()
                search.set_trip_type(args.trip_type)

                origin_hint = args.origin_hint or args.origin
                search.fill_origin(args.origin, origin_hint)
                search.fill_destination(args.dest)
                search.fill_dates(depart, return_date)

                search.set_passengers(args.adt, args.chd, args.inf)
                results_page_handle = search.submit()

                results = ResultsPage(results_page_handle, scenario_dir)
                results.wait_for_results()
                # Give XHR a moment to settle before reading tx_capture.
                results_page_handle.wait_for_timeout(1_500)

                debug_sources = results.list_debug_filter_sources()
                packages = results.enumerate_packages(max_count=args.max_packages)

                emit_ok({
                    "scenario_dir": scenario_dir,
                    "site": args.site,
                    "base_url": base_url,
                    "search_url": results_page_handle.url,
                    "search_pos": args.pos,
                    "search_currency_hint": args.currency,
                    "trip_type": args.trip_type,
                    "origin": args.origin,
                    "dest": args.dest,
                    "depart": args.depart,
                    "return": args.return_,
                    "pax": {"adt": args.adt, "chd": args.chd, "inf": args.inf},
                    "transaction_id": tx_capture.value,
                    "transaction_id_source_url": tx_capture.source_url,
                    "transaction_id_candidate_urls": tx_capture.candidate_urls[:5],
                    "packages": packages,
                    "debug_filter_sources": debug_sources,
                    "screenshots": list_screenshots(scenario_dir),
                })
    except SystemExit:
        raise
    except BaseException as exc:
        die_from_exception(exc, scenario_dir=scenario_dir)


if __name__ == "__main__":
    main()
