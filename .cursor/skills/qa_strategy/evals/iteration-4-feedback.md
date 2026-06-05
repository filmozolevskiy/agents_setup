# qa_strategy — iteration-4 eval feedback (2026-06-04)

Source: viewer review submitted on iteration-4 (with-skill runs).
Raw export: `.cursor/skills/qa_strategy-workspace/iteration-4/feedback.json` (gitignored — workspace-local).
Status: **captured, applied to SKILL.md in the same change.**

Cards used as eval sessions (same as iter-2 / iter-3):
- eval-0 — https://trello.com/c/jPCKypll/2920-fr24-booking-sync-fails (PR #53840)
- eval-1 — https://trello.com/c/mrasebFb/2908-onefly-implement-check-availability (PR #53838)
- eval-2 — https://trello.com/c/ra8NqjLu/2923-kiwi-add-a-scope-tag-to-all-check-availability-logs (PR #53810)

---

## eval-0 — fr24

1. **Package-transfer tool produces a checkout, not a booking — cannot recreate a post-issuance state.** The iteration-4 plan used package-transfer to set up an FR24 booking "immediately after issuance, before the airline has assigned tickets" by transferring a prod row with `bookings.status='issued'` but every `booking_segments.control_number` blank. That doesn't work: the tool drives a *checkout* against a chosen package, exercising the supplier on the check-availability call — it never creates a booking, and it can't reconstruct a post-issuance / post-ticketing state.
   - *Applied skill change:* tightened the `## Tooling` description of package-transfer to spell out the scope explicitly — *produces a checkout state, drives the supplier on the check-availability call, never creates a booking and never reproduces a post-issuance / post-ticketing condition.* Added a `## What not to do` rule: do not use package-transfer to reach any state past the booking submit step. Post-issuance / post-ticketing checks must drive a real booking end-to-end on staging or move to a Post-deployment watch on production.

## eval-1 — onefly

1. **Pass conditions phrased as "exercises the entry into the new branch" are unobservable.** QA cannot verify a code-path execution — they verify what they see on a page, in a log, on the ResPro page, or in a database row. Phrases like *"one booking exercises the entry into the new branch"*, *"the request enters the new code"*, *"the call hits the updated dispatcher"* describe execution, not symptoms.
   - *Applied skill change:* new sub-section under the existing *Why:* / pass-condition guidance — *No code-path verbs in pass conditions.* Banned verbs: `exercises`, `enters`, `hits`, `runs through`, `executes`, `goes through`, `triggers the branch`, `reaches the code`, `invokes`. Every pass condition must name an observable: a page the user is on, a value the agent sees on the ResPro page, a specific `_id` / row count / field value in a debug-log query, a row in MySQL, an entry in the confirmation email. Added bad/good worked examples translating the banned phrasings into observable symptoms (e.g. *"one booking exercises the entry into the new branch"* → *"the debug log group for the smoke `booking_id` contains exactly one entry whose `context` starts with `Onefly::check-availability` and ends in `::Success`"*).

## eval-2 — kiwi

No direct feedback on the kiwi plan in iter-4. (The grader's "bundle the verifier observation into the smoke booking" complaint is debatable — the deep-validation path fires only on a non-Kiwi package routed through Kiwi, so it must be a different booking. The iter-3 *Bundle checks that share a booking* rule already says "split when bookings must differ", which is the correct behaviour here. No skill change.)

## Cross-cutting (carried from grader, not from human feedback)

1. **Code identifiers still leak into *Why:* lines.** Iter-4 grader caught real leaks in all three plans: `getSegmentPnrs`, `hasTickets`, `getTickets()` (fr24); `isOnefly()`, `Throwable` (onefly); `actionValidatePackageDeeply` (kiwi). The `## What not to do` "no code identifiers in plan prose" rule is already there, but it gets bypassed when the agent reaches for a method name as shorthand for *what* the PR changed.
   - *Applied skill change:* strengthened the *Why:* / no-code-identifiers guidance with a concrete translation list — `getSegmentPnrs` → *"the per-segment airline PNR row on the ResPro page is now populated when the supplier returned per-pax PNRs"*; `isOnefly()` → *"only Onefly checkouts hit the new path; other suppliers are unchanged"*; `actionValidatePackageDeeply` → *"the deep re-check step on a non-Kiwi package routed through Kiwi"*. Same anti-pattern as iter-3's "implementation-mechanics jargon" rule; the worked examples make the translation explicit.

---

## Themes for iteration-5

- **Staging tooling scope discipline** (fr24): the agent now knows the package-transfer tool exists but over-stretches what it can do. If a future tool is added (real-booking-clone, ticket-injector, whatever), document its scope explicitly in `## Tooling` — *what shape of state it produces, and what shape of state it can never produce.*
- **Observability vocabulary** (onefly + the recurring code-identifier leak): the agent reaches for code-path verbs and method names as shorthand for "what the PR does". Both are now banned with worked examples; iter-5 will tell us if the examples stick or if a different framing is needed.
