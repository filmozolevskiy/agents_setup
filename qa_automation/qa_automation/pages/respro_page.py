"""
ResPro booking detail + cancel (abort) page.
Selectors live in `qa_automation.pages.selectors.RESPRO`.

Booking URL: /booking/index/{booking_id}. Cancel via "Override to Cancel" link
→ modal-cancel-trip → #btn-continue.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import RESPRO


class ResProPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path, base_url: str) -> None:
        super().__init__(page, scenario_dir)
        self._base_url = base_url
        self._logged_in = False

    def login(self) -> None:
        if self._logged_in:
            return
        self.goto(self._base_url)
        self.wait_for("respro.login_form", RESPRO.login_form, timeout=10_000)
        self.fill("respro.username_input", RESPRO.username_input, os.environ["RESPRO_USER"])
        self.fill("respro.password_input", RESPRO.password_input, os.environ["RESPRO_PASS"])
        self.click("respro.login_submit", RESPRO.login_submit)
        try:
            self._page.wait_for_url("**/home/**", timeout=15_000)
        except Exception as exc:
            raise SelectorNotFound(
                "respro.post_login_home",
                url=self._page.url,
                detail="did not reach /home/** after login submit",
            ) from exc
        self.screenshot("respro-logged-in")
        self._logged_in = True

    def open_booking(self, booking_id: int) -> None:
        url = f"{self._base_url}/booking/index/{booking_id}"
        self.goto(url)
        if "/login" in self._page.url:
            self._logged_in = False
            self.login()
            self.goto(url)
        self._page.wait_for_load_state("networkidle")
        self.screenshot("respro-booking-detail")

    def is_cancelled(self) -> bool:
        return self._page.locator(RESPRO.cancelled_status).count() > 0

    def cancel(self, booking_id: int) -> bool:
        """Abort the booking via ResPro. Returns True if cancelled this call, False if already cancelled.

        Idempotent — skips cancel if the booking is already cancelled.
        """
        self.open_booking(booking_id)

        if self.is_cancelled():
            return False

        self.click("respro.override_cancel_link", RESPRO.override_cancel_link)
        self._page.wait_for_timeout(2_000)

        self._page.select_option(RESPRO.abort_reason_select, value="test")
        self.fill("respro.abort_note_input", RESPRO.abort_note_input, "Automatic QA cancellation")
        self.click("respro.abort_submit", RESPRO.abort_submit)
        self._page.wait_for_timeout(5_000)

        self.screenshot("respro-cancelled")

        self.open_booking(booking_id)
        if not self.is_cancelled():
            raise SelectorNotFound(
                "respro.cancelled_status",
                url=self._page.url,
                detail=f"booking {booking_id} did not reach Cancelled status after abort",
            )
        return True
