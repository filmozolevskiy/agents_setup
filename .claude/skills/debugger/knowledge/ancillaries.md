# Ancillaries

Baggage and other add-ons: how they are optimized, priced, and attached to a booking. The thinnest subsystem file — extend it as investigations touch this area.

_Schemas: `../../db_access/db-docs/mysql/ancillaries_optimization_baggage.md`, `ancillaries_optimization_baggage_options.md`. Last updated 2026-08-21 (Gordian fare-basis). Seeded 2026-07-30; extend via the maintenance loop._

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

## Open gaps (fill via investigations)

- The baggage-optimization decision logic and its failure modes are not yet documented in behavioral detail. When an ancillary investigation confirms how a selection or price is decided, propose the behavior here and cite the genesis code path.
