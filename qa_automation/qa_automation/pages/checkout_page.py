"""
Checkout page — /checkout/billing/flight/{package_id}/{hash_key}?
Phase 0 confirmed selectors (staging2.flighthub.com, 2026-04-20).

Key differences from the Casper-era plan:
- URL has two path segments (package_id, hash_key) not just query params
- ?af=1 does NOT work; autofill is triggered by clicking the "Autofill" link
  which adds ?af={code} (user-specific test code)
- Insurance protection requires an explicit decline before submit
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage

_AUTOFILL_LINK = 'a:has-text("Autofill")'
_SUBMIT_BTN = "#submit_booking"
_NO_INSURANCE = 'label:has-text("No thanks")'

# Payment fields (pre-filled by autofill, can be overridden)
_CC_NUMBER = "#cc_number"
_CC_CVV = "#cc_cvv"
_CC_EXPIRY = "#cc_expiry"
_CC_NAME = "#cc_name"

# Passenger fields
_P1_FIRST_NAME = "#p1_first_name"
_P1_LAST_NAME = "#p1_last_name"

_CHECKOUT_LOAD_TIMEOUT = 60_000
_COOKIE_BANNER = "text=This website utilizes technologies"
_COOKIE_ACCEPT = "button:has-text('Accept All'), button:has-text('Reject All')"


class CheckoutPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        super().__init__(page, scenario_dir)

    def wait_for_load(self) -> None:
        self._page.wait_for_url("**/checkout/billing/flight/**", timeout=_CHECKOUT_LOAD_TIMEOUT)
        self._page.wait_for_selector(_AUTOFILL_LINK, timeout=30_000)
        self._page.wait_for_timeout(1_000)
        self._dismiss_cookie_banner()
        self.screenshot("checkout-loaded")

    def _dismiss_cookie_banner(self) -> None:
        """Dismiss the cookie consent banner if present (it overlaps form elements)."""
        try:
            btn = self._page.locator(_COOKIE_ACCEPT)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                self._page.wait_for_timeout(300)
        except Exception:
            pass

    def autofill(self) -> None:
        """Click the staging Autofill link to pre-fill passenger + payment data."""
        self._page.locator(_AUTOFILL_LINK).first.click()
        # After click the page reloads with ?af= param — wait for URL change first.
        try:
            self._page.wait_for_url("**?af=*", timeout=30_000)
        except Exception:
            pass
        self._page.wait_for_timeout(2_000)
        self._dismiss_cookie_banner()
        self.screenshot("checkout-after-autofill")

        # Wait for the submit button to appear — this is the definitive signal that
        # the React form has fully mounted. 120 s covers slow staging instances.
        try:
            self._page.wait_for_selector(_SUBMIT_BTN, timeout=120_000)
        except Exception:
            self.screenshot("checkout-react-mount-failed")
            raise RuntimeError(
                "Checkout form failed to render submit button within 120 s after autofill. "
                "Likely a backend API error for this package. Retry or pick a different flight."
            )

        self._page.wait_for_timeout(1_000)
        self.screenshot("checkout-autofilled")

    def override_card(self, number: str, expiry: str, cvv: str, name: str) -> None:
        """Override the card pre-filled by autofill."""
        self._page.fill(_CC_NUMBER, number)
        self._page.fill(_CC_EXPIRY, expiry)
        self._page.fill(_CC_CVV, cvv)
        self._page.fill(_CC_NAME, name)

    def decline_insurance(self) -> None:
        """Decline cancellation protection — required before submit."""
        self._page.evaluate("""() => {
            const labels = Array.from(document.querySelectorAll('label'));
            const no = labels.find(l => l.textContent.toLowerCase().includes('no thanks'));
            if (no) no.click();
        }""")
        self._page.wait_for_timeout(300)

    def get_price_summary(self) -> tuple[float | None, str | None]:
        """Return (total_amount, currency_code) as displayed on the checkout page.

        Tries several selectors/patterns common to FlightHub/JustFly checkout.
        Returns (None, None) if the price cannot be reliably extracted — the
        statement_items check will then skip the "shown vs charged" comparison.
        """
        result = self._page.evaluate("""() => {
            // Patterns: look for a total-price container then extract
            // currency+amount from its text content.
            const patterns = [
                '[class*="totalPrice"]',
                '[class*="total-price"]',
                '[class*="price-total"]',
                '[class*="grandTotal"]',
                '[class*="grand-total"]',
                '[class*="TotalPrice"]',
            ];
            for (const sel of patterns) {
                const el = document.querySelector(sel);
                if (!el) continue;
                const text = el.innerText || el.textContent || '';
                // e.g. "USD 315.39" or "$315.39" or "CAD 315.39"
                let m = text.match(/\\b([A-Z]{3})\\s*([\\d,]+\\.\\d{2})\\b/);
                if (m) return { currency: m[1], amount: parseFloat(m[2].replace(/,/g, '')) };
                m = text.match(/\\$([\\d,]+\\.\\d{2})/);
                if (m) return { currency: 'USD', amount: parseFloat(m[1].replace(/,/g, '')) };
            }
            return null;
        }""")
        if result and result.get("amount") and result["amount"] > 0:
            return float(result["amount"]), str(result["currency"])
        return None, None

    def submit(self) -> None:
        # Wait for submit button to become enabled (price summary must finish loading).
        self._page.wait_for_selector(f"{_SUBMIT_BTN}:not([disabled])", timeout=30_000)
        btn = self._page.locator(_SUBMIT_BTN)
        btn.scroll_into_view_if_needed()
        self._page.wait_for_timeout(500)
        self.screenshot("before-submit")
        btn.click()
