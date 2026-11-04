# Persistent state schemas

Each watch persists two files under
`reports/post_deploy/<short_link>/` (or
`reports/post_deploy/_adhoc_<slug>/` for free-text watches). Both
are gitignored — single-machine, single-user.

## `state.json`

The machine-readable spec + dedup ledger. The agent reads it on every
tick, updates it after the tick, and saves atomically (write to
`.tmp`, rename) so a crashed tick can't corrupt it.

```json
{
  "watch_id": "Cuwwjgmr",
  "card_url": "https://trello.com/c/Cuwwjgmr",
  "spec": {
    "content_source": "Intelisys",
    "carrier": null,
    "gds": null,
    "payment_processor": "F8",
    "card_brand": ["Visa", "Mastercard"],
    "card_funding": "debit",
    "ticket_shape": "multi",
    "office": null,
    "pos": null,
    "deploy_time": "2026-05-09T13:42:11Z",
    "error_signature": null
  },
  "slots": {
    "slot1": {
      "title": "Happy path baseline",
      "active": true,
      "where_overrides": {}
    },
    "slot2": {
      "title": "Card target",
      "active": true,
      "where_overrides": {}
    },
    "slot3": {
      "title": "Regression sweep",
      "active": false,
      "dropped_by_user_at": "2026-05-09T13:48:02Z"
    }
  },
  "cadence_minutes": 5,
  "started_at": "2026-05-09T13:48:02Z",
  "last_tick_at": "2026-05-09T16:33:11Z",
  "tick_count": 33,
  "already_reported": {
    "slot1": [
      {
        "kind": "success",
        "booking_id": "BK-19283746",
        "mongo_id": "65f9...",
        "reported_at": "2026-05-09T13:53:40Z"
      }
    ],
    "slot2": [
      {
        "kind": "success",
        "booking_id": "BK-19284001",
        "mongo_id": "65fa...",
        "reported_at": "2026-05-09T14:09:11Z"
      }
    ],
    "slot3": [
      {
        "kind": "error",
        "signature": "TIMEOUT@INTELISYS_SALE",
        "first_seen_at": "2026-05-09T15:01:22Z",
        "last_reported_at": "2026-05-09T15:01:22Z"
      }
    ]
  }
}
```

### Field rules

- `spec.*` — null when the dimension is not constrained. Lists are
  used for "any of" sets (e.g. `card_brand: ["Visa", "Mastercard"]`).
- `slots.<n>.active` — false when the user dropped a slot during
  approval, or trimmed the perimeter mid-watch. The skill keeps the
  slot in the file (with `dropped_by_user_at`) so review knows what
  was decided.
- `slots.<n>.where_overrides` — user-supplied tweaks to the SQL
  template's WHERE clause (rare; usually empty).
- `cadence_minutes` — current cadence. Initial value picked from the
  table in `SKILL.md`; can be changed mid-watch via user prompt.
- `already_reported.slot1` / `slot2` — append-only. Slot #1 / #2
  are one-shot per `kind` (`success` for #1; `success` and per-
  signature `failure` for #2). The first entry blocks all later
  entries of the same `kind`+combo.
- `already_reported.slot3` — keyed by `signature`. Each entry has
  `last_reported_at`; the dedup rule is "fire again only if `now -
  last_reported_at >= 6h`". `first_seen_at` does not change after
  creation.

### Dedup rules (canonical)

| Slot | Fire when | Suppress when |
|---|---|---|
| #1 success | No prior `slot1.success` entry | Any prior `slot1.success` entry |
| #2 success | No prior `slot2.success` entry | Any prior `slot2.success` entry |
| #2 failure | No prior `slot2.failure` entry with the same signature, or last fire was ≥ 6h ago | Any matching entry within 6h |
| #3 error | No prior `slot3` entry with the same signature, or last fire was ≥ 6h ago | Any matching entry within 6h |

`signature` for failures and errors is the canonicalised error
string with timestamps, IDs, and host names stripped, joined with
`@<call_site>`. Examples: `TIMEOUT@INTELISYS_SALE`,
`AVAIL_ERR_NOT_FOUND@SABRE_AVAIL`, `MISSING_FARE_BASIS@PRICING`.

## `report.md`

Human-readable rolling log. The agent appends per tick — never
rewrites or compacts. The user reads this when they say "show me
the latest on the Cuwwjgmr watch".

```markdown
# Post-deploy watch — Cuwwjgmr

- **Card:** [Intelisys Float card on our merchant for f8/f8 debit cards](https://trello.com/c/Cuwwjgmr)
- **Started:** 2026-05-09T13:48:02Z
- **Deploy time:** 2026-05-09T13:42:11Z (PR #1234 merged_at)
- **Spec:** Intelisys × F8 × multi-ticket × Visa/Mastercard × debit
- **Cadence:** 5 min
- **Findings:** printed inline in the chat session.
- **Slots active:** #1 happy path, #2 card target. (#3 dropped by user.)

## Tick log

### Tick 1 at 2026-05-09T13:48:02Z
- Window: [2026-05-09T13:42:11Z, 2026-05-09T13:48:02Z]
- Slot #1 SQL: 0 candidates.
- Slot #2 SQL: 0 candidates.
- No findings.

### Tick 2 at 2026-05-09T13:53:40Z
- Window: [2026-05-09T13:48:02Z, 2026-05-09T13:53:40Z]
- Slot #1 SQL: 4 candidates. Verified BK-19283746 (status.success=true). Reported in chat.
- Slot #2 SQL: 0 candidates.
- 3 candidates suppressed (Slot #1 already reported).

### Tick 3 at 2026-05-09T13:58:55Z
- Window: [2026-05-09T13:53:40Z, 2026-05-09T13:58:55Z]
- Slot #1 SQL: 7 candidates. All suppressed (Slot #1 one-shot already fired).
- Slot #2 SQL: 0 candidates.
- No findings.

…

## Summary (written when the user stops the watch)

- **Watched:** 2h 45min, 33 ticks.
- **Slot #1:** confirmed at tick 2 (BK-19283746). Continued to land — 412 successful Intelisys bookings observed total.
- **Slot #2:** confirmed at tick 5 (BK-19284001). 19 additional confirmed Float-on-F8/F8-debit successes after that — all suppressed.
- **Slot #3:** dropped by user at watch start.
- **Suggested move:** Done — happy path + card target both confirmed; no Slot #3 evidence to argue against.
```

### Append rules

- Tick header is `### Tick <N> at <ISO>`. Always include the window.
- Per-slot lines: SQL candidate count, verified count, fires
  (chat-reported), suppression count.
- The `## Summary` section is written exactly once when the user
  stops the watch — not re-written on resume.
- Resumed watches add a new heading: `## Session 2 — resumed at
  <ISO>` and continue tick numbering.
