# Ancillaries

Baggage and other add-ons: how they are optimized, priced, and attached to a booking. The thinnest subsystem file — extend it as investigations touch this area.

_Schemas: `../../db_access/db-docs/mysql/ancillaries_optimization_baggage.md`, `ancillaries_optimization_baggage_options.md`. Seeded 2026-07-30; extend via the maintenance loop._

## What it covers

- Baggage optimization: the options a supplier offers and which the platform selects / prices for a booking.
- Fare families available at a point in the flow surface in `debug_logs` as `available_fare_families` / `base_fare_family` (fare-family choice drives what ancillaries apply).

## Normal vs abnormal

- **Normal:** baggage / ancillary options resolve to the expected fare family and price; the selection matches what the user chose.
- **Abnormal signals:** missing baggage option, a price that disagrees with the fare family, an ancillary attached to the wrong passenger / segment, or fare-family drift between search and book.

## Where to look (evidence map)

- **MySQL `ota`:** `ancillaries_optimization_baggage`, `ancillaries_optimization_baggage_options`; per-passenger / per-segment detail in `booking_passengers` / `booking_segments`.
- **MongoDB `ota.debug_logs`:** `available_fare_families` / `base_fare_family` / `package` fields on the transaction's logs.
- Full evidence map: [`observability.md`](observability.md).

## Open gaps (fill via investigations)

- The baggage-optimization decision logic and its failure modes are not yet documented in behavioral detail. When an ancillary investigation confirms how a selection or price is decided, propose the behavior here and cite the genesis code path.
