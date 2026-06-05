# qa_strategy — iteration-2 eval feedback (2026-06-03)

Source: viewer review submitted on iteration-2 (with-skill runs).
Raw export: [`iteration-2-feedback.json`](iteration-2-feedback.json).
Status: **captured, NOT yet applied to SKILL.md.** Backlog for the next iteration.

Cards used as eval sessions:
- eval-0 — https://trello.com/c/jPCKypll/2920-fr24-booking-sync-fails (PR #53840)
- eval-1 — https://trello.com/c/mrasebFb/2908-onefly-implement-check-availability (PR #53838)
- eval-2 — https://trello.com/c/ra8NqjLu/2923-kiwi-add-a-scope-tag-to-all-check-availability-logs (PR #53810)

---

## eval-0 — fr24

1. **ESL wording.** Keep language accessible to ESL readers. Example: instead of "we do not sweep them by hand" → "we will not verify them manually".
   - *Prospective skill change:* tighten the `Notes for QA` / prose wording guidance toward plain ESL phrasing; add this as a worked example.
2. **Missing booking-attempts query.** The production tracking still lacks a `booking_contestant_attempts` query. Needed because when we fail **at this step**, we sometimes write **no record to the `bookings` table** — so failures that happen *before* a `bookings` row exists are invisible if we only watch `bookings`.
   - *Prospective skill change:* the "Find the attempts" production-check query must read the **contestant-attempts** surface (pre-booking), not just `bookings`, so pre-booking failures are caught. Cross-reference `bookability` skill for the attempts table.
3. **Brevity.** Keep the description minimal — the shorter the QA strategy, the better.
   - *Prospective skill change:* add an explicit brevity directive; cut optional sections aggressively when the change is small.

## eval-1 — onefly

1. **"Unchanged price proceeds cleanly" — wrong pass condition.** We rewrite the package but we do **not** show a new price to the passenger. The customer must pay the price agreed **at search**. Charging a different price = overcharge / undercharge. The check should assert the customer is charged the search-time price, not "the repriced value shows on checkout".
   - *Prospective skill change:* domain correction — re-price/check-availability does not change the price shown/charged to the customer; the agreed search price stands. The skill should not assume a repriced value surfaces to the user.
2. **"Unavailable fare blocks the booking" — wrong.** On a "Flight no longer available" result in check availability, we do **not** block — we still proceed and rely on the optimizer to find other candidates. We just must **not retry the original contestant**. The pass condition should reflect "fall through to optimizer, original contestant excluded", not "user is blocked".
   - *Prospective skill change:* domain correction on the unavailable-fare path.
3. **Mongo query format.** Mongo blocks must be runnable in **MongoDB Compass** — i.e. a bare aggregation-pipeline array, not `db.collection.aggregate(...)`. Example format requested:
   ```
   [
     { $match: {
         context: { $regex: "^Onefly::check-availability", $options: "i" },
         date_added: { $gt: new Date(Date.now() - 6*3600*1000) }
     } },
     { $group: { _id: "$context", c: { $sum: 1 } } },
     { $sort: { c: -1 } }
   ]
   ```
   - *Prospective skill change:* replace the `db.debug_logs.aggregate([...])` / `db.debug_logs.find(...)` template shape with the Compass-pasteable bare-pipeline-array shape. Update the Mongo block convention in Step 4 + the verification examples.

## eval-2 — kiwi

1. **Glossary.** Use `GLOSSARY.md`. Do not use the word **"storefront"**.
   - *Prospective skill change:* reinforce glossary compliance; flag "storefront" as a banned term (confirm/add the correct term in `GLOSSARY.md`).
2. **Missing cross-content-source case.** `check-availability-response` and `check-availability-comparison-report` are **gds-agnostic**. The plan must verify the scope-tag logic works for **other content sources**, not just Kiwi.
   - *Prospective skill change:* when a changed log context is shared across content sources, the plan must add a cross-gds verification case, not scope the check to the one supplier named on the card.

---

## Themes for the next iteration

- **Domain accuracy of pass conditions** (onefly #1, #2): the skill produces structurally clean checks but with wrong *expected behaviour*. Consider a step that confirms the expected user/agent/log outcome against how the flow actually behaves (check-availability does not re-charge; unavailable → optimizer fallback).
- **Right observability surface** (fr24 #2): watch the pre-booking attempts surface, not only `bookings`.
- **Cross-gds blast radius** (kiwi #2): shared log contexts → test across content sources.
- **Output form**: ESL wording (fr24 #1), brevity (fr24 #3), glossary `storefront` ban (kiwi #1), Compass-pasteable Mongo (onefly #3).
