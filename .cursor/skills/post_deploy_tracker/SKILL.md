---
name: post-deploy-verification
description: >-
  Use when the user asks to verify a deploy in production after a developer
  shipped a fix — "post-deploy track this card", "watch <card_link> after
  deploy", "verify the Intelisys fix landed", "tail production for the X
  fix", "did the deploy work", "QA the rollout for <combo>", "track this
  fix for me". Drives an autonomous loop in the chat session: reads the
  Trello card, proposes 3 things to track (happy path / card target /
  regression sweep) with concrete queries, waits for the user's
  approval, then queries MySQL / ClickHouse / MongoDB on a per-watch
  cadence and pings via @reporter when something the agent thinks is
  related to the deploy fires. Owns no SQL of its own — drives the
  `bookability` and `optimizer` skills' query
  templates. Single-machine, single-user — state lives in `reports/`
  (gitignored).
---

# Post-deploy verification

Watch production after a deploy. The user kicks off a watch by pointing
at a Trello card; the agent proposes three things to track (happy path,
the literal card target, regression sweep around the same area), waits
for approval, then runs an autonomous loop in the current chat session
— SQL → Mongo verification → `@reporter` Slack alarm on hits — until
the user stops it or the session ends. State persists locally so "redo
the watch" next session resumes where the loop left off.

## When to use

- A developer just deployed a Content Integration fix and the user
  wants to know whether it landed and whether anything else broke
  around it.
- The user points at a Trello card and asks to "post-deploy track" /
  "watch this card" / "QA the rollout for X" / "verify the Y fix".
- The user wants a session-bounded watcher (kicked off in chat, dies
  with the session), not a permanent monitor.

## When NOT to use

- **Permanent monitoring / 24-7 alerting.** This skill is session-
  bounded — when the chat ends, the loop stops. Use Looker / a real
  alerting stack for permanent monitors.
- **Pre-deploy QA.** Use `qa_automation` to drive a real test booking
  before shipping; this skill watches *after* the fact.
- **One-off bookability or optimizer audit** with no temporal /
  watching component. Use `bookability` or
  `optimizer` directly — those skills already cover the
  query side.
- **Custom monitoring not tied to a specific deploy / card.** This
  skill anchors on a parent Trello card; if there's no card, it has
  nothing to read the spec from and nowhere to drop the closing
  summary.

## Inputs

The user provides one of:

- A Trello card short link (`/c/<shortLink>`) on either Content
  Integration or Content Integration - AI Automation. The card's
  `## Summary` and `## Implementation plan` carry the spec.
