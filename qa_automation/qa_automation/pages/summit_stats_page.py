"""
Summit flight-search stats page.
Selectors live in `qa_automation.pages.selectors.SUMMIT`. Confirmed against
the live Summit UI on 2026-04-26 — see ``page_inventory.md`` § 6.

End-to-end flow this page object drives:
  1. ``GET /``  → ``form.login-form`` with ``#email`` / ``#password`` inputs
     and a ``#process-login`` submit. Successful login redirects to
     ``/sites`` (Sites Management dashboard).
  2. ``GET /flight-search/info/{search_id}`` → ``#flightSearchStats``
     container holding the ``#searchIdForm`` lookup form and, if the
     search is still in cache, a ``fieldset.stats`` summary plus
     ``fieldset#urlStats table`` of API call rows. Stats expire ~20 min
     after the search runs (see the ``Expire at`` line in the summary),
     so callers should be prepared for ``selector_not_found[summit.stats_row]``
     on stale hashes.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import SUMMIT


class SummitStatsPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url

    def login(self) -> None:
        self.goto(self._base_url)
        self.wait_for("summit.login_form", SUMMIT.login_form, timeout=10_000)
        self.fill("summit.username_input", SUMMIT.username_input, os.environ["SUMMIT_USER"])
        self.fill("summit.password_input", SUMMIT.password_input, os.environ["SUMMIT_PASS"])
        self.click("summit.login_submit", SUMMIT.login_submit)
        self.screenshot("summit-logged-in")

    def find_search_hash_row(self, search_hash: str) -> dict[str, str]:
        """Return the ``fieldset.stats`` summary for ``search_hash`` as a dict.

        Navigates straight to ``/flight-search/info/{search_hash}`` (the
        ``#searchIdForm`` text input on the lookup page does the same redirect
        behind the scenes — bypass it).

        Returns a ``{label: value}`` mapping built from the ``<dl><dt>…</dt>
        <dd>…</dd></dl>`` pairs inside ``fieldset.stats`` — e.g.
        ``{"Search id": "...", "Started": "yes", "Completed": "yes",
        "Packages count": "545", "Runtime": "8s", ...}``.

        Raises ``SelectorNotFound("summit.stats_row")`` when the keyed URL
        renders without a stats summary — the most common cause is the search
        having aged out of Summit's in-memory store (the page renders an
        ``Error: Search not found`` fieldset instead).
        """
        self._page.goto(f"{self._base_url}/flight-search/info/{search_hash}")
        self.wait_for("summit.stats_container", SUMMIT.stats_container, timeout=15_000)
        self.screenshot("summit-stats-page")

        if self._page.locator(SUMMIT.stats_row).count() == 0:
            raise SelectorNotFound(
                "summit.stats_row",
                url=self._page.url,
                detail=(
                    f"search_hash={search_hash!r} has no fieldset.stats summary "
                    "— search expired (typically ~20m after run) or selector rot"
                ),
            )

        result: dict[str, str] = {}
        dt_locator = self._page.locator(f"{SUMMIT.stats_row} dl dt")
        dd_locator = self._page.locator(f"{SUMMIT.stats_row} dl dd")
        for i in range(dt_locator.count()):
            label = dt_locator.nth(i).inner_text().strip()
            value = dd_locator.nth(i).inner_text().strip() if i < dd_locator.count() else ""
            if label:
                result[label] = value
        return result
