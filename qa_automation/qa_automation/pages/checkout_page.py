"""
Checkout page — /checkout/billing/flight/{package_id}/{hash_key}?
Selectors live in `qa_automation.pages.selectors.CHECKOUT`.

Autofill is triggered by clicking the "Autofill" link which appends ?af={code}.
Insurance protection requires an explicit decline before submit; otherwise the
form rejects the submit with "Please select an option to proceed".
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

from qa_automation.pages.base_page import BasePage, SelectorNotFound
from qa_automation.pages.selectors import CHECKOUT

_CHECKOUT_LOAD_TIMEOUT = 60_000


def _safe_label(text: str) -> str:
    """Filename-safe slug for label-driven screenshot names."""
    return "".join(
        ch.lower() if ch.isalnum() else "-" for ch in text
    ).strip("-") or "label"


class CheckoutRenderTimeout(Exception):
    """Submit button did not render within the allotted window after autofill."""


class CheckoutPage(BasePage):
    def __init__(self, page: Page, scenario_dir: Path) -> None:
        super().__init__(page, scenario_dir)

    def wait_for_load(self) -> None:
        try:
            self._page.wait_for_url("**/checkout/billing/flight/**", timeout=_CHECKOUT_LOAD_TIMEOUT)
        except Exception as exc:
            raise SelectorNotFound(
                "checkout.url",
                url=self._page.url,
                detail="page never navigated to /checkout/billing/flight/**",
            ) from exc
        self.wait_for("checkout.autofill_link", CHECKOUT.autofill_link, timeout=30_000)
        self._page.wait_for_timeout(1_000)
        self._dismiss_cookie_banner()
        self.screenshot("checkout-loaded")

    def _dismiss_cookie_banner(self) -> None:
        try:
            btn = self._page.locator(CHECKOUT.cookie_accept)
            if btn.count() > 0 and btn.first.is_visible():
                btn.first.click()
                self._page.wait_for_timeout(300)
        except Exception:
            pass

    def autofill(self) -> None:
        """Click the staging Autofill link to pre-fill passenger + payment data."""
        self.click("checkout.autofill_link", CHECKOUT.autofill_link)
        try:
            self._page.wait_for_url("**?af=*", timeout=30_000)
        except Exception:
            pass
        self._page.wait_for_timeout(2_000)
        self._dismiss_cookie_banner()
        self.screenshot("checkout-after-autofill")

        # React form may take 30-90s to fully mount on staging; for multi-pax
        # family bookings (3 pax forms) via consolidator LCC content it can
        # take longer. Give it 240s.
        #
        # Two-stage checkouts (LCC/consolidator) render a "Continue to payment"
        # button on stage 1 and only create #submit_booking after that's
        # clicked. Accept either as "form is ready" — the advance step runs
        # in advance_to_payment_if_needed() after insurance/debug toggles.
        deadline_ms = 240_000
        poll_interval_ms = 5_000
        elapsed = 0
        found = False
        while elapsed < deadline_ms:
            has_submit = self._page.locator(CHECKOUT.submit_btn).count() > 0
            has_continue = (
                self._page.locator(CHECKOUT.continue_to_payment_btn).count() > 0
            )
            if has_submit or has_continue:
                found = True
                break
            try:
                self._page.evaluate(
                    "window.scrollTo(0, document.body.scrollHeight)"
                )
            except Exception:
                pass
            self._page.wait_for_timeout(poll_interval_ms)
            elapsed += poll_interval_ms
        if not found:
            self.screenshot("checkout-react-mount-failed")
            raise CheckoutRenderTimeout(
                f"Checkout form failed to render submit or continue-to-payment "
                f"button within {deadline_ms // 1000}s after autofill. Likely a "
                f"backend API error for this package. Retry or pick a different "
                f"flight."
            )

        self._page.wait_for_timeout(1_000)
        self.screenshot("checkout-autofilled")

    def advance_to_payment_if_needed(self) -> None:
        """For two-stage checkouts, click "Continue to payment" and wait for
        the payment form (``#submit_booking``) to render.

        No-op if the page is already showing ``#submit_booking`` (single-stage
        flow). Must run after declining insurances and setting any debug
        toggles, since those controls live on stage 1 below the CTA.
        """
        if self._page.locator(CHECKOUT.submit_btn).count() > 0:
            return
        cta = self._page.locator(CHECKOUT.continue_to_payment_btn).first
        if cta.count() == 0:
            return
        try:
            cta.scroll_into_view_if_needed(timeout=5_000)
        except Exception:
            pass
        self.screenshot("before-continue-to-payment")
        cta.click(timeout=15_000)
        self._page.wait_for_timeout(1_000)
        try:
            self._page.wait_for_selector(CHECKOUT.submit_btn, timeout=120_000)
        except Exception as exc:
            self.screenshot("payment-stage-mount-failed")
            raise CheckoutRenderTimeout(
                "Clicked 'Continue to payment' but payment stage never "
                "rendered #submit_booking within 120s. Likely a backend API "
                "error on the payment stage for this package."
            ) from exc
        self.screenshot("payment-stage-ready")

    def override_card(self, number: str, expiry: str, cvv: str, name: str) -> None:
        """Override the card pre-filled by autofill."""
        self.fill("checkout.cc_number", CHECKOUT.cc_number, number)
        self.fill("checkout.cc_expiry", CHECKOUT.cc_expiry, expiry)
        self.fill("checkout.cc_cvv", CHECKOUT.cc_cvv, cvv)
        self.fill("checkout.cc_name", CHECKOUT.cc_name, name)

    def disable_optimizer(self) -> None:
        """Set the "Disable Optimizer/Repricer" toggle to Yes.

        Required when booking against a specific content source
        (``--content-source`` in ``qa-book``): otherwise the optimizer
        can reprice/reroute the candidate to a different provider (e.g.
        ``atlas`` → ``Tripstack``) and the booking no longer tests what
        we asked for. The Debugging Options panel renders on **both
        staging and production** (verified 2026-04-26), so this method
        is wired the same way on both envs.

        Uses Playwright's native ``select_option`` so React's onChange
        fires correctly; a raw ``element.value = ...`` + dispatchEvent
        dance has been observed to be overwritten by React on the next
        render.
        """
        # The debug panel is at the bottom; scroll to force it into view so
        # React is more likely to have it mounted.
        try:
            self._page.evaluate(
                "window.scrollTo(0, document.body.scrollHeight)"
            )
        except Exception:
            pass
        self._page.wait_for_timeout(300)
        label_text = CHECKOUT.disable_optimizer_label_text
        # Find a <select> whose nearest ancestor row contains the label text.
        # Staging markup: <div><label>Disable Optimizer/Repricer</label><select>…</select></div>
        candidates = [
            f'div:has(label:has-text("{label_text}")) select',
            f'label:has-text("{label_text}") + select',
            f'div:has(:text("{label_text}")) select',
        ]
        last_err: Exception | None = None
        for sel_css in candidates:
            loc = self._page.locator(sel_css).first
            if loc.count() == 0:
                continue
            try:
                loc.scroll_into_view_if_needed(timeout=2_000)
                loc.select_option(label="Yes", timeout=5_000)
                self._page.wait_for_timeout(300)
                self.screenshot("optimizer-disabled")
                return
            except Exception as exc:
                last_err = exc
                continue
        raise SelectorNotFound(
            "checkout.disable_optimizer",
            url=self._page.url,
            detail=(
                "Could not find + set Debugging Options 'Disable Optimizer/Repricer' "
                "select on the checkout page. Booking a specific content source "
                "without this toggle lets the optimizer reroute to another "
                f"provider and invalidates the source-specific test. "
                f"Last error: {last_err!r}"
            ),
        )

    def set_booking_failure_reason(self, reason_label: str) -> None:
        """Force a controlled failure via the "Booking Failure Reason" select.

        Pick from the labels exposed by the Debugging Options panel — at
        the time of writing those are ``CC Decline``, ``Fraud``,
        ``Fare Increase``, ``Flight Not Available``, ``CC 3DS Failed``,
        ``Issue with this card`` (case-insensitive matching). The
        backend short-circuits the booker pipeline with the matching
        exception class instead of hitting the supplier or the payment
        gateway, which is what makes a **production** end-to-end test
        safe to run: the card is never charged, no PNR is created, and
        ``ota.bookings.process_status`` carries a ``BOOKING_FAILED`` row
        we can validate against.

        Same DOM strategy as ``disable_optimizer`` — locate the
        ``<select>`` by walking from the visible label text, then use
        Playwright's native ``select_option`` so React's onChange fires.
        """
        try:
            self._page.evaluate(
                "window.scrollTo(0, document.body.scrollHeight)"
            )
        except Exception:
            pass
        self._page.wait_for_timeout(300)
        label_text = CHECKOUT.booking_failure_reason_label_text
        candidates = [
            f'div:has(label:has-text("{label_text}")) select',
            f'label:has-text("{label_text}") + select',
            f'div:has(:text("{label_text}")) select',
        ]
        last_err: Exception | None = None
        for sel_css in candidates:
            loc = self._page.locator(sel_css).first
            if loc.count() == 0:
                continue
            try:
                loc.scroll_into_view_if_needed(timeout=2_000)
                # Tolerate label-vs-value drift between front-end deploys
                # by trying both ``label=`` and ``value=`` when label
                # selection trips on the first attempt.
                try:
                    loc.select_option(label=reason_label, timeout=5_000)
                except Exception:
                    loc.select_option(value=reason_label, timeout=5_000)
                self._page.wait_for_timeout(300)
                self.screenshot(
                    f"booking-failure-reason-{_safe_label(reason_label)}"
                )
                return
            except Exception as exc:
                last_err = exc
                continue
        raise SelectorNotFound(
            "checkout.booking_failure_reason",
            url=self._page.url,
            detail=(
                "Could not find + set the 'Booking Failure Reason' select on "
                "the checkout page. Without it the qa-book runner cannot "
                "guarantee a controlled failure on a real booking attempt — "
                "on production this means we cannot proceed safely. "
                f"Last error: {last_err!r}"
            ),
        )

    def decline_insurance(self) -> None:
        """Decline cancellation protection — required before submit.

        Handles both the travel-protection ("No thanks") card and the
        BagAssist baggage-insurance ("No, I'm willing to risk losing my
        baggage") card. Both default to unselected and either can block the
        stage-1 "Continue to payment" CTA or final submit.
        """
        # Travel protection / cancellation upsell.
        try:
            self._page.evaluate("""() => {
                const labels = Array.from(document.querySelectorAll('label'));
                const no = labels.find(
                    l => (l.textContent || '').toLowerCase().includes('no thanks')
                );
                if (no) no.click();
            }""")
        except Exception:
            pass
        # BagAssist baggage insurance decline.
        try:
            bag = self._page.locator(CHECKOUT.baggage_decline_label).first
            if bag.count() > 0:
                bag.scroll_into_view_if_needed(timeout=2_000)
                bag.click(timeout=5_000)
        except Exception:
            pass
        self._page.wait_for_timeout(300)
        self.screenshot("insurance-declined")

    def get_price_summary(self) -> tuple[float | None, str | None]:
        """Return (total_amount, currency_code) as displayed on the checkout page.

        Returns (None, None) if the price cannot be reliably extracted.
        """
        result = self._page.evaluate("""() => {
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
        self.wait_for(
            "checkout.submit_btn_enabled",
            f"{CHECKOUT.submit_btn}:not([disabled])",
            timeout=30_000,
        )
        btn = self._page.locator(CHECKOUT.submit_btn)
        btn.scroll_into_view_if_needed()
        self._page.wait_for_timeout(500)
        self.screenshot("before-submit")
        btn.click()
        # Post-click diagnostic screenshots — the booking backend can take
        # 20–90s to redirect to the confirmation portal, and any
        # client-side validation error shows mid-page. Snap twice so we can
        # tell a silent-reject from an in-flight submit.
        self._page.wait_for_timeout(3_000)
        self.screenshot("after-submit-3s")
        self._page.wait_for_timeout(15_000)
        self.screenshot("after-submit-18s")

    def detect_failure_injection_banner(self) -> dict | None:
        """Read the booker's user-facing failure banner from the checkout DOM.

        When ``set_booking_failure_reason`` injects a label, the booker
        short-circuits the booking and re-renders the payment stage with
        an inline alert (``role="alert"`` / ``.alert``). The banner copy
        differs per-reason:
          * ``CC Decline`` → "Your payment method was declined…
            [Credit Card check failed]".
          * ``Fraud`` / ``CC 3DS Failed`` → fraud / 3DS-rejected copy.
          * ``Fare Increase`` / ``Flight Not Available`` → pricing /
            availability copy.
        Returns a dict with ``text`` (visible banner copy, single line)
        and ``markers`` (which known signal phrases matched) when found,
        or ``None`` if no recognised injection banner is present. Used
        by ``qa-book`` post-submit to convert the otherwise generic
        ``confirmation_url_timeout`` into a clean
        ``booking_failed_by_injection`` outcome.
        """
        result = self._page.evaluate(
            """() => {
                const phrases = [
                    {key: 'cc_decline', re: /credit\\s*card\\s*check\\s*failed/i},
                    {key: 'cc_decline', re: /payment\\s*method\\s*was\\s*declined/i},
                    {key: 'cc_decline', re: /verify\\s*or\\s*update\\s*your\\s*credit\\s*card/i},
                    {key: 'fraud', re: /flagged\\s*as\\s*(potential\\s*)?fraud/i},
                    {key: 'cc_3ds_failed', re: /3[\\-\\s]?d\\s*secure/i},
                    {key: 'fare_increase', re: /fare\\s*has\\s*(increased|changed)/i},
                    {key: 'flight_not_available', re: /(flight|seats?)\\s*(no longer|not)\\s*available/i},
                ];
                const containers = Array.from(
                    document.querySelectorAll(
                        '[role=alert], .alert, .error, [class*=Alert], [class*=Error], [class*=banner]'
                    )
                );
                for (const el of containers) {
                    if (!el || !el.offsetParent) continue;
                    const raw = (el.innerText || el.textContent || '').trim();
                    if (!raw) continue;
                    const matched = [];
                    for (const p of phrases) {
                        if (p.re.test(raw)) matched.push(p.key);
                    }
                    if (matched.length) {
                        return {
                            text: raw.replace(/\\s+/g, ' ').slice(0, 400),
                            markers: Array.from(new Set(matched)),
                        };
                    }
                }
                const body = (document.body && document.body.innerText) || '';
                const matched = [];
                for (const p of phrases) {
                    if (p.re.test(body)) matched.push(p.key);
                }
                if (matched.length) {
                    return {
                        text: body.replace(/\\s+/g, ' ').slice(0, 400),
                        markers: Array.from(new Set(matched)),
                    };
                }
                return null;
            }"""
        )
        if not result:
            return None
        return {
            "text": str(result.get("text") or ""),
            "markers": list(result.get("markers") or []),
        }
