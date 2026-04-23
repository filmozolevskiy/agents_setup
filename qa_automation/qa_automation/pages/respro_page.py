"""
ResPro booking detail + cancel (abort) page.

Selectors confirmed 2026-04-21 against reservations.voyagesalacarte.ca.
Login lands on /home/index (Manager, Fulfillment role).
Booking URL: /booking/index/{booking_id} (no /internal/ prefix).
Cancel via "Override to Cancel" link → modal-cancel-trip → #abort-form.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage

_LOGIN_FORM = "form"
_USERNAME_INPUT = '[name="username"]'
_PASSWORD_INPUT = '[name="password"]'
_LOGIN_SUBMIT = 'input[type="submit"]'
_OVERRIDE_CANCEL_LINK = 'text=Override to Cancel'
# Modal abort form opened by requestCancelOverride() → /booking/modal-cancel-trip/{id}
_ABORT_REASON_SELECT = '#reason'
_ABORT_NOTE_INPUT = '#note'
_ABORT_SUBMIT = '#btn-continue'   # <a id="btn-continue"> Abort
_CANCELLED_STATUS = 'text=Cancelled:'


class ResProPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url
        self._logged_in = False

    def login(self) -> None:
        if self._logged_in:
            return
        self.goto(self._base_url)
        self._page.wait_for_selector(_LOGIN_FORM, timeout=10_000)
        self._page.fill(_USERNAME_INPUT, os.environ["RESPRO_USER"])
        self._page.fill(_PASSWORD_INPUT, os.environ["RESPRO_PASS"])
        self._page.click(_LOGIN_SUBMIT)
        # Lands on /home/index after successful login
        self._page.wait_for_url("**/home/**", timeout=15_000)
        self.screenshot("respro-logged-in")
        self._logged_in = True

    def open_booking(self, booking_id: int) -> None:
        url = f"{self._base_url}/booking/index/{booking_id}"
        self.goto(url)
        # If session expired, re-authenticate
        if "/login" in self._page.url:
            self._logged_in = False
            self.login()
            self.goto(url)
        self._page.wait_for_load_state("networkidle")
        self.screenshot("respro-booking-detail")

    def is_cancelled(self) -> bool:
        return self._page.locator(_CANCELLED_STATUS).count() > 0

    def cancel(self, booking_id: int) -> None:
        """Abort the booking via ResPro. Idempotent — skips if already cancelled."""
        self.open_booking(booking_id)

        if self.is_cancelled():
            return  # already cancelled — idempotent

        # Click "Override to Cancel" → opens /booking/modal-cancel-trip modal
        self._page.click(_OVERRIDE_CANCEL_LINK)
        self._page.wait_for_timeout(2_000)

        self._page.select_option(_ABORT_REASON_SELECT, value="test")
        self._page.fill(_ABORT_NOTE_INPUT, "Automatic QA cancellation")
        self._page.click(_ABORT_SUBMIT)
        # Wait for the AJAX cancel to complete and page to update
        self._page.wait_for_timeout(5_000)

        self.screenshot("respro-cancelled")

        # Reload and assert cancelled status
        self.open_booking(booking_id)
        assert self.is_cancelled(), (
            f"[RESPRO] booking {booking_id} — expected Cancelled status after abort"
        )
