## booking_tasks

**Database:** `ota`
**Engine:** InnoDB  |  **Rows:** ~58.4 M  |  **Size:** large
**Purpose:** Agent task queue for post-booking operations. Each booking generates one or more tasks (typed by integer codes) that are worked by agents or automated systems. Tracks lifecycle status, escalation, queue assignment, and whether a booking is a test.

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment row ID |
| `booking_id` | int FK | → `bookings.id` (indexed) |
| `type` | int | Task type code (1 = ticketing, higher codes = specific ops tasks) |
| `deadline_date` | datetime | SLA deadline for this task |
| `agent_group_id` | int | Assigned agent group (0 = unassigned) |
| `status` | enum | `unresolved` / `resolved` (indexed) |
| `is_open` | tinyint(1) | 1 = task is in active agent queue (indexed) |
| `sleep_until` | datetime | Task is snoozed until this time, nullable |
| `handled_by` | int | Agent user ID currently handling (indexed); 0 = none |
| `created_by` | int | Agent/system that created the task. **`0` = created by the system**, any non-zero = agent user id. |
| `resolved_by` | int | User id that resolved the task, nullable. **`0` = resolved by the system** (e.g. an auto-void / auto-cancel ran), any non-zero = agent user id, `NULL` = still unresolved. This is the canonical column the team reads to split system-vs-agent task resolution. **Do not use `handle_type` for that split** — `handle_type` describes the queue routing intent, not who actually closed the row. |
| `create_date` | datetime | Task creation timestamp (indexed) |
| `open_date` | datetime | When task was opened/assigned |
| `resolve_date` | datetime | When task was resolved (indexed), nullable |
| `parent_task_id` | int | Parent task ID for sub-tasks (indexed), nullable |
| `parent_task_type` | int | Parent task type code, nullable |
| `has_unresolved_children` | tinyint(1) | 1 = has unresolved child tasks |
| `note` | text | Free-text agent note on this task |
| `was_aborted` | tinyint | 1 = task/booking was aborted (used by ResPro cancel flow) |
| `sent_to_queue` | tinyint(1) | 1 = sent to external processing queue |
| `max_queued_date` | datetime | Latest queue send timestamp, nullable |
| `handle_type` | enum | `manual` / `auto` — queue routing intent set at task creation. **Not** a reliable signal for "did the system actually close this row" — use `resolved_by = 0` for that. |
| `next_check_auto_queued` | datetime | Next scheduled auto-check time, nullable |
| `is_long_term` | tinyint(1) | 1 = flagged as a long-running task |
| `is_escalated` | tinyint(1) | 1 = escalated to senior agent |
| `is_urgent` | tinyint(1) | 1 = marked urgent |
| `qa_task_id` | int | Linked QA review task (indexed), nullable |
| `num_sleeps` | int | Number of times task has been snoozed, nullable |
| `agent_level` | int | Required agent seniority level (default 2) |
| `ticket_during_checkout` | tinyint(1) | 1 = ticketing was triggered inline during checkout |
| `cc_change_deadline` | datetime | Deadline for credit card change, nullable |
| `assigned_to` | int | Specific agent assigned, nullable |
| `num_sc_emails_sent` | int | Number of schedule-change emails sent (default 0) |
| `sent_to_fulfillment` | tinyint(1) | 1 = sent to fulfillment partner |
| `is_test_booking` | tinyint(1) | 1 = mirrors `bookings.is_test`; test tasks excluded from agent queues |
| `sent_to_sos` | tinyint(1) | 1 = sent to SOS (emergency operations) |
| `related_booking_id` | int | Related booking for linked tasks (indexed), nullable |
| `sc_type` | enum | Schedule-change type: `SC1` / `SC2` / `SC3` (indexed), nullable |
| `sc_state` | enum | Booking workflow state: `CLL` called, `CLL_UTR1`, `UTR` under review, `TKT` ticketed, `CBK` cancelled, `CBK_UTR1`, `issued`, `unclassified` (indexed), nullable |
| `cc_decline_type` | varchar(25) | Card decline category code, nullable |

**Key relationships:**
- `booking_id` → `ota.bookings.id`
- `parent_task_id` → `ota.booking_tasks.id` (self-referential for sub-tasks)
- `related_booking_id` → `ota.bookings.id`

**Common queries:**
```sql
-- All tasks for a booking
SELECT id, type, status, is_open, was_aborted, is_test_booking,
       sc_state, create_date, resolve_date
FROM ota.booking_tasks
WHERE booking_id = 12345
ORDER BY create_date;

-- QA assertion: confirm ticketing task created (type=1) during checkout
SELECT id, type, status, ticket_during_checkout, is_test_booking
FROM ota.booking_tasks
WHERE booking_id = 12345 AND type = 1;

-- QA assertion: confirm booking was aborted (after ResPro cancel)
SELECT id, was_aborted, status, resolve_date
FROM ota.booking_tasks
WHERE booking_id = 12345;
```

**Query guidance:**
- **Size class:** large (58 M rows) — always filter by `booking_id`
- **Recommended constraints:** `booking_id` (indexed); add `type` or `status` to narrow
- **Typical date range:** not applicable at row level; constrain via `create_date` for bulk queries

**Notes:**
- `is_test_booking = 1` mirrors `bookings.is_test = 1`. Test tasks are excluded from production agent queues — safe to create on production if `is_test=1`.
- Task type `1` is the primary ticketing task; it is created at checkout (`ticket_during_checkout = 1`) or shortly after.
- `was_aborted = 1` is set by the ResPro abort flow; the QA `cleanup: auto` validator should assert this field after cancellation.
- `sc_state` tracks the booking through its post-ticketing lifecycle; QA happy-path value after successful booking is typically `TKT` (ticketed) or `issued`.
- `status = 'unresolved'` is the initial state; agents or automation set it to `resolved` on completion.
- **System-vs-agent resolution split (team convention).** Bucket resolved void / cancel / ticketing tasks with `resolved_by = 0` → system-resolved, `resolved_by != 0` → agent-resolved. The same convention applies to `created_by` for "who created the task". Example bucket query:
  ```sql
  SELECT
    CASE
      WHEN status = 'unresolved' THEN 'unresolved'
      WHEN resolved_by = 0       THEN 'resolved_by_system'
      ELSE                            'resolved_by_agent'
    END AS resolution,
    COUNT(*) AS c
  FROM ota.booking_tasks
  WHERE type = 12 AND create_date >= NOW() - INTERVAL 6 HOUR
  GROUP BY resolution;
  ```
  Verified 2026-06-11: 30 d FR24 void window (`type=12`, `b.gds='Flightroutes24'`) returned 304 agent-resolved + 41 unresolved + 0 system-resolved — consistent with the feature not having shipped yet.
