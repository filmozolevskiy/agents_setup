"""
Base page object + selector-aware wrappers around Playwright.

Every page subclass should call `self.wait_for(...)` and `self.click(...)`
instead of raw Playwright calls so that `TimeoutError`s turn into
`SelectorNotFound` with the failing selector's canonical name (e.g.
`"search.submit_btn"`). Runners propagate that name to the agent in the
error JSON body.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from playwright.sync_api import Locator, Page, TimeoutError as PlaywrightTimeoutError


class SelectorNotFound(Exception):
    """Raised when a named selector cannot be found or interacted with.

    ``name`` is the canonical selector key (e.g. ``"search.submit_btn"``).
    Runners surface this name in their error JSON so the agent can pinpoint
    the failing selector without reading Playwright tracebacks.
    """

    def __init__(
        self,
        name: str,
        *,
        url: str | None = None,
        screenshot: str | None = None,
        detail: str | None = None,
    ) -> None:
        self.name = name
        self.url = url
        self.screenshot = screenshot
        self.detail = detail
        parts = [f"selector_not_found[{name}]"]
        if url:
            parts.append(f"url={url}")
        if detail:
            parts.append(detail)
        super().__init__(" — ".join(parts))


class BasePage:
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        self._page = page
        self._scenario_dir = scenario_dir
        self._step = 0

    # ---------- file helpers ----------

    def screenshot(self, name: str) -> Path:
        self._step += 1
        path = self._scenario_dir / f"{self._step:03d}-{name}.png"
        self._scenario_dir.mkdir(parents=True, exist_ok=True)
        self._page.screenshot(path=str(path))
        return path

    # ---------- navigation ----------

    def goto(self, url: str, wait_until: str = "networkidle") -> None:
        self._page.goto(url, wait_until=wait_until)

    # ---------- selector-aware wrappers ----------

    def wait_for(self, name: str, selector: str, *, timeout: int = 10_000, state: str = "visible") -> Locator:
        """Wait for selector to reach ``state`` within ``timeout`` ms.

        Raises ``SelectorNotFound(name)`` with a screenshot on timeout.
        """
        try:
            self._page.wait_for_selector(selector, timeout=timeout, state=state)
        except PlaywrightTimeoutError as exc:
            shot = self._safe_screenshot(f"missing-{name.replace('.', '-')}")
            raise SelectorNotFound(
                name, url=self._page.url, screenshot=str(shot) if shot else None,
                detail=f"wait_for_selector({selector!r}, state={state!r}) timed out after {timeout}ms",
            ) from exc
        return self._page.locator(selector)

    def click(self, name: str, selector: str, *, timeout: int = 10_000, force: bool = False) -> None:
        """Click a named selector. Raises ``SelectorNotFound(name)`` on failure."""
        try:
            self._page.locator(selector).first.click(timeout=timeout, force=force)
        except PlaywrightTimeoutError as exc:
            shot = self._safe_screenshot(f"click-failed-{name.replace('.', '-')}")
            raise SelectorNotFound(
                name, url=self._page.url, screenshot=str(shot) if shot else None,
                detail=f"click({selector!r}) timed out after {timeout}ms",
            ) from exc

    def fill(self, name: str, selector: str, value: str, *, timeout: int = 10_000) -> None:
        try:
            self._page.locator(selector).first.fill(value, timeout=timeout)
        except PlaywrightTimeoutError as exc:
            shot = self._safe_screenshot(f"fill-failed-{name.replace('.', '-')}")
            raise SelectorNotFound(
                name, url=self._page.url, screenshot=str(shot) if shot else None,
                detail=f"fill({selector!r}) timed out after {timeout}ms",
            ) from exc

    def _safe_screenshot(self, name: str) -> Path | None:
        try:
            return self.screenshot(name)
        except Exception:
            return None

    # ---------- accessors ----------

    @property
    def page(self) -> Page:
        return self._page

    @property
    def scenario_dir(self) -> Path:
        return self._scenario_dir
