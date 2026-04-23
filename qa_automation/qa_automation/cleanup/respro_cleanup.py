"""
ResPro auto-cancel cleanup.
Invoked after all assertions when scenario.cleanup == 'auto'.
Cancel failure is a WARNING only — does not fail the test (is_test=1 backstop).
"""
from __future__ import annotations

import logging
from pathlib import Path

from playwright.sync_api import BrowserContext

from qa_automation.pages.respro_page import ResProPage
from qa_automation.utils.env import App, Env, resolve_url

logger = logging.getLogger(__name__)


def cancel_booking(
    booking_id: int,
    browser_context: BrowserContext,
    scenario_dir: Path,
    qa_env: Env,
) -> None:
    base_url = resolve_url(App.RESPRO, qa_env)
    page = browser_context.new_page()
    try:
        respro = ResProPage(page, scenario_dir, base_url)
        respro.login()
        respro.cancel(booking_id)
        logger.info("[CLEANUP] booking %d cancelled via ResPro", booking_id)
    except Exception as exc:
        logger.warning(
            "[CLEANUP] ResPro cancel FAILED for booking %d — %s. "
            "is_test=1 backstop will handle cleanup via CancelTestBookings cron.",
            booking_id,
            exc,
        )
    finally:
        page.close()
