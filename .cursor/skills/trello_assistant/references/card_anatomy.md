# Card anatomy — title, sections, queries

Everything a Content Integration card carries. Two `⊙` sections only — `⊙ **Summary**` (or whatever first-section heading the card already uses) and `⊙ **Numbers/ quantity/ Examples:**` — plus the mandatory AI footer. No extra `⊙` blocks for investigation, repro, QA, solution; fold them into Numbers/Examples.

## Title

Format: **`SOURCE_OR_AREA: Short concrete summary`**.

- `SOURCE` prefix in ALL CAPS: `AMADEUS`, `RESPRO`, `TRAVELFUSION`, `FLXNDC`, `PAYHUB`, `BOOKABILITY`, `WORDSPAN`, `DIDA`, `OPTIMIZATION`, `MULTI TICKETS`.
- Colon + space after the prefix.
- Investigations with no fix yet: `(Investigation Pending) SOURCE: …`.
- Concrete symptom or outcome after the colon, not vague.
- Align wording with existing titles on the same source after the dedup pass.

## Area checklist (mental, before drafting)

Every card description should cover these areas across the two sections. Skip an area only when it does not apply yet; never replace it with hand-waving.

**`⊙ Summary` — plain language, 1–3 sentences (~25–80 words):**

1. **What fails** — one short clause, everyday verbs (`booking fails`, `we get error X`, `manual rate climbed`).
2. **Where** — flow / integration / supplier in plain words (`BookFlight on Downtowntravel`, `Optimizer matching for FLX NDC`).
3. **Why we are tracking it** — impact, hypothesis, or trend signal (`looks like we map age wrong`, `started after the May 12 deploy`).

Do not stack acronyms, supplier payload walkthroughs, or multi-clause technical one-liners in Summary. One error code is fine if it anchors the card. Proof goes to Numbers/Examples.

**`⊙ Numbers/ quantity/ Examples:` — lean by default:**