- A free-text spec in chat ("track Intelisys F8 multi-ticket debit
  cards starting now"). Used for ad-hoc watches without a parent
  card. The skill writes the parsed spec into `state.json` instead of
  the card.

The skill also reads from `.env`:

| Var | Purpose |
|---|---|
| `REPORTER_DEFAULT_SLACK_USER_ID` | Slack user ID (`U…`) the watch DMs on findings via the `reporter` skill. Required if Slack alarms are wanted. If unset, the skill falls back to printing findings into the chat. |

## Cross-skill dependencies

This skill writes no SQL of its own. Per tick it drives:

- [`db_access`](../db_access/SKILL.md) for the CLI scripts and
  documented schemas.
- [`bookability`](../bookability/SKILL.md) for the
  SQL templates (success / failure / error-signature queries) and
  for `debug_logs` evidence patterns.
- [`optimizer`](../optimizer/SKILL.md) when the
  card target involves matching / contestants / fare basis (look for
  optimizer keywords in the card description).
- [`reporter`](../reporter/SKILL.md) for Slack DMs on findings. The
  Slack plugin (`plugin-slack-slack`) must be authenticated. If it
  is not, the skill detects this at startup and degrades to
  chat-only output — it does not refuse to run.

## Workflow

### Step 1 — Read the spec and propose three slots

1. If the user gave a card link, fetch the card via the Trello MCP and
   read `name`, `desc`, and any attached PR / branch reference.
   Identify the content source / carrier / GDS / payment processor /
   ticket-shape mentioned in the description.
2. Read the deploy time. Order of preference:
   1. The PR's `merged_at` (via the GitHub MCP) if a PR is linked.
   2. The card's most recent move into a deployment list (`Ready for
      Deployment` → `Done` for Content Integration; `QA` → done on AI
      Automation).
   3. The user's stated time, asked once if neither of the above is
      present.
3. Build the **3-slot proposal** following
   [`references/proposal_template.md`](./references/proposal_template.md).
   Each slot has: title, the dimension it watches, the SQL the agent
   would run (parameterised on the spec), the `debug_logs` /
   `optimizer_logs` verification step, and the dedup rule.
4. Post the proposal in chat. Wait for the user's approval / edits.
   Do not run any DB query before approval.

### Step 2 — Initialise state

Create `reports/post_deploy/<short_link>/` (or
`reports/post_deploy/_adhoc_<slug>/` for free-text watches). Write:

- `state.json` — the approved spec, perimeter, `cadence_minutes`,
  `last_tick_at: null`, `already_reported: { slot1: [], slot2: [],
  slot3: [] }`. Schema in
  [`references/state_schema.md`](./references/state_schema.md).
- `report.md` — append-only human log. Header line with the spec, a
  blank `## Tick log` section.

Default cadences (override per-watch on the user's request or based
on observed traffic in tick 1):

| Content source | Default `cadence_minutes` |
|---|---|
| Intelisys, Sabre, Amadeus, Travelport, Travelfusion (high volume) | 5 |
| Smaller suppliers (Unififi, Kiwi, others) | 15 |
| Niche / low-traffic content sources | 30 |

### Step 3 — Run the autonomous tick loop

Repeat until the user stops the watch or the chat session ends:

1. **Tick start.** Set `tick_window = [max(deploy_time,
   last_tick_at), now]`. Append a tick header to `report.md`:
   `### Tick <N> at <ISO>` + the window.
2. **Run slot SQL.** For each slot (1, 2, 3), run the SQL via the
   appropriate `db_access` CLI (`mysql_query.py` /
   `clickhouse_query.py`). Cap result row counts (default 200 per
   slot per tick) so a runaway window cannot DoS the tick.
3. **Verify in Mongo.** For each candidate row, fetch the relevant
   document via `mongo_query.py` (`debug_logs` for booking flows,
   `optimizer_logs` for matching). Apply the slot's verification
   predicate (e.g. for Slot #2 on a Float-card-on-F8 watch:
   `payhub.merchant == "F8" && card.brand in {Visa,Mastercard} &&
   card.funding == "debit" && payhub.sale.status == "success"`).
4. **Categorise hits.** For each verified candidate:
   - Slot #1 (happy path) — only the **first** confirmed success
     fires `@reporter`; subsequent successes are silent.
   - Slot #2 (card target) — only the **first** confirmed match
     fires `@reporter`; subsequent matches are silent. Failures on
     Slot #2's exact dimensions also fire (these are the deploy's
     "did not land" signal).
   - Slot #3 (regression sweep) — fire `@reporter` per **new error
     signature** (deduped by canonicalised error string + content
     source + carrier). Already-reported signatures stay silent for
     6 hours, then re-fire if still active.
5. **Notify.** Build a concise body per finding (slot label, combo,
   booking ID / search hash, mongo `_id`, one-line evidence) and
   send via the [`reporter`](../reporter/SKILL.md) skill with
   `recipient = REPORTER_DEFAULT_SLACK_USER_ID`. Append the `ts` to
   the finding entry in `state.json` and `report.md`. If reporter is
   degraded (no Slack auth), print the body in chat instead.
6. **Persist.** Update `state.json` with `last_tick_at = now`,
   append the `already_reported` entries. Append the tick's findings
   + suppressed candidates to `report.md`.
7. **Adapt cadence (optional).** If Slot #3 fires repeatedly within
   one tick, propose tightening cadence to the user (do not change
   it without confirmation). If three consecutive ticks are silent
   on all slots, propose loosening it.
