# Known pitfalls

Living list of analyst-side traps in bookability investigations. Each entry: the cluster shape, why it tricks the report, and the disambiguation step the agent must run before assigning a verdict.

Read this file at the start of any bookability investigation that involves payment-shaped clusters (`PAYMENT_ERRORS` / `payment_error` / virtual-card / merchant-statement / loss-limit). Append a new entry every time a misjudgement is caught and corrected.

---

## Downtowntravel — `Virtual card merchant fare statement items failed` cluster

**ClickHouse signature:**

- `gds = 'downtowntravel'`
- `error_message = 'Virtual card merchant fare statement items failed'`
- `booking_step = 'Mv_Ota_Air_Booker->processVirtualCardMerchantFareStatementItems()'`
- `classification_category = 'PAYMENT_ERRORS'`, `classification_subcategory = 'Payment declined'`
- `main_group_error = sub_group_error = 'Mv_Ota_Air_Booker_Exception_PaymentDeclined'`

**MySQL fingerprint:** `bconta.error = 'payment_error'`, `bookings.status = 'cancelled'`, `bookings.cancel_reason = 'aborted'`, `bookings.checkout_status = 'pending'`. Always `multiticket_part IS NULL`.

### Why it tricks the report

The cluster's wrapper text reads like a bookability failure ("merchant fare statement items"), and `standard_bookability_report.md` § *Mandatory: Mongo evidence for payment-side clusters* documents one variant where this cluster is **misclassified**: a successful Payhub `Sale` followed by a post-Sale `loss-limit-fare-increase` and a `DeferredRefundPaidStatementItemsAction::run` reversal. That variant exists. **It is not the only variant.**

The same `processVirtualCardMerchantFareStatementItems()` cleanup chain fires after **either**:

- **(A) Sale failed** (cc_decline / Suspected Fraud) → cleanup tears down the issued virtual card → genuine **PAYMENT** failure. CH classification correct.
- **(B) Sale succeeded** → post-Sale fare increase or supplier-side rejection → cleanup reverses the customer charge → genuine **BOOKABILITY** failure. CH classification wrong; reclassify.

`bookings.cancel_reason = 'aborted'` does **not** disambiguate. It is the wrapper the app sets for **any** post-Sale-failure cleanup, including post-cc_decline merchant-statement reversals. Do not cite it on its own as evidence of a bookability failure.

### Disambiguation step (mandatory before any reclassification claim)

For the cluster's `transaction_id`s, count Sale responses and split by success. Same query also surfaces whether `loss-limit-fare-increase` fires before or after the successful Sale.

```bash
set -a && source .env && set +a
cat > /tmp/sale_outcome.json <<'EOF'
[
  {"$match": {
    "transaction_id": {"$in": ["<HASH1>", "<HASH2>", "..."]},
    "context": "payhub_api_response_Momentum\\Payhub\\Request\\Sale"
  }},
  {"$project": {
    "transaction_id": 1,
    "is_success": {"$regexMatch": {"input": "$response", "regex": "\"success\":\\s*true"}}
  }},
  {"$group": {
    "_id": "$transaction_id",
    "sales_total": {"$sum": 1},
    "sales_succeeded": {"$sum": {"$cond": ["$is_success", 1, 0]}}
  }}
]
EOF
python3 .cursor/skills/db_access/scripts/mongo_query.py aggregate debug_logs "$(cat /tmp/sale_outcome.json)" ota --json
```

For each cluster transaction whose `sales_succeeded >= 1`, pull the per-event timeline to confirm whether `loss-limit-fare-increase` fires **after** the successful `Sale`:

```bash
python3 .cursor/skills/db_access/scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id":"<HASH>","context":{"$in":["loss-limit-fare-increase","payhub_api_response_Momentum\\Payhub\\Request\\Sale"]}}' \
  --sort '{"date_added":1}' --limit 50 \
  --projection '{"_id":1,"date_added":1,"context":1}' --json
```

