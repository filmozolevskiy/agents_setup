# qa_strategy — iteration-3 eval feedback (2026-06-04)

Source: viewer review submitted on iteration-3 (with-skill runs).
Raw export: [`iteration-3-feedback.json`](../qa_strategy-workspace/iteration-3/feedback.json) (workspace copy: `.cursor/skills/qa_strategy-workspace/iteration-3/feedback.json`).
Status: **captured, applied to SKILL.md in the same change.**

Cards used as eval sessions (same as iter-2):
- eval-0 — https://trello.com/c/jPCKypll/2920-fr24-booking-sync-fails (PR #53840)
- eval-1 — https://trello.com/c/mrasebFb/2908-onefly-implement-check-availability (PR #53838)
- eval-2 — https://trello.com/c/ra8NqjLu/2923-kiwi-add-a-scope-tag-to-all-check-availability-logs (PR #53810)

---

## eval-0 — fr24

1. **Some test cases require a specific condition the generic smoke booking will not produce.** Example: "Tickets and airline PNR sync after issuance" can only be verified on a booking that has more than one distinct PNR. A random smoke booking will not trigger the logic the PR changed, so it cannot validate the fix. Rule: every check must trigger the specific logic it claims to verify; if it requires a condition (multi-PNR, multi-ticket, a specific carrier, a malformed response), the steps must create that condition — not lean on a generic booking.
   - *Applied skill change:* new sub-section in Step 3 — *Each check must trigger the specific logic it claims to verify.* Reject any check whose steps say "use the smoke booking" when the check needs a condition the smoke booking will not produce. Either drive the condition (from a real prod row, or with the staging package-transfer tool — see point 3 below), or fold the check into another booking that does produce the condition.
2. **Combine bookings.** A single FR24 booking with multiple distinct PNRs satisfies *all* of: the FR24 staging94 smoke, ticket / per-segment PNR sync on the ResPro page, log de-duplication of `TICKET NUMBERS:`, and the confirmation email showing FR24 details. The plan should present this as one booking with ordered observations on the ResPro page / log / email, not four separate bookings.
   - *Applied skill change:* new sub-section — *Bundle checks that share a booking into one block.* Introduce a `**Booking and observations:**` block when multiple checks attach to the same booking attempt; list the booking once, then enumerate the observations as sub-bullets, each with its own pass condition and *Why:* line. This collapses 4 bullets and 4 bookings into 1 booking and 4 observations.
3. *(Feedback item 3 in the JSON was cut off — only the digit "3" was submitted. Not actioned. Re-open the viewer next iteration if there was more content intended.)*

## eval-1 — onefly

1. **Force the unavailable-fare condition with the staging package-transfer tool — don't rely on a query.** The unavailable-fare path on a new check-availability implementation cannot be reproduced by a fresh search, and the plan should not pretend a `bookability_contestant_attempts` query on staging would find it (there is no production traffic yet). Use https://summit.flighthub.com/tools/package-transfer to pick a real Onefly package from production, transfer it onto staging, then walk through checkout — when Onefly is called on checkout, it will return a different price (or unavailable) against the now-stale package and we can verify the contestant-drop + optimizer-fallback path live on staging.
   - *Applied skill change:* added the package-transfer tool to the `## Tooling` section. New sub-section in Step 3 — *Use the package-transfer tool to force a stale or different-price condition.* Updated the existing "if a failure mode cannot be reproduced, move it to Post-deployment" rule to require trying the package-transfer route **first**; only fall back to a watch when even a transferred package cannot recreate the condition.

## eval-2 — kiwi

1. **The verifier-path check can be folded into the smoke booking.** Same theme as fr24 #2 — when the verifier-path observation rides on the same booking the smoke check already runs, it belongs as an extra observation on that booking, not as a separate check.
   - *Applied skill change:* covered by the bundle-checks-into-shared-booking rule above.
2. *(Feedback item 2 in the JSON was cut off — only the digit "2" was submitted. Not actioned.)*

---

## Themes for iteration-4

- **Domain accuracy of test triggers** (fr24 #1, onefly #1): Checks must trigger the specific logic the PR changed. A check that requires condition X is not validated by a booking that does not have X.
- **Booking economy** (fr24 #2, kiwi #1): Bundle checks that ride on the same booking attempt into one `**Booking and observations:**` block. One booking, N observations — never N bookings.
- **Staging tooling awareness** (onefly #1): The package-transfer tool exists; use it to force stale / different-price / specific-package conditions on staging before giving up and writing a post-deploy watch.
