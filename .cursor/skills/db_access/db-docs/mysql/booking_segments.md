## booking_segments

**Database:** `ota`
**Engine:** InnoDB  |  **Rows:** ~124.7 M  |  **Size:** very large
**Purpose:** One row per flight segment per booking. Stores the full itinerary — origin/destination airports, departure/arrival times, marketing and operating carriers, cabin class, fare basis, baggage allowance, and segment lifecycle status.

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment row ID |
| `host_token_key` | varchar(30) | NDC host token reference, nullable |
| `booking_id` | int FK | → `bookings.id` (indexed) |
| `from_airport_code` | varchar(3) | Origin IATA airport code (indexed) |
| `to_airport_code` | varchar(3) | Destination IATA airport code (indexed) |
| `departure_date` | datetime | Scheduled departure (local airport time) (indexed) |
| `arrival_date` | datetime | Scheduled arrival (local airport time) |
| `supplier_code` | varchar(4) | Marketing carrier IATA code (indexed) |
| `operating_supplier_code` | varchar(4) | Operating carrier IATA code (indexed) |
| `aircraft_id` | int | → aircraft lookup table |
| `flight_id` | varchar(6) | Flight number (no carrier prefix) |
| `active` | tinyint(1) | 1 = segment is part of the current itinerary; 0 = voided/replaced |
| `display` | tinyint(1) | 1 = shown to passenger; 0 = hidden (e.g. connection legs on some GDS) |
| `initial` | tinyint(1) | 1 = original segment as booked; 0 = added by schedule change or re-route |
| `create_date` | datetime | Row creation timestamp (indexed) |
| `inactive_date` | datetime | Timestamp when segment was inactivated, nullable |
| `new_segment_id` | int | Replacement segment ID when this segment was re-routed (0 = none) |
| `has_stopover` | tinyint(1) | 1 = stopover at this point in the itinerary |
| `class_code` | varchar(1) | Booking class (RBD) letter, e.g. `L`, `N`, `Y` |
| `status` | varchar(20) | GDS segment status: `HK` confirmed, `TK` ticketed, `UN` unable, etc. |
| `duration` | int | Flight duration in seconds |
| `reference_qualifier` | varchar(30) | GDS reference qualifier (e.g. `ST` = segment token) |
| `reference_number` | int | GDS reference number |
| `line_number` | int | PNR line number of this segment |
| `control_number` | varchar(100) | PNR/locator code for this segment |
| `operated_by_legend` | text | "Operated by X" display text, nullable |
| `cabin_class` | varchar(50) | Human-readable cabin: `economy`, `business`, `first`, `premium_economy` |
| `baggage_quantity` | int | Checked baggage pieces included, nullable |
| `baggage_type` | varchar(2) | Baggage unit type: `N` pieces, `K` kg, etc. |
| `baggage_unit` | varchar(2) | Baggage unit |
| `baggage_weight` | int | Baggage weight limit in kg, nullable |
| `provider_code` | varchar(4) | Provider/consolidator carrier code, nullable |
| `provider_locator_code` | varchar(20) | Provider-side locator, nullable |
| `departure_terminal` | varchar(10) | Departure terminal identifier, nullable |
| `arrival_terminal` | varchar(10) | Arrival terminal identifier, nullable |
| `fare_basis_types` | varchar(50) | Fare basis type string from GDS, nullable |
| `fare_family` | varchar(50) | Fare family name (e.g. `TANGO`, `LIGHT`, `FLEX`), nullable |
| `fare_basis` | varchar(50) | Fare basis code (e.g. `LZ6LZCTG`), nullable |

**Key relationships:**
- `booking_id` → `ota.bookings.id`
- `active = 1` filters to the live itinerary; `initial = 1` filters to original-as-booked segments

**Common queries:**
```sql
-- Full itinerary for a booking (active segments only, in order)
SELECT from_airport_code, to_airport_code, supplier_code, flight_id,
       departure_date, arrival_date, cabin_class, status, fare_family
FROM ota.booking_segments
WHERE booking_id = 12345 AND active = 1
ORDER BY departure_date;

-- QA assertion: confirm segment count and route
SELECT from_airport_code, to_airport_code, departure_date, active, initial
FROM ota.booking_segments
WHERE booking_id = 12345 AND active = 1 AND initial = 1
ORDER BY departure_date;
```

**Query guidance:**
- **Size class:** very large (124 M rows) — always filter by `booking_id`
- **Recommended constraints:** `booking_id` (indexed); add `active = 1` to exclude replaced segments
- **Typical date range:** not applicable at the row level — constrain via `bookings.date_added`

**Notes:**
- A one-way booking typically has 1–3 active segments (direct or connecting). Roundtrip = 2–6.
- `active = 0` rows are historical; schedule changes create new rows and zero out the old ones.
- `status = 'HK'` means GDS-confirmed, `'TK'` means ticketed. QA happy-path assertion: `status = 'HK'` or `'TK'` on all active segments.
- `fare_family` is NULL for older GDS responses that predate fare-family support.
- `duration` is in seconds; divide by 60 for minutes.
