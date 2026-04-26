"""
Summit flight-search stats page.
Selectors live in `qa_automation.pages.selectors.SUMMIT` and are not yet
confirmed against the live Summit UI (Phase 3).
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
        self._page.fill('[name="username"], [name="user"], [type="text"]', os.environ["SUMMIT_USER"])
        self._page.fill('[name="password"], [type="password"]', os.environ["SUMMIT_PASS"])
        self.click("summit.login_submit", SUMMIT.login_submit)
        self.screenshot("summit-logged-in")

    def find_search_hash_row(self, search_hash: str) -> dict:
        """Return the stats row for this search_hash (columns as dict)."""
        self._page.goto(f"{self._base_url}/flight-search/info/")
        self.wait_for("summit.stats_table", SUMMIT.stats_table, timeout=15_000)
        self.screenshot("summit-stats-page")

        rows = self._page.locator(f"{SUMMIT.stats_table} tr").all()
        for row in rows:
            text = row.inner_text()
            if search_hash in text:
                cells = row.locator("td").all()
                return {str(i): c.inner_text() for i, c in enumerate(cells)}

        raise SelectorNotFound(
            "summit.stats_row",
            url=self._page.url,
            detail=f"search_hash={search_hash!r} not found in stats table",
        )
