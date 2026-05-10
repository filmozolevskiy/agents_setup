"""
Network interception helpers.

``capture_storefront_transaction_id(page)`` registers a response listener that
looks for the first storefront-api search response and extracts a
``transaction_id`` (a.k.a. ``search_hash`` / Mongo ``debug_transaction_id``).

Use it immediately after creating a new page, before kicking off the search:

    capture = capture_storefront_transaction_id(page)
    # ... drive the search form ...
    tx_id = capture.value  # str | None
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from playwright.sync_api import Page, Response

# Storefront search URL patterns observed on staging2.
# Keep loose; different staging builds use slightly different paths.
_SEARCH_URL_RE = re.compile(
    r"(?:^|/)(storefront-api|storefrontapi|storefront)/.*(search|flights?)",
    re.IGNORECASE,
)

_TX_ID_KEYS = (
    "transaction_id",
    "search_hash",
    "debug_transaction_id",
    "search_id",
)


@dataclass
class TransactionIdCapture:
    value: str | None = None
    source_url: str | None = None
    candidate_urls: list[str] = field(default_factory=list)


def _extract_tx_id(obj: Any) -> str | None:
    """Walk a nested JSON structure looking for one of the known key names."""
    if isinstance(obj, dict):
        for k in _TX_ID_KEYS:
            v = obj.get(k)
            if isinstance(v, str) and v:
                return v
        for v in obj.values():
            found = _extract_tx_id(v)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = _extract_tx_id(item)
            if found:
                return found
    return None


def capture_storefront_transaction_id(page: Page) -> TransactionIdCapture:
    """Register a one-shot listener that records the first storefront transaction_id.

    The listener stays active for the life of the page. Reading ``capture.value``
    at any later point returns the most recent hit (or ``None`` if nothing
    matched yet).
    """
    capture = TransactionIdCapture()

    def _on_response(response: Response) -> None:
        url = response.url
        if not _SEARCH_URL_RE.search(url):
            return
        capture.candidate_urls.append(url)
        if capture.value is not None:
            return
        try:
            payload = response.json()
        except Exception:
            return
        tx_id = _extract_tx_id(payload)
        if tx_id:
            capture.value = tx_id
            capture.source_url = url

    page.on("response", _on_response)
    return capture
