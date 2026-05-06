## booking_passengers

**Database:** `ota`
**Engine:** InnoDB  |  **Rows:** ~47.7 M  |  **Size:** large
**Purpose:** One row per passenger per booking. Stores passenger type, personal details, passport information, and the link to the priced fare component.

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment row ID |
| `booking_id` | int FK | → `bookings.id` |
| `type` | varchar(20) | Passenger type: `ADT` adult, `CHD` child, `INF` lap infant, `INL` seated infant |
| `gender` | varchar(1) | `M` / `F` |
| `date_of_birth` | datetime | Date of birth (time portion is 00:00:00) |
| `first_name` | varchar(50) | Given name (indexed) |
| `last_name` | varchar(50) | Family name (indexed) |
| `middle_name` | varchar(50) | Middle name, nullable |
| `ff_airline_code` | varchar(2) | Frequent-flyer airline IATA code, nullable |
| `ff_number` | varchar(40) | Frequent-flyer number, nullable |
| `meal_preference_code` | varchar(4) | IATA SSR meal code (e.g. `VGML`), nullable |
| `booking_fare_id` | int FK | → `booking_fares.id` — links pax to their priced fare component |
| `amadeus_pt` | int | Amadeus passenger type index (1-based), used for GDS communication |
| `primary_contact` | tinyint(1) | 1 = this passenger is the primary contact for the booking |
| `passport_country` | varchar(3) | ISO 3166-1 alpha-3 country of passport, nullable |
| `passport_number` | varchar(9) | Passport number, nullable |
| `sum_insured` | decimal(10,2) | Insurance coverage amount if insurance was purchased, nullable |
| `gds_reference` | varchar(255) | GDS-side passenger reference/name element, nullable |

**Key relationships:**
- `booking_id` → `ota.bookings.id`
- `booking_fare_id` → `ota.booking_fares.id`
- One booking typically has `adt + chd + inf` rows matching `bookings` pax counts

**Common queries:**
```sql
-- All passengers for a booking
SELECT type, gender, first_name, last_name, date_of_birth, passport_country
FROM ota.booking_passengers
WHERE booking_id = 12345
ORDER BY id;

-- Count by type for a booking
SELECT type, COUNT(*) AS cnt
FROM ota.booking_passengers
WHERE booking_id = 12345
GROUP BY type;

-- QA assertion: confirm pax count matches scenario
SELECT type, COUNT(*) AS cnt
FROM ota.booking_passengers
WHERE booking_id = 12345
GROUP BY type;
-- Expected: ADT=1, CHD=0, INF=0 for a 1-ADT scenario
```

**Query guidance:**
- **Size class:** large (47 M rows) — always filter by `booking_id`; never scan without it
- **Recommended constraints:** `booking_id` (indexed)
- **Typical date range:** not applicable — join through `booking_id`; constrain time via `bookings.date_added` if doing bulk analysis

**Notes:**
- `type` values seen in production: `ADT`, `CHD`, `INF`, `INL` (seated infant). The `INL` type is rare.
- `primary_contact = 1` marks the lead passenger whose contact details are on the booking; there should be exactly one per booking.
- `sum_insured` is non-null only when Xcover or similar insurance was purchased for that passenger.
- `gds_reference` is populated after GDS booking confirmation and can be NULL before ticketing.