### Decision rule

| Mongo evidence | CH classification | Action in the report |
|---|---|---|
| `sales_succeeded = 0` across the cluster's transactions | `PAYMENT_ERRORS` correct | Leave classified as payment. Cluster is genuine card-decline cascade plus its merchant-statement cleanup. **Do not include in the bookability denominator.** |
| `sales_succeeded ≥ 1` for some transactions, but every `loss-limit-fare-increase` fires **before** the corresponding successful Sale | `PAYMENT_ERRORS` correct for the cluster fires (cluster fires sit on the failed-Sale retries within multi-attempt sessions; the successful Sale produces a separate `booking_id` outside the cluster) | Leave classified as payment. Note in the report's `Explanation` that the customer eventually booked on a different `booking_id` — that fact belongs in the recovery-rate row, not in a reclassification row. |
| `sales_succeeded ≥ 1` AND `loss-limit-fare-increase` fires **after** the successful Sale, immediately preceding `DeferredRefundPaidStatementItemsAction::run` | `PAYMENT_ERRORS` wrong | Reclassify as bookability. Quote the post-Sale `loss-limit-fare-increase` `_id` as the anchor in `Sample session`. State the reclassification consequence in the failure-causes row's `Supplier verbatim` ("drops the bookability rate from X to Y"). |

### Recorded misjudgement — 2026-05-05

The 2026-05-05 standard bookability report flagged this cluster as misclassified and projected the bookability rate dropping from **90.1 %** (301 / 334) to **86.0 %** (301 / 350). The deep-dive evidence proved otherwise:

- 16 ClickHouse rows, 14 distinct `transaction_id`s, 21 cluster `booking_id`s.
- 45 Payhub `Sale` attempts across the 14 sessions: **11 succeeded, 34 failed** (35 carried "Do Not Honor" / "Call Voice Center", 16 carried "Suspected Fraud" — overlap because each response cascades across Nuvei → ConnexPay → Chase).
- 9 / 14 sessions ended with the customer booked on a separate `booking_id` (7 on Downtowntravel, 2 fell back to Amadeus). Those successful `booking_id`s did **not** appear in the cluster.
- Every `loss-limit-fare-increase` event in the cluster's transactions fired **before** the Sale, never after a successful one.

Verdict: variant **(A)** for every transaction in window. The 90.1 % rate stood. The "drops to 86.0 %" claim was wrong and was retracted in the deep-dive report.

Lesson: never reclassify this cluster from a CH-only signature plus a `cancel_reason = aborted` confirmation. Run the disambiguation step first.

---

## Amadeus / Wenrix — tickets issued, booking still `not_issued` after MySQL gone-away

**Surface shape (single-booking, not a ClickHouse rate cluster):**

- `bookings.status = 'not_issued'`, `process_status = 'open'`, ticketing task (`type = 1`) still `unresolved`.
- Agent report: “pending ticketing” / “not queued to Wenrix” because `booking_tasks.sent_to_queue = 0` and `handle_type = 'manual'`.
- `booking_work_orders.type = 'ticket/process'` and `status = 'sleeping'`.
- `booking_tickets` already has `status = 'issued'` rows (`processed = 0`).

**MySQL fingerprint:** `booking_wenrix_reservations.status = 201`; latest `booking_wenrix_reservation_notifications.status = 'ticketed'`; `booking_tickets.processed = 0`.

### Why it tricks the report

ResPro and the ticketing-task flags look like Wenrix never received the booking. `sent_to_queue` is the **agent / GDS task queue**, not the Wenrix send. The Wenrix send is `booking_wenrix_reservations` plus `debug_logs` context `wenrix-api-call:reservations`.

A second trap: Amadeus can already have issued the tickets. After `DocIssuance_IssueTicket` returns `OK ETICKET WELL ISSUED`, `IssueTicketsPipe` writes a success note. If MySQL then returns `SQLSTATE[HY000]: General error: 2006 MySQL server has gone away`, post-issue pipes (`ResolveBookingAsTicketedPipe`) never run. Booking stays `not_issued`. Work order stays `sleeping`. Escalation to a Wenrix manual-ticket child also fails on the same dead connection.

