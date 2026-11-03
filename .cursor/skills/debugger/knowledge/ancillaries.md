# Ancillaries

Baggage and other add-ons: how they are optimized, priced, and attached to a booking. The thinnest subsystem file — extend it as investigations touch this area.

_Schemas: `../../db_access/db-docs/mysql/ancillaries_optimization_baggage.md`, `ancillaries_optimization_baggage_options.md`, `booking_ancillaries.md`. Last updated 2026-10-21 (multiticket baggage layout). Seeded 2026-07-30; extend via the maintenance loop._

## What it covers

- Baggage optimization: the options a supplier offers and which the platform selects / prices for a booking.
- Fare families available at a point in the flow surface in `debug_logs` as `available_fare_families` / `base_fare_family` (fare-family choice drives what ancillaries apply).

## Normal vs abnormal

- **Normal:** baggage / ancillary options resolve to the expected fare family and price; the selection matches what the user chose.
- **Abnormal signals:** missing baggage option, a price that disagrees with the fare family, an ancillary attached to the wrong passenger / segment, fare-family drift between search and book, or Gordian create-trip HTTP 400 `failed_to_parse_fare_basis`.

## Where to look (evidence map)

- **MySQL `ota`:** `ancillaries_optimization_baggage`, `ancillaries_optimization_baggage_options`; per-passenger / per-segment detail in `booking_passengers` / `booking_segments`.
- **MongoDB `ota.debug_logs`:** `available_fare_families` / `base_fare_family` / `package` fields on the transaction's logs. Gordian create-trip: `POST https://api.gordiansoftware.com/v2.2/trip` and `GordianServiceProvider::createTrip`.
- Full evidence map: [`observability.md`](observability.md).

## Gordian create-trip fare basis

Gordian accepts fare basis as **uppercase letters and digits only**. A caret (`^`) or slash (`/`) returns HTTP 400 `failed_to_parse_fare_basis` / `invalid format for fare_basis; must be uppercase alphanumeric`.

