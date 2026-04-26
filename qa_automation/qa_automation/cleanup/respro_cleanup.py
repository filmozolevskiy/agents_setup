"""
ResPro auto-cancel cleanup.

Invoked by `qa-cleanup` and any in-process caller that wants to free a test
booking. Cancel failure propagates — the runner CLI decides whether to exit
non-zero or treat as best-effort. The `is_test=1` backstop cron picks up
leaks anyway, so most callers can soften a failure to a warning.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import BrowserContext

from qa_automation.pages.respro_page import ResProPage
from qa_automation.utils.env import App, Env, resolve_url

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CleanupOutcome:
    cancelled: bool
    was_already_cancelled: bool


def cancel_booking(
    booking_id: int,
    browser_context: BrowserContext,
    scenario_dir: Path,
    qa_env: Env,
) -> CleanupOutcome:
    """Log into ResPro and cancel the booking. Idempotent.

    Returns an outcome dataclass. Exceptions from the page object propagate.
    """
    base_url = resolve_url(App.RESPRO, qa_env)
    page = browser_context.new_page()
    try:
        respro = ResProPage(page, scenario_dir, base_url)
        respro.login()
        cancelled_now = respro.cancel(booking_id)
        if cancelled_now:
            logger.info("[CLEANUP] booking %d cancelled via ResPro", booking_id)
        else:
            logger.info("[CLEANUP] booking %d already cancelled", booking_id)
        return CleanupOutcome(cancelled=True, was_already_cancelled=not cancelled_now)
    finally:
        page.close()
