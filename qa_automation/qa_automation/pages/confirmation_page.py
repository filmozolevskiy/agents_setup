"""
Booking confirmation page — /service/portal/detail/{id_hash}?signature=...
Selectors live in `qa_automation.pages.selectors.CONFIRMATION`.

The booking_id (integer) is not displayed on the page; it is resolved by
querying MySQL: SELECT id FROM ota.bookings WHERE id_hash = '{id_hash}'.
"""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import CONFIRMATION

_CONFIRMATION_TIMEOUT = 120_000


class ConfirmationPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        super().__init__(page, scenario_dir)
        self._id_hash: str | None = None

    def wait_for_confirmation(self) -> None:
        try:
            self._page.wait_for_url("**/service/portal/detail/**", timeout=_CONFIRMATION_TIMEOUT)
        except Exception as exc:
            raise SelectorNotFound(
                "confirmation.url",
                url=self._page.url,
                detail="page never navigated to /service/portal/detail/**",
            ) from exc
        self._page.wait_for_timeout(1_000)
        self.screenshot("booking-confirmed")
        self._id_hash = self._parse_id_hash()

    def _parse_id_hash(self) -> str:
        path = urlparse(self._page.url).path
        parts = [p for p in path.split("/") if p]
        if parts and parts[-1] != "detail":
            return parts[-1]
        raise SelectorNotFound(
            "confirmation.id_hash",
            url=self._page.url,
            detail="could not parse id_hash from portal URL",
        )

    @property
    def id_hash(self) -> str:
        if self._id_hash is None:
            raise SelectorNotFound(
                "confirmation.id_hash",
                detail="wait_for_confirmation() not called yet",
            )
        return self._id_hash

    def dismiss_post_booking_upsell(self) -> None:
        """Dismiss the post-booking Trip Cancellation Protection upsell if present."""
        no_btn = self._page.locator(CONFIRMATION.post_booking_no_thanks)
        if no_btn.count() > 0:
            no_btn.first.click()
            self._page.wait_for_timeout(1_000)
            self.screenshot("upsell-dismissed")
