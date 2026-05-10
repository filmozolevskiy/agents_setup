"""
ResPro booking detail + cancel (abort) page.
Selectors live in `qa_automation.pages.selectors.RESPRO`.

End-to-end cancel flow this page object drives:
  1. ``GET /``  → login form (``login_form`` / ``username_input`` /
     ``password_input`` / ``login_submit``); on success the app redirects to
     ``/home/index``.
  2. ``GET /booking/index/{booking_id}`` → booking detail. The red
     ``Override to Cancel`` link (``override_cancel_link``) is only present
     when the booking is *not* already cancelled.
  3. Click ``Override to Cancel`` → opens the in-page ``modal-cancel-trip``
     dialog containing ``#reason`` (``abort_reason_select``), ``#note``
     (``abort_note_input``) and ``#btn-continue`` (``abort_submit``).
  4. Submit → ResPro queues a *Work Order Process [Abort Booking]*. The
     booking only displays the red banner ``Cancelled: <reason>``
     (``cancelled_status``) once that work order has been picked up by the
     ResPro worker; on staging this can take 10–60 s, so we poll instead of
     a fixed sleep.
"""
from __future__ import annotations

import os
from pathlib import Path

from playwright.sync_api import Page, TimeoutError as PlaywrightTimeoutError

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import RESPRO


class ResProPage(BasePage):
    # Upper bound for waiting on the post-abort "Cancelled: ..." banner.
    # Empirically the work-order processor settles in 10–30 s on staging;
    # we give it a comfortable buffer before declaring real selector rot.
    _CANCELLED_BANNER_TIMEOUT_MS = 90_000
    _CANCELLED_BANNER_POLL_MS = 5_000

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

    def _wait_for_cancelled_banner(self, booking_id: int) -> None:
        """Poll the booking detail until the red ``Cancelled: …`` banner shows.

        ResPro's abort flow queues an async ``Work Order Process [Abort Booking]``
        and only repaints the banner once that worker resolves. We reload the
        booking detail every few seconds rather than blocking on a single
        ``wait_for_selector`` call, because the page itself does not
        auto-refresh.
        """
        deadline_ms = self._CANCELLED_BANNER_TIMEOUT_MS
        elapsed_ms = 0
        while elapsed_ms < deadline_ms:
            if self.is_cancelled():
                return
            self._page.wait_for_timeout(self._CANCELLED_BANNER_POLL_MS)
            elapsed_ms += self._CANCELLED_BANNER_POLL_MS
            # Reload booking detail so the next poll sees fresh state.
            self.goto(f"{self._base_url}/booking/index/{booking_id}")
            self._page.wait_for_load_state("networkidle")
        raise SelectorNotFound(
            "respro.cancelled_status",
            url=self._page.url,
            detail=(
                f"booking {booking_id} did not reach 'Cancelled: …' banner "
                f"within {deadline_ms // 1000}s after abort submit"
            ),
        )

    def cancel(self, booking_id: int) -> bool:
        """Abort the booking via ResPro. Returns True if cancelled this call, False if already cancelled.

        Idempotent — skips cancel if the booking is already cancelled.
        """
        self.open_booking(booking_id)

        if self.is_cancelled():
            return False

        self.click("respro.override_cancel_link", RESPRO.override_cancel_link)
        try:
            self._page.wait_for_selector(
                RESPRO.abort_reason_select, timeout=10_000, state="visible"
            )
        except PlaywrightTimeoutError as exc:
            raise SelectorNotFound(
                "respro.abort_reason_select",
                url=self._page.url,
                detail="modal-cancel-trip dialog never rendered after Override to Cancel",
            ) from exc

        self._page.select_option(RESPRO.abort_reason_select, value="test")
        self.fill("respro.abort_note_input", RESPRO.abort_note_input, "Automatic QA cancellation")
        self.click("respro.abort_submit", RESPRO.abort_submit)

        self._wait_for_cancelled_banner(booking_id)
        self.screenshot("respro-cancelled")
        return True
