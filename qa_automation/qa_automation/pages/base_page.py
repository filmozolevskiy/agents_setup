from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page


class BasePage:
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        self._page = page
        self._scenario_dir = scenario_dir
        self._step = 0

    def screenshot(self, name: str) -> Path:
        self._step += 1
        path = self._scenario_dir / f"{self._step:03d}-{name}.png"
        self._scenario_dir.mkdir(parents=True, exist_ok=True)
        self._page.screenshot(path=str(path))
        return path

    def goto(self, url: str, wait_until: str = "networkidle") -> None:
        self._page.goto(url, wait_until=wait_until)

    @property
    def page(self) -> Page:
        return self._page
