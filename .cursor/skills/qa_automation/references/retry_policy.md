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

## Stop and investigate after 3 supplier-side "flight not available" failures

Three consecutive submit-time "flight not available" failures on the
**same source** (and `--carrier` if pinned) within one scenario stop
being noise — the supplier is telling us something specific about the
inventory we're staging. Stop the retry ladder, drop into Mongo
`ota.debug_logs` for the 3 `transaction_id`s, identify which flight /
fare the supplier reported as unavailable, and report that to the
user with permalinks. The user decides what to do next (shift dates
±7 days, switch carrier, drop the lane); the agent does **not**
silently take a 4th attempt.

### Trigger

Counts as a "flight not available" failure:

- `qa-book` exits `confirmation_url_timeout` and the storefront's
  "One or more flights are no longer available" recovery modal is
  captured in `010-after-submit-18s.png` (or the equivalent
  late-submit screenshot). Supplier-side variant.
- `qa-book` exits `booking_failed_by_injection` and `front_end_markers`
  contains `flight_not_available` — **only** when we did not ourselves
  pass `--booking-failure-reason "Flight Not Available"`. An injection
  run we asked for is a successful exercise of the short-circuit and
  does not count toward the 3.

A retry that swapped `--content-source`, dropped `--carrier`, or
switched to `--package-index N` resets the counter. The rule fires on
3-in-a-row on the same supplier slot, not 3 anywhere in the scenario.

### Investigation pipeline

Collect the 3 transaction_ids from each scenario's `trace.zip` (the
checkout URL embeds it as `/checkout/billing/flight/<TX>/<package_id>`)
or from `qa-book`'s JSON output, then run:

```bash
python3 scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id":{"$in":["TX1","TX2","TX3"]},
             "context":{"$in":["post-air-booker",
                               "handling-booking-exception",
                               "Travelfusion-reprice-original-package"]}}' \
  --projection '{"_id":1,"transaction_id":1,"context":1,
                 "date_added":1,"data":1,
                 "Response from Booker":1,"exception":1}' \
  --sort '{"transaction_id":1,"date_added":1}' --limit 30 --json
```

Universal signals (source-agnostic, present on every booker failure):

- `post-air-booker` → `Response from Booker` carries
  `error_type=flight_unavailable`, the user-facing alert text, and
  `user_error_display=show_alternative_flights`. This is the
  canonical "supplier said no" indicator.
- `handling-booking-exception` → `exception.class =
  Mv_Ota_Air_Booker_Exception_DelayedFlightNotAvailable`,
  `message="One or more flights not available"`, with the booker
  manager file/line.

Per-source flight-signature contexts. Extend with **evidence** as new
sources land in this trap — TODO rows stay TODO until reproduced; do
not invent context names:

| Source       | Context                                | Read from `data` / payload                                                                     |
|--------------|----------------------------------------|------------------------------------------------------------------------------------------------|
| Travelfusion | `Travelfusion-reprice-original-package` | `<FN1>-<FN2>-…-<FNn>_<grpcount>_<fare basis>_<RBD>-<RBD>-…`. The `FN` tokens are supplier flight numbers (e.g. `DE2403-DE2402_1_M_Y-Y` ⇒ DE 2403 outbound + DE 2402 inbound, fare basis M, Y class). |
| Amadeus / Downtowntravel / Tripstack | TODO                  | Extract on the next 3-in-a-row reproduction; do not guess at context names. |

Permalinks for the user-facing report use the standard storefront
shape — append `#<log _id>` when pointing at a specific event inside
the group:

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>
```

### User-facing report shape

Print a compact block, not a wall of text. Voice rules from
[`run_summary_voice.md`](run_summary_voice.md) still apply.

```
Stopped after 3 supplier-side "flight not available" failures on the same source.

Source: travelfusion
Carrier: DE (Condor)
Lane / dates tried:
  - YYZ↔FRA  2026-06-08 / 2026-06-15
  - YYZ↔BCN  2026-06-15 / 2026-06-22  (--carrier-package-index 0)
  - YYZ↔BCN  2026-06-15 / 2026-06-22  (--carrier-package-index 1)

Supplier-reported failing flights (per attempt):
  1. DE 2403 (YYZ→FRA) + DE 2402 (FRA→YYZ)              [tx ce30343d…]
  2. DE 2403 + DE 4325 + DE 4322 + DE 2402              [tx 6617d3c3…]
  3. DE 2403 + DE 4325 + DE 4326 + DE 2402              [tx 8a13fb96…]

Common across all 3: DE 2403 / DE 2402. Same fragile pair on every
retry — Condor's cached fare expires faster than our automation
completes the flow (~3-4 min vs ~60-90 s human).

Debug log groups:
  - https://reservations.voyagesalacarte.ca/debug-logs/log-group/ce30343d68a90e8435aaa2bb4033a19d
  - https://reservations.voyagesalacarte.ca/debug-logs/log-group/6617d3c33726d75165011a4c087464f9
  - https://reservations.voyagesalacarte.ca/debug-logs/log-group/8a13fb962fe7c942af14027777f37d03

Recommended next move: pivot to a different carrier with thicker
inventory (TF + AF on YUL↔CDG was reliable on 2026-04-29). If staying
on DE is required, escalate to ops to look at the fare-cache TTL on
this Travelfusion fare_fetch.
```

### Worked example (TF + DE on 2026-04-28 / 2026-04-29)

Three consecutive attempts on Travelfusion + Condor (DE) over
transatlantic routes during card
[`weaSgLaj`](https://trello.com/c/weaSgLaj):

| # | Scenario                                       | Transaction ID                     | `Travelfusion-reprice-original-package.data`     |
|---|------------------------------------------------|------------------------------------|--------------------------------------------------|
| 1 | YYZ↔FRA Jun 8/15                               | `ce30343d68a90e8435aaa2bb4033a19d` | `DE2403-DE2402_1_M_Y-Y`                          |
| 2 | YYZ↔BCN Jun 15/22                              | `6617d3c33726d75165011a4c087464f9` | `DE2403-DE4325-DE4322-DE2402_1_M_Y-Y-Y-Y`        |
| 3 | YYZ↔BCN Jun 15/22 + `--carrier-package-index 1`| `8a13fb962fe7c942af14027777f37d03` | `DE2403-DE4325-DE4326-DE2402_1_M_Y-Y-Y-Y`        |

All three hit `post-air-booker` with `error_type=flight_unavailable`
and `Mv_Ota_Air_Booker_Exception_DelayedFlightNotAvailable` in
`handling-booking-exception`. DE 2403 / DE 2402 were the common
fragile legs across all three. With this rule the agent stops at
attempt 3 and reports the supplier-named flights; without it the
loop ate a 4th attempt before pivoting.

See [`known_issues.md`](known_issues.md) → "Travelfusion fare-cache
TTL on thin lanes" for the inventory-side context.

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
