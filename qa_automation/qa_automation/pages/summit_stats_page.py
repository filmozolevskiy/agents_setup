"""
Summit flight-search stats page.

All selectors marked ⚠️ — Summit UI has not been inspected; discover during Phase 0.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage

# ⚠️ Discover during Phase 0
_LOGIN_FORM = "form"
_LOGIN_SUBMIT = '[type="submit"]'
_STATS_TABLE = "table"


class SummitStatsPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url

    def login(self) -> None:
        self.goto(self._base_url)
        self._page.wait_for_selector(_LOGIN_FORM, timeout=10_000)
        self._page.fill('[name="username"], [name="user"], [type="text"]', os.environ["SUMMIT_USER"])
        self._page.fill('[name="password"], [type="password"]', os.environ["SUMMIT_PASS"])
        self._page.click(_LOGIN_SUBMIT)
        self.screenshot("summit-logged-in")

    def find_search_hash_row(self, search_hash: str) -> dict:
        """Return the stats row for this search_hash (columns as dict)."""
        self._page.goto(f"{self._base_url}/flight-search/info/")
        self._page.wait_for_selector(_STATS_TABLE, timeout=15_000)
        self.screenshot("summit-stats-page")

        rows = self._page.locator(f"{_STATS_TABLE} tr").all()
        for row in rows:
            text = row.inner_text()
            if search_hash in text:
                cells = row.locator("td").all()
                return {str(i): c.inner_text() for i, c in enumerate(cells)}

        raise AssertionError(
            f"[SUMMIT] search_hash={search_hash!r} not found in stats table"
        )
