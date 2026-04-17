# Harvest debug_logs permalinks (canonical pipelines)

Single source of truth for the MongoDB aggregations used to produce shareable
`debug_logs` permalinks for bookability investigations and Trello `mongo_query:`
blocks. Both `bookability_analysis/SKILL.md` and `trello_content_integration/SKILL.md`
link here.

Run these in **mongosh**, **MongoDB Compass**, or **Python + pymongo** — the repo's
`scripts/mongo_query.py aggregate` does **not** accept `ISODate(...)` inside a JSON
pipeline string.

## Common `$match` recipe

- **`context`:** use equality when you know the full string (e.g. `"Downtowntravel::BookFlight"`).
  Never `$regex` on `context` if the exact value is known — regex is slower and can mask typos.
- **`Response`:** supplier-visible body for DTT book flows and similar integrations; apply
  `$regex` here, not on `context`. Escape literal periods (`unique\.`).
- **`date_added`:** always bound with `$gte` / `$lte` (or `$lt`). Harvests without a date
  bound scan the whole capped collection.

For full filter rationale see `.cursor/rules/mongodb.md` and the *Effective queries on
debug_logs* section of `bookability_analysis/SKILL.md`.

## Variant A — Full harvest (every matching log line → one array of links)

Use this when you want every hit in the window, e.g. to enumerate examples for a Trello
ticket before deduping.

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: {
        $regex: "INVALID_AGE_FOR_PAX_TYPE",
        $options: "i"
      },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  {
    $project: {
      _id: 0,
      transaction_id: 1,
      date_added: 1,
      log_id: { $toString: "$_id" },
      link: {
        $concat: [
          "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
          "$transaction_id",
          "#",
          { $toString: "$_id" }
        ]
      }
    }
  },
  { $sort: { date_added: -1 } },
  {
    $group: {
      _id: null,
      links: { $push: "$link" }
    }
  },
  { $project: { _id: 0, links: 1 } }
]
```

**Tighter signature** (e.g. NDC-1348 + age/PTC): set `Response.$regex` to something like
`NDC-1348.*INVALID_AGE_FOR_PAX_TYPE` (escape literal dots when needed).

## Variant B — One row per `transaction_id`

Use this when retries inflate the line count and you want a single representative permalink
per user attempt (common on Trello cards so the example list stays readable).

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  { $sort: { date_added: -1 } },
  {
    $project: {
      transaction_id: 1,
      date_added: 1,
      link: {
        $concat: [
          "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
          "$transaction_id",
          "#",
          { $toString: "$_id" }
        ]
      }
    }
  },
  {
    $group: {
      _id: "$transaction_id",
      link: { $first: "$link" },
      last_seen: { $max: "$date_added" }
    }
  },
  { $sort: { last_seen: -1 } }
]
```

## Variant C — Counts only

Use this for the **Scale** line on Trello cards (e.g. `93 times in 30d; 39 distinct transaction_id in 30d`).
Run the exact same `$match` twice:

```javascript
// Total matching log lines
[ { $match: { /* same as above */ } }, { $count: "n" } ]

// Distinct transactions
[
  { $match: { /* same as above */ } },
  { $group: { _id: "$transaction_id" } },
  { $count: "n" }
]
```

## Minimal prevalence check (no links)

Same `$match`, just `$count`:

```javascript
[
  {
    $match: {
      context: "Downtowntravel::BookFlight",
      Response: {
        $regex: "Passenger names must be unique\\. Please add middle names or titles\\.",
        $options: "i"
      },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
    }
  },
  { $count: "n" }
]
```

## Permalink URL shape

```
https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>
```

- `<transaction_id>` — same value as MySQL `bookability_*.search_hash` when correlating.
- `<log_id>` — the document's `_id` as a 24-char hex string (use `$toString`).
