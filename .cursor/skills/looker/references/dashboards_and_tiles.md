# Dashboards and tiles via the Looker MCP

Worked-example reference for creating and editing dashboards through the
`project-0-agents_setup-looker` MCP. Read each tool's JSON schema before
calling.

## Order of operations (mandatory)

1. `make_dashboard` — creates an empty dashboard. Capture the returned
   `dashboard_id`.
2. `add_dashboard_filter` — one call per filter, **before** any tiles.
   Capture each filter's `name`.
3. `add_dashboard_element` — one call per tile, **after** all filters.
   Tiles render in the order this tool is called.

Do not interleave filters and tiles; the MCP does not guarantee
consistent ordering when you do.

## Step 1 — `make_dashboard`

```json
{
  "title":       "<unique title>",
  "description": "<one-line purpose>",
  "folder":      ""
}
```

- `title` must be unique within the destination folder. If unset,
  Looker drops the dashboard in the user's personal folder.
- The response contains `id` and `url`. Persist `id` for the rest of
  the session.

## Step 2 — `add_dashboard_filter`

Two common filter shapes:

### Field filter (filters one or more tiles by a LookML field)

```json
{
  "dashboard_id":  "<id from step 1>",
  "name":          "booking_date",
  "title":         "Booking Date",
  "filter_type":   "field_filter",
  "model":         "<model_name>",
  "explore":       "<explore_name>",
  "dimension":     "<view>.<date_dimension>",
  "default_value": "30 days ago for 30 days"
}
```

### Date filter (free-form date)

```json
{
  "dashboard_id":  "<id>",
  "name":          "date_range",
  "title":         "Date range",
  "filter_type":   "date_filter",
  "default_value": "30 days ago for 30 days"
}
```

Capture each filter's `name`. The same `name` becomes
`dashboard_filters[].dashboard_filter_name` when binding tiles.

## Step 3 — `add_dashboard_element`

Each tile is a fresh query plus optional vis_config:

```json
{
  "dashboard_id": "<id>",
  "model":        "<model_name>",
  "explore":      "<explore_name>",
  "fields":       ["<view>.<dim>", "<view>.<measure>"],
  "title":        "<tile title>",
  "sorts":        ["<view>.<dim> desc"],
  "limit":        500,
  "vis_config":   { "type": "looker_column" },
  "dashboard_filters": [
    { "dashboard_filter_name": "booking_date", "field": "<view>.<date_dimension>" }
  ]
}
```

`vis_config.type` examples (Looker built-ins):

| Tile shape | `vis_config.type` |
|------------|-------------------|
| Single value | `"single_value"` |
| Bar chart | `"looker_bar"` |
| Column chart | `"looker_column"` |
| Line chart | `"looker_line"` |
| Pie | `"looker_pie"` |
| Data table | `"table"` (or omit `vis_config`) |
| Map | `"looker_map"` |

For everything past the basic `type`, copy a `vis_config` from an
existing dashboard (`get_dashboards` → fetch a similar dashboard via the
Looker UI, copy its tile config).

## Editing existing dashboards

There is no MCP tool for moving, deleting, or reordering tiles. Adding
tiles to an existing dashboard works (`get_dashboards` → take the
target's `id` → call `add_dashboard_element`). Anything destructive
(remove a tile, change its query in place, change the layout) is an
out-of-scope operation today; tell the user it requires the Looker UI
or a manual REST call, and offer to file a follow-up if the workflow
becomes common.

## Verification after making a dashboard

1. `run_dashboard` (`dashboard_id: <id>`) — Looker runs every tile and
   returns results / errors. Use this to confirm no tile errors out.
2. Open the dashboard URL returned by `make_dashboard` in a browser to
   eyeball layout. The MCP cannot screenshot it; the user does that.

## Worked example — verification dashboard

Used to validate the smoke-test project
`looker_skill_smoketest_bookings` (model: `looker_skill_smoketest_bookings`,
explore: `bookings`).

**Goal.** Three tiles, one dashboard, no filter:

1. Single value — total real bookings (last 30 days).
2. Column chart — daily real bookings (last 30 days).
3. Bar chart — top 10 validating carriers by booking count (last 30
   days).

**Sequence.**

1. `make_dashboard`

   ```json
   { "title": "Looker skill smoketest — Bookings", "description": "Smoke-test dashboard for the Looker agent skill. Counts real bookings (is_test=0) on ota.bookings over the last 30 days." }
   ```

2. `add_dashboard_element` — single value

   ```json
   {
     "dashboard_id": "<id>",
     "model":  "looker_skill_smoketest_bookings",
     "explore": "bookings",
     "fields": ["bookings.bookings_count"],
     "filters": { "bookings.is_test": "no", "bookings.booking_date_date": "30 days ago for 30 days" },
     "title": "Real bookings — last 30d",
     "vis_config": { "type": "single_value" }
   }
   ```

3. `add_dashboard_element` — daily column chart

   ```json
   {
     "dashboard_id": "<id>",
     "model":  "looker_skill_smoketest_bookings",
     "explore": "bookings",
     "fields": ["bookings.booking_date_date", "bookings.bookings_count"],
     "filters": { "bookings.is_test": "no", "bookings.booking_date_date": "30 days ago for 30 days" },
     "sorts": ["bookings.booking_date_date"],
     "title": "Daily real bookings — last 30d",
     "vis_config": { "type": "looker_column" }
   }
   ```

4. `add_dashboard_element` — top carriers

   ```json
   {
     "dashboard_id": "<id>",
     "model":  "looker_skill_smoketest_bookings",
     "explore": "bookings",
     "fields": ["bookings.validating_carrier", "bookings.bookings_count"],
     "filters": { "bookings.is_test": "no", "bookings.booking_date_date": "30 days ago for 30 days", "bookings.validating_carrier": "-NULL" },
     "sorts": ["bookings.bookings_count desc"],
     "limit": 10,
     "title": "Top 10 carriers — last 30d",
     "vis_config": { "type": "looker_bar" }
   }
   ```

5. `run_dashboard` (`dashboard_id: <id>`) — confirm all three tiles
   resolve.

The single-value count must match
`python3 .cursor/skills/db_access/scripts/mysql_query.py query "SELECT COUNT(*) FROM ota.bookings WHERE is_test = 0 AND booking_date > NOW() - INTERVAL 30 DAY"`
±0 (or ±a few rows for in-flight inserts during the run). Big drift =
something is wrong; flag it instead of silently moving on.

## Closing the reply

Dashboard / tile changes via the MCP go live the moment the API call
returns — no Looker admin step needed. Close the reply with the
**Block A** ("Refresh only") template from
[`manual_handoffs.md`](./manual_handoffs.md), filled in with the
dashboard URL.

If the same reply also pushed LookML (e.g. the very first dashboard
on a brand-new project, or a tile that references a new measure you
just pushed), use **Block B** or **Block C** instead — those are
strictly stronger and already imply the dashboard refresh.
