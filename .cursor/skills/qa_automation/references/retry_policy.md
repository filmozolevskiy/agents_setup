# QA Retry Policy

The runners never retry silently — every Playwright timeout, missing
content source, or broken selector raises and returns a structured error.
The **agent** decides when and how to retry. Keep it bounded.

## Per-scenario budget

At most **3 retries total** per booking scenario. After the third failed
attempt, stop and report. This keeps staging load manageable and prevents
the agent from spinning on a deep problem.

## Invariant: a retry must not change which content source is booked

If the user named a content source, every retry in the scenario must
keep `--content-source <same source>`. The retry ladder below
(date / route / `--pos` shifts) is allowed; substituting a different
`--content-source`, dropping the flag, or switching to
`--package-index N` (which is mutually exclusive with `--content-source`
and would lift the source pin and re-enable the optimizer) is **not** a
retry — it's a different scenario, and silently swapping defeats the
point of the test. If the pinned source genuinely cannot book within
the 3-retry budget, stop and report that to the user. See
`SKILL.md` "When the user names a content source, pin to it — period".

If the user did not name a content source (`--package-index N` or no
package selection at all), this invariant doesn't apply — the
scenario is "book *something* on this route", and any package on any
source is fair game.

## Retry ladder (apply in order)

1. **Shift `--depart` by +1 or +2 days.** Content source availability on
   staging is day-sensitive. One of the cheapest things to try first.
2. **Shift departure by ±7 days.** Some carriers only publish fares for
   mid-week / weekend buckets.
3. **Swap route** within the same pair region (YUL→LAX → YUL→SFO,
   LAX→JFK → LAX→BOS). Keep origin first so autocomplete semantics stay
   simple.
4. **Drop `--pos` and `--currency` overrides.** Staging2 returns USD
   regardless, so the search succeeds without them.
5. **Try `--package-index 1`** if the same search produced packages but
   the first one hit `checkout_render_timeout` — a backend error
   specific to package 0 often isn't shared by subsequent packages.
   **Only applies on non-pinned runs.** `--package-index` is mutually
   exclusive with `--content-source` at the runner level, so on a
   pinned run this is not a legal retry — fall back to steps 1-3
   instead, keeping `--content-source <same source>`.

## Terminating conditions

Stop immediately (no further retries) when:

- `selector_not_found` appears twice in a row on the same `name` → selector
  rot. Run `qa-diag` and report to the user; require a human to edit
  `selectors.py`.
- `booking_not_found` from `qa-validate` when we just got a successful
  confirmation — replication lag is usually seconds; if it's still missing
  after two spaced retries (~15s each), something is wrong with the DB
  write itself.
- Any exit other than the well-known error keys (`source_not_available_in_ui`,
  `checkout_render_timeout`, `selector_not_found`, `booking_not_found`,
  `missing_join_key`) → unknown failure
  mode, escalate.

## Partial failures

If `qa-book` succeeded but `qa-validate` reports FAIL on some invariants:

- Do **not** retry the booking. The booking exists; a new one won't change
  the evidence.
- Report the specific evidence gap (field-level) and still run `qa-cleanup`,
  unless the user asked to keep the booking for manual inspection.

## Summarising retries in the final report

Include, for each attempt:

- Attempt number (`1`, `2`, ...).
- Scenario delta vs the base request (e.g. "+1 day", "alt route YUL→SFO").
- The tool that failed (`qa-search`, `qa-book`, ...).
- The `error` key from the JSON body.
- The scenario dir so screenshots can be inspected.

Keep it compact — the agent's summary, not the raw logs.
