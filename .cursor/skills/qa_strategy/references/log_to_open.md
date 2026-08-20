# Log in the observe line — worked examples

Loaded from `SKILL.md` Step 2 (harvest) and Step 4 (card template). Spec: [`../docs/2026-08-20-card-dod-qa-design.md`](../docs/2026-08-20-card-dod-qa-design.md).

At most two numbered lines before **EXPECT:** (action, then observe). Do not use a Log to open slot. The last observable line is **EXPECT:**.

## 1. Request field changed (Unififi verify-price payload)

The later verify-price used to send the short value from the first verify response. Proof is the Baggage Optimization entry, not the first Check Availability verify. Same `context` twice; `_scopes` picks the right row.

```markdown
- [ ] Later verify-price keeps the search payload
  - Test 1: Baggage Optimization verify uses the four-part payload ✅❌❓
    *Why:* a later verify-price used to send the short value from the first verify response. Unififi then rejects the fare.
    1. Drive one Unififi checkout that also runs baggage optimization. Note `search_id`.
    2. Open `unififi-api[UNIFIFIUSD] verify-price` (`_scopes` `Baggage Optimization`). Confirm Request `routing.payload`. Before: https://reservations.voyagesalacarte.ca/debug-logs/log-group/4fb9a689ac78f75460b7019b5dd4bbe3#6a7def0b346422a5da00e4e6
    **EXPECT:** that later verify Request `routing.payload` is the four-part search value (`V4#uuid#N#longId`), not `V4#uuid`.
```

Do not paste an after permalink. QA confirms the new shape on the session they drove.

## 2. Logic changed, Request body did not (secondary surface)

The supplier Request is the same. The contestant is now dropped or kept under a new limit. Opening the verify-price log is not the proof.

```markdown
- [ ] Fare above the new loss limit is dropped ✅❌❓
  *Why:* the loss-limit threshold changed. The supplier still sees the same verify-price Request.
  1. Drive one checkout whose verify-price is above the new limit. Note `search_id`.
  2. Open `unififi-api[UNIFIFIUSD] verify-price`. Request is unchanged. Proof is the contestant-attempts row.
  **EXPECT:** that attempt has `status=0` and error `loss_limit_fare_increase`.
```

Secondary-surface order (first match that moves): log-group entry count → contestant-attempts → ClickHouse booking errors → ResPro field → user-facing page or confirmation email. If none move, drop the check and say so in the chat reply, not on the card.