4. **Scale** — one short line: how often + window + distinct `transaction_id` when known. *OR* **Breakdown text table** (per-day / per-bucket fenced plain-text table — see [#2746](https://trello.com/c/Nfg1JVNy)) — never both. The table IS the scale; do not prefix with a prose `Scale - …` line.
5. **Evidence** — `some examples` block with full permalinks (one URL per line). Add rows until the slice is representative.
6. **Reproduction** — `mongo_query:` or `MySQL:` block, debuggable CTE / leading `$match`, Shape A or B chosen explicitly. The slice lives in one named place so the outer statement can be swapped between count and examples without re-validating the filter.
7. **Related work** — one line `[title](shortUrl)` only when dedup or scope split requires it. Do not add a "Related cards" section.
8. **Optional one-liners** — each ≤ 1 line, only when they change a decision: correlation hint (`transaction_id` ↔ MySQL `search_hash`), breakdown buckets (age vs PTC), second query, regex rationale, `IN (...)` hash list (verbatim, never trimmed).

**Footer (mandatory):**

9. AI attribution block as the last lines. No text after it.

```markdown
---

_Card description drafted/updated by an AI agent; please verify facts, IDs, and links._
```

## Section heading rules

- New cards: `⊙ **Summary**`.
- Edits to older cards: preserve whatever `⊙ **…**` heading the card already uses (e.g. `⊙ **Describe the situation in detail**:`). Do not rename.
- Always `⊙ **…**`, never `## Summary` or any other markdown header.

## Summary template

```markdown
⊙ **Summary**

We get NDC-1348 INVALID_AGE_FOR_PAX_TYPE in BookFlight. It looks like we map the passenger age incorrectly on our side.
```

Field-shape reference cards:

- [#2676 DTT: Passenger type or count…](https://trello.com/c/2dEgDoSr/2676-dtt-passenger-type-or-count-does-not-match-error) — field layout baseline.
- [#2679 DTT: NDC-1348…](https://trello.com/c/tHozrWW3/2679-dtt-ndc-1348-invalidageforpaxtype-age-vs-ptc) — short Summary + lean Numbers (Scale + examples + mongo_query).
- [#2677 DTT: VerifyPrice errors](https://trello.com/c/n0x26K2m/2677-dtt-verifyprice-errors) — multi-signature card with one block per signature.
- [#2746 FLX NDC: Test Bookings go to Agents](https://trello.com/c/Nfg1JVNy) — trend card: breakdown table opens Numbers/Examples, bare ResPro example URL, then the MySQL CTE.

## Numbers/Examples — per-signature block

For each distinct error signature:

1. **Title line:** `**SOURCE_OR_CODE — Short label — example: debug log**` (e.g. `**325 — No available solution — example: debug log**`). Optional on single-signature cards if the title already names the error.
2. Blank line, then `some examples` on its own line.
3. Blank line, then full permalinks — one URL per line (`https://reservations.voyagesalacarte.ca/debug-logs/log-group/<transaction_id>#<log_id>`). Bullets are OK; plain lines match board style.
4. Blank line, then `mongo_query:` on its own line (this exact label).
5. Fenced `javascript` block with the aggregation. Must paste directly into Compass's Aggregation tab.

### smartCard URLs (ResPro / Trello / inline-rendered links)

When the example URL is a ResPro booking page, a Trello card, or anything Trello renders as a smartCard:

- Title line ends `… — example: ResPro` (or `— example: card`).
- Body is the bare URL on its own line. Nothing else.
- Do **not** append `(gds=…, cancel_reason=…, booking_date=…, task_id=…)` parentheticals — the smartCard already exposes those fields.
- If a specific task ID or flag is genuinely the point of the example, one short line under the URL is fine; otherwise omit.

## Query structure — always debuggable (mandatory)

Every aggregation or example query on a card has the slice defined once and the outer statement swappable between count and examples without re-validating the filter.

**MySQL / ClickHouse:**

```sql
WITH slice AS (
  SELECT ...
  FROM ...
  WHERE ...   -- the named slice; window, content source, error filter
)
SELECT COUNT(*) FROM slice;
-- SELECT booking_id, transaction_id, created_at FROM slice ORDER BY created_at DESC LIMIT 20;
```

The counterpart goes in as a commented-out outer `SELECT` from the same CTE. Reviewers swap count ↔ examples without re-validating the filter.

**Mongo:** the leading `$match` stage is the slice. Branch between aggregation (`$group` / `$sum` / `$addToSet`) and one of the two canonical permalink shapes below.

Never ship two separately-filtered queries (one for counts, one for examples) on a card — reviewers cannot trust they describe the same slice.

## Mongo permalink output shapes

Pick one per `mongo_query:` block. Same `$match`; only the post-`$match` differs.

### Shape B — flat links array (default for cards)

One result doc with `count` and a flat `links[]` — one scroll of pasteable permalinks, no per-row sub-objects to expand.

````markdown
mongo_query:

```javascript
[
  { $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
  }},
  { $sort: { date_added: -1 } },
  { $project: {
      _id: 0,
      link: { $concat: [
        "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
        "$transaction_id", "#", { $toString: "$_id" }
      ]}
  }},
  { $group: { _id: null, count: { $sum: 1 }, links: { $push: "$link" } } },
  { $project: { _id: 0, count: 1, links: 1 } }
]
```
````

### Shape A — per-row

N separate result docs, one per match. Use when per-row context columns or per-row filtering in Compass matters, or for a `.forEach(...)` loop in mongosh.

````markdown
mongo_query:

```javascript
[
  { $match: {
      context: "Downtowntravel::BookFlight",
      Response: { $regex: "INVALID_AGE_FOR_PAX_TYPE", $options: "i" },
      date_added: {
        $gte: ISODate("2026-04-01T00:00:00.000Z"),
        $lte: ISODate("2026-05-01T00:00:00.000Z")
      }
  }},
  { $project: {
      _id: 0,
      booking_id: 1,
      transaction_id: 1,
      date_added: 1,
      log_id: { $toString: "$_id" },
      link: { $concat: [
        "https://reservations.voyagesalacarte.ca/debug-logs/log-group/",
        "$transaction_id", "#", { $toString: "$_id" }
      ]}
  }},
  { $sort: { date_added: -1 } }
]
```
````

**Compass-ready:** `ISODate("…")` for date bounds, unquoted field names, always starts with `$match`. For `optimizer_logs`, swap `Response` for `errors` (and adjust the permalink base URL if the target tool differs); everything else is identical.

**Regex in `Response`:** prefer a short distinctive substring. Escape `.` when literal. For exact JSON tail matches (e.g. `"message":"Failed to reprice"}` only), single-quoted `$regex` in mongosh avoids brittle escaping: `$regex: '"message":"Failed to reprice"}'`.

## Where to pull queries from

- [`bookability`](../../bookability/SKILL.md) — MySQL rates / surfer / recovery + Mongo permalink harvest.
- [`db_access`](../../db_access/SKILL.md) — find the right table, document a newly understood one.
- Repo scripts: `.cursor/skills/db_access/scripts/mysql_query.py`, `clickhouse_query.py`, `mongo_query.py`.

Keep runnable text inside Numbers/Examples. Do not paste post-query runbook prose ("Scope (counts):", "reuse the same `$match`", "append `{ $count: … }`") on the card; counting mechanics stay in skills, not on Trello.