### Disambiguation step (mandatory before “not queued” or “re-issue”)

```sql
SELECT id, status, process_status FROM ota.bookings WHERE id = <booking_id>;
SELECT id, status, optimization_type, reference, created_at
FROM ota.booking_wenrix_reservations WHERE booking_id = <booking_id>;
SELECT type, status, created_at
FROM ota.booking_wenrix_reservation_notifications
WHERE wenrix_reservation_id IN (
  SELECT id FROM ota.booking_wenrix_reservations WHERE booking_id = <booking_id>
);
SELECT ticket_number, status, issued_date, processed
FROM ota.booking_tickets WHERE booking_id = <booking_id>;
SELECT id, type, status FROM ota.booking_work_orders WHERE booking_id = <booking_id>;
```

```bash
python3 .cursor/skills/db_access/scripts/mongo_query.py find debug_logs ota \
  --filter '{"transaction_id":"<HASH>","context":{"$in":["wenrix-api-call:reservations","amadeus-sh4-api[YKXC42100] DocIssuance_IssueTicket_9_1","Mv_Ota_Booking_Note_Record::save()"]}}' \
  --sort '{"date_added":1}' --limit 20 --json
```

Swap the office in the `DocIssuance` context for the booking’s `gds_account_id`.

### Decision rule

| Evidence | What happened | Action |
|---|---|---|
| No `booking_wenrix_reservations` row and no `wenrix-api-call:reservations` HTTP 201 | Never sent to Wenrix | Treat as a real queue miss. |
| Reservation HTTP 201, notifications still `optimizing_pnr`, no `booking_tickets` | Still waiting on Wenrix | Do not escalate as “not queued”. Wait or check the issuance deadline. |
| `DocIssuance` free text `OK ETICKET WELL ISSUED` **and** `Mv_Ota_Booking_Note_Record::save()` `2006 MySQL server has gone away` | Tickets issued; bookkeeping crashed | **Do not re-issue. Do not re-queue to Wenrix.** Refresh the PNR from Amadeus, mark the booking issued, resolve the ticketing task. |

### Recorded case — 2026-08-13, booking `305516461`

Wenrix reservation `41586911` HTTP 201 at 2026-08-07 07:18:41 America/Montreal. Notification `ticketed` at 2026-08-11 06:54:33. Amadeus `DocIssuance_IssueTicket_9_1` returned `OK ETICKET WELL ISSUED CAD1424 80` ([log](https://reservations.voyagesalacarte.ca/debug-logs/log-group/fdc65df156f3326742680918841d15c4#6a7aff74f98406fc1408896c)). Next millisecond: note-save `2006 MySQL server has gone away` ([log](https://reservations.voyagesalacarte.ca/debug-logs/log-group/fdc65df156f3326742680918841d15c4#6a7aff74f98406fc1408896d)). Tickets `147-4828388214` / `147-4828388215` existed; `bookings.status` stayed `not_issued`; work order `133937731` stayed `sleeping`.

Lesson: check `booking_tickets` and the `DocIssuance` reply before treating a Wenrix booking as unqueued or unticketed.

---

## Adding a new entry

Append a new `## <supplier> — <cluster name>` section under this same shape:

1. **ClickHouse signature** — the exact tuple that selects the cluster.
2. **MySQL fingerprint** — `bconta.error`, `bookings.status` / `cancel_reason` / `checkout_status` values.
3. **Why it tricks the report** — the specific surface evidence that misleads.
4. **Disambiguation step** — runnable Mongo / SQL command(s).
5. **Decision rule** — small table mapping evidence → classification.
6. **Recorded misjudgement** — the date, the wrong claim, the correcting evidence, the lesson. Keep this section even after the upstream classifier is fixed; future analysts learn from past mistakes.
