"""
Booking confirmation page — /service/portal/detail/{id_hash}?signature=...
Phase 0 confirmed selectors (staging2.flighthub.com, 2026-04-20).

The booking_id (integer) is not displayed on the page; it is resolved by
querying MySQL: SELECT id FROM ota.bookings WHERE id_hash = '{id_hash}'.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage

_SUCCESS_TEXT = "Your booking was successfully completed!"
_POST_BOOKING_NO_THANKS = 'button:has-text("No, I don\'t want to receive these benefits")'

_CONFIRMATION_TIMEOUT = 120_000


class ConfirmationPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        super().__init__(page, scenario_dir)
        self._id_hash: str | None = None

    def wait_for_confirmation(self) -> None:
        self._page.wait_for_url("**/service/portal/detail/**", timeout=_CONFIRMATION_TIMEOUT)
        self._page.wait_for_timeout(1_000)
        self.screenshot("booking-confirmed")
        self._id_hash = self._parse_id_hash()

    def _parse_id_hash(self) -> str:
        path = urlparse(self._page.url).path
        # path = /service/portal/detail/{id_hash}
        parts = [p for p in path.split("/") if p]
        assert parts[-1] != "detail", "Could not parse id_hash from portal URL"
        return parts[-1]

    @property
    def id_hash(self) -> str:
        assert self._id_hash is not None, "wait_for_confirmation() not called yet"
        return self._id_hash

    def dismiss_post_booking_upsell(self) -> None:
        """Dismiss the post-booking Trip Cancellation Protection upsell if present."""
        no_btn = self._page.locator(_POST_BOOKING_NO_THANKS)
        if no_btn.count() > 0:
            no_btn.first.click()
            self._page.wait_for_timeout(1_000)
            self.screenshot("upsell-dismissed")