8. **Sleep.** `sleep $(( cadence_minutes * 60 ))` via the Shell tool
   with `block_until_ms` set to the same duration plus a small
   buffer. Treat any user message that arrives during sleep as an
   interrupt — exit the loop and respond.
9. **Goto 1.**

### Step 4 — Stop, summarise, hand off

The user stops the watch ("stop", "that's enough", "done") or the
session is about to end. Then:

1. Write a final `## Summary` section to `report.md`: total ticks,
   confirmed Slot #1 / #2 hits, Slot #3 error signatures (deduped),
   total wall-clock watched.
2. Post a single closing comment on the parent Trello card with the
   summary and links to the most damning evidence. Suggest a list
   move only when the data is unambiguous: sustained Slot #1+Slot #2
   success and Slot #3 quiet → suggest `Done`; Slot #2 failures or
   Slot #3 new errors → suggest `Fixes Needed`. **Never move the
   card** — only suggest in the comment.
3. Tell the user how to resume: "resume with `redo the post-deploy
   watch on <short_link>`". The state file stays put.

### Step 5 — Resume / review (next session)

When the user says "give me the latest on the <X> watch" or "redo
the post-deploy watch on <short_link>":

1. Resolve the short link (or, for ad-hoc watches, the slug).
2. Read `reports/post_deploy/<short_link>/state.json` +
   `report.md`. If the state file is missing, treat the request as
   a fresh tick 1 and re-propose.
3. Summarise the persisted report in chat, ending with:
   - Total ticks, slot-by-slot status.
   - Time since `last_tick_at`.
   - Whether the spec is still valid (deploy time has not changed,
     the parent card still exists, no contradicting comments since
     last tick).
4. If the user said "redo" (not just "review"), prompt: "Resume
   from `last_tick_at` (<timestamp>) or restart from deploy_time
   (<timestamp>)?" then re-enter Step 3.

## What not to do

- **Do not run any DB query before the user approves the 3-slot
  proposal.** That gate exists so the queries the agent runs are
  the queries the user actually wanted, not what the agent guessed
  from a half-read card.
- **Do not write SQL inline in `SKILL.md` or `state.json`.** Drive
  `bookability` / `optimizer` templates per tick.
  Owning SQL here would duplicate query patterns and drift from
  those skills.
- **Do not fire `@reporter` on every tick.** Slack noise kills
  trust. Slots #1 / #2 are one-shot per confirmed hit; Slot #3 is
  per-signature with a 6h cooldown.
- **Do not move the parent Trello card.** Only suggest a list move
  in the closing comment. The dev who shipped owns the move.
- **Do not extend the perimeter mid-session without asking.** If
  the user wants to add a sibling carrier or a new error to watch,
  ask, then update `state.json` and write the change into
  `report.md`'s tick log.
- **Do not retry a failed `@reporter` send silently.** Surface the
  error verbatim, append the failed finding to `report.md` as
  `(NOT SENT: <reason>)`, and continue the loop. The user can re-
  drive the missed alerts after fixing the Slack auth.
- **Do not write to `.env`.** Read only. If
  `REPORTER_DEFAULT_SLACK_USER_ID` is missing the skill degrades to
  chat output and tells the user once at startup.
- **Do not commit anything under `reports/post_deploy/`.** That
  folder is gitignored — single-machine, single-user state.

## References

- [`references/proposal_template.md`](./references/proposal_template.md)
  — the 3-slot proposal template + a worked example for the
  Intelisys / F8 / debit card target ([Cuwwjgmr](https://trello.com/c/Cuwwjgmr)).
- [`references/state_schema.md`](./references/state_schema.md) — the
  shapes of `state.json` and `report.md`, plus the dedup rules.
- Cross-skill load list (read each before driving its templates):
  [`db_access/SKILL.md`](../db_access/SKILL.md),
  [`bookability/SKILL.md`](../bookability/SKILL.md),
  [`optimizer/SKILL.md`](../optimizer/SKILL.md),
  [`reporter/SKILL.md`](../reporter/SKILL.md).
- Parent card:
  [doJTY0Eu — Post-deploy verification skill](https://trello.com/c/doJTY0Eu).