Dida often sends adult and child on one segment as `ADT^CHD` (see [`content-sources.md`](content-sources.md)). Checkout copies that string into Gordian with no strip. Fare-family matching already strips to the first alphanumeric part (`getCleanFareBasis`). That helper is **not** used on the Gordian create-trip path. Confirmed 2026-08-21 on `fa10e7959efbf56a62365159120db3ee` ([error log](https://staging58-reservations.voyagesalacarte.ca/debug-logs/log-group/fa10e7959efbf56a62365159120db3ee#6a887c77ba2ca3f9c00fbdc4)).

## Baggage fulfillment failure reasons

Confirmed 2026-10-09 (genesis `develop` `e85dc7645f6`, MySQL `ota`, window 2026-09-09 → 2026-10-09).

- **Task tree.** Each post-booking bag purchase is a `booking_tasks` row `type = 2030` (Work Order Process [Baggage], system-owned). When the system cannot buy the bag, an agent works a child `type = 20` (Fulfillment) row (`parent_task_id` = the 2030 row).
- **System reason.** On abort, the 2030 row `note` holds the reason: `Failed to authorize baggage statement items` (customer card), `Failed to process baggage requests` (no request reached `processed`; generic — set by `ResolveOrAbortBaggageTaskPipe`), `booking_was_aborted`, `Auto-aborted by baggage unresolved task processor: …` (cancelled / departed), raw Gordian HTTP errors. Written by `BaggageProcessor::interruptPipeline` → `abortTasks($e->getMessage())`.
- **Agent reason.** Free text only, in the child `type = 20` row `note` (ResPro "Abort Task" button, `Task::actionAbortTask`). Also copied to `booking_notes` as `Task aborted: <note>`. Query `booking_tasks.note`, not `booking_notes` — it is filtered by `type` + `create_date` and runs in ~1 s.
- **No reason code for bags.** ResPro's structured abort dropdown (`Mv_Ota_Cms_Service_Form_Abort::ABORT_REASONS`, saved as JSON `form.abort_reason` in `aft_support_forms`) is used for exchange / cancel / schedule-change requests, but baggage work orders are not in that map and baggage tasks are aborted through the free-text path. 0 baggage rows in `aft_support_forms` in the window.
- **Per-bag status.** `baggage_requests.status` (`processed` / `failed` / `aborted` / …) by `provider` (`manual` = agent fulfillment). No error column; `payload` holds supplier ids only.
- **`booking_ancillaries` (`service_code = 'X-BAGGAGE'`).** On a failed bag, `status` is `gordian_fulfillment_failed` (Gordian) or `issuance_failed` (every other supplier), set by `BaggageProcessor::interruptPipeline` and the supplier service providers. These are outcomes, not reasons. `quote_increase` is written only by the Farelogix NDC / NDC-ONE / Frontier NDC suppliers; last `X-BAGGAGE` row 2024-07-19. The Amadeus quote-increase check (`GuardAgainstQuoteIncreaseStep`) keeps that status in memory and logs it; the row ends as `issuance_failed`.
- **Gordian reason in Mongo.** Webhook log `context: "(GordianBaggage webhook) Updating baggage requests"`, field `payload.trip.last_action.errors[]`. 30 days to 2026-10-09: 857 webhooks with a failed bag — 716 `InternalError: An unexpected error occurred`, 141 empty. Gordian fails the bag with event `manual_fulfill_fail` and gives no usable reason. Sample `95396875805e63512fe9146804c4763a#6ac0f3e7a153ea17da0f29fd`.
- **Amadeus reason in Mongo.** `context: "Momentum\\GdsCommandIssuer\\CommandIssuer\\Pnr\\Amadeus\\Steps\\Baggage\\BaggageIssuancePassable->log()"`. Keys: `BookPriceService rolled back unconfirmed SSRs` (airline did not confirm the bag SSR; 135 in 30 days), `quote-increase-detected` (quoted vs confirmed price; 1 in 30 days, `2b8ec1f79ae2b31940cf3003184a3a70#6aaeee3cced66a66c20d540a`).
- **Time zones.** MySQL `booking_tasks.create_date` is Eastern time; Mongo `date_added` is UTC (task 07:32 ↔ logs 11:32 on 2026-10-03).

## Multiticket baggage layout

Confirmed 2026-10-21 (MySQL `ota`, master bookings with `booking_date` 2026-10-07 → 2026-10-21 Eastern, `is_test = 0`). Schema: [`bookings.md`](../../db_access/db-docs/mysql/bookings.md) (`multiticket_relationship_type`, `multiticket_related_booking_id`).

On a multiticket trip, baggage rows are split across the two bookings. Reconcile baggage per trip (master + slave), never per booking.

- **Baggage task: always on the master.** 1,240 of 1,284 masters with a bag on the trip have a `type = 2030` task; 0 of 1,241 slaves do.
- **Bags and bag charges: on the leg the bag flies on.** `booking_ancillaries` `X-BAGGAGE` rows and `ancillary_chargeable_baggage` ledger rows sit on the master for outbound bags and on the slave for return bags. The slave's bag request (`baggage_requests`) is also on the slave.
- **Baggage fee: on either leg.** Of 904 trips with a bag on the slave: 593 have the whole `baggage_fee` on the master, 193 on both legs, 89 on the slave only, 29 none. So a master can show one fee row per leg (e.g. 2 × 14.26 for 1 bag on the master) and a slave can show bags with no fee. Neither is an error on its own.
- **Currency.** Both legs used the same booking currency on all 1,471 trip pairs checked, so amounts add up directly.

Examples (open in ResPro, both legs):

- Master [310577441](https://reservations.voyagesalacarte.ca/booking/index/310577441) / slave [310577431](https://reservations.voyagesalacarte.ca/booking/index/310577431): 1 bag per leg; both 14.26 CAD fees on the master (03:50:56 with the master bag, 03:53:57 with the slave bag).
- Master [310331001](https://reservations.voyagesalacarte.ca/booking/index/310331001) / slave [310331031](https://reservations.voyagesalacarte.ca/booking/index/310331031): task on the master; the only bag, its charge, its fee and its request on the slave.
- Master [310456191](https://reservations.voyagesalacarte.ca/booking/index/310456191) / slave [310456221](https://reservations.voyagesalacarte.ca/booking/index/310456221): both fees (2 × 28.48 CAD) on the master; the 2 slave bags failed and the slave charge was voided, but the slave's fee on the master was kept.

**Pitfall.** Per booking, these trips look like "fee charged twice" (master) and "bag with no fee" or "no baggage task" (slave). In a 14-day per-booking run (2026-10-07 → 2026-10-20) 2,561 of 7,816 baggage bookings were one leg of a trip, and almost every "fee charged twice" and "fee with no bag" finding disappeared at trip level. Map each booking to its trip with `CASE WHEN multiticket_relationship_type = 'slave' AND multiticket_related_booking_id > 0 THEN multiticket_related_booking_id ELSE id END`.

```sql
-- Where baggage rows sit, by multiticket leg
-- verified 2026-10-21, masters booked 2026-10-07 → 2026-10-21 (Eastern), returned 2 rows in ~1 s
WITH masters AS (
  SELECT m.id AS master_id, m.multiticket_related_booking_id AS slave_id
  FROM ota.bookings m
  WHERE m.multiticket_relationship_type = 'master'
    AND m.booking_date >= '2026-10-07' AND m.booking_date < '2026-10-21'
    AND m.is_test = 0
),
legs AS (
  SELECT master_id, master_id AS booking_id, 'master' AS leg FROM masters
  UNION ALL
  SELECT master_id, slave_id, 'slave' FROM masters WHERE slave_id > 0
),
bag_trips AS (
  SELECT DISTINCT l.master_id
  FROM legs l JOIN ota.booking_ancillaries a ON a.booking_id = l.booking_id AND a.service_code = 'X-BAGGAGE'
)
SELECT l.leg,
       SUM(EXISTS(SELECT 1 FROM ota.booking_tasks t WHERE t.booking_id = l.booking_id AND t.type = 2030)) AS has_bag_task,
       SUM(EXISTS(SELECT 1 FROM ota.booking_statement_items s WHERE s.booking_id = l.booking_id AND s.type = 'baggage_fee' AND s.status = 'paid')) AS has_bag_fee,
       SUM(EXISTS(SELECT 1 FROM ota.booking_ancillaries a WHERE a.booking_id = l.booking_id AND a.service_code = 'X-BAGGAGE')) AS has_bag,
       SUM(EXISTS(SELECT 1 FROM ota.booking_statement_items s WHERE s.booking_id = l.booking_id AND s.type = 'ancillary_chargeable_baggage' AND s.status = 'paid')) AS has_bag_charge,
       COUNT(*) AS legs
FROM legs l
JOIN bag_trips t ON t.master_id = l.master_id
GROUP BY l.leg;
```

| leg | has_bag_task | has_bag_fee | has_bag | has_bag_charge | legs |
|-----|--------------|-------------|---------|----------------|------|
| master | 1,240 | 1,103 | 987 | 904 | 1,284 |
| slave | 0 | 282 | 904 | 863 | 1,241 |

The fee split (593 / 193 / 89 / 29) comes from the same `masters` CTE: trips with an `X-BAGGAGE` row on the slave, summing paid `baggage_fee` sales per leg. That query took ~8 minutes (an `IN (master_id, slave_id)` join); use `UNION ALL` legs like above if you rerun it.

## Seat refund cron

Confirmed 2026-10-15 (genesis `develop` `265358aefbf`, MySQL `ota`, departures 2026-10-01 → 2026-10-08 Eastern). Schema: [`booking_ancillaries.md`](../../db_access/db-docs/mysql/booking_ancillaries.md).

- **What runs.** `Mv_Ota_Cms_Cron_Ancillaries_RefundUnfulfilledSeats` (genesis `include/Mv/Ota/Cms/Cron/Ancillaries/RefundUnfulfilledSeats.php`), every day at 08:00 Eastern (`config/prod3_common/crontab.txt:198-199`). It handles bookings whose `departure_date` was yesterday. The `…RefundUnfulfilledSeatsNew` line below it is commented out.
- **What it refunds.** Customer-side seat money for seats not confirmed 1 hour before departure, as two processors:
  - `seatmap_fee` (our fee): fee paid × seats not confirmed ÷ seats requested.
  - `ancillaries_fee` → item `ancillary_chargeable_seat`, `payment_processor <> 'agency'` (airline seat price): price paid − converted `quoted_price` of confirmed seats, only when the gap is > 0.01.
  - Both subtract refunds already paid on that item type.
- **"Confirmed" comes from history, not the live row.** Per passenger + segment it reads `booking_ancillaries_history`. The seat counts as confirmed when a `customer_status = 'confirmed'` row for the first-requested seat, or any `manual_save` row, was saved at least 1 hour before departure (`RefundUnfulfilledSeats.php:150-228`).
- **Skips.** Seats first requested less than 1 hour before departure (`:207`). Bookings without a resolved ticket task (`booking_tasks.type = 1`, also checked on the multi-ticket partner). Bookings with a resolved void task (`type = 12`). Bookings assigned to the ResPro `chargeback` team (`:596-603`). Bookings that already have a `processor_transaction_auto_refund` row for that processor — one refund per booking per processor, ever (`:29-31`, `:89-97`).
- **What it writes.** One `processor_transaction_auto_refund` row per booking + processor (`status` 1 = executed, 2 = failed). One refund statement item: `transaction_type = 'refund'`, `created_by = 0`, `paid_by = 0`, `status = 'paid'`, or `deleted` when the processor refund failed. One booking note from employee 0: `$X is refunded to the customer due to unconfirmed seats request(s).` (`ancillaries request(s)` for the seat price). Code: `src/Payment/VirtualCard/Supplier/Task/Handlers/ServiceFeeHandler.php:45-79` (`refund(cms_agent_id: 0)`). It writes nothing to `booking_ancillaries`.
- **How to spot it in the ledger.** System refund (`created_by = 0`), customer side, created the day after departure at hour 8. Other system refunds of seat items happen at other times (18 rows in the window below: 17 before departure, 1 six days after); do not count them as the cron.

```sql
-- Seat refund cron output by item type and status
-- verified 2026-10-15, departures 2026-10-01 → 2026-10-08 (Eastern), returned 4 rows in ~1 s
SELECT bsi.type, bsi.status,
       COUNT(*)                          AS refund_rows,
       ROUND(-SUM(bsi.customer_amount), 2) AS refunded
FROM ota.bookings b
JOIN ota.booking_statement_items bsi ON bsi.booking_id = b.id
WHERE b.departure_date >= '2026-10-01'
  AND b.departure_date <  '2026-10-08'
  AND b.is_test = 0
  AND bsi.type IN ('seatmap_fee', 'ancillary_chargeable_seat')
  AND bsi.transaction_type = 'refund'
  AND bsi.payment_processor <> 'agency'
  AND COALESCE(bsi.created_by, 0) = 0
  AND DATE(bsi.create_date) = DATE(b.departure_date) + INTERVAL 1 DAY
  AND HOUR(bsi.create_date) = 8
GROUP BY bsi.type, bsi.status
ORDER BY bsi.type, bsi.status;
```

| type | status | refund_rows | refunded |
|------|--------|-------------|----------|
| `ancillary_chargeable_seat` | `paid` | 317 | 17,650.55 |
| `ancillary_chargeable_seat` | `deleted` | 1 | 360.32 |
| `seatmap_fee` | `paid` | 602 | 29,265.85 |
| `seatmap_fee` | `deleted` | 4 | 391.76 |

Cross-check: `processor_transaction_auto_refund`, `date_created` 2026-10-02 → 2026-10-09: `seatmap_fee` 602 executed + 4 failed; `ancillaries_fee` 315 executed + 2 failed. Booking notes in the same departure window: 602 `seats`, 315 `ancillaries`. Amounts are in each booking's own currency, summed as-is.

Per-booking version (requested vs confirmed seats, expected vs actual refund, skip reason, agent touches): [`reports/seat_charges_per_booking.sql`](/Users/filippmozolevskiy/Repositories/agents_setup/reports/seat_charges_per_booking.sql) (local, gitignored).

## Open gaps (fill via investigations)

- The baggage-optimization decision logic and its failure modes are not yet documented in behavioral detail. When an ancillary investigation confirms how a selection or price is decided, propose the behavior here and cite the genesis code path.
