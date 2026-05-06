# LookML best practices

Distilled from
[filmozolevskiy/content_integration_optimizer/.cursor/rules/](https://github.com/filmozolevskiy/content_integration_optimizer/tree/master/.cursor/rules).
Every generated `.model.lkml` / `.view.lkml` follows these rules. Mirror
them inside each project repo's own `.cursor/rules/` so the project's
local agent picks them up too.

## Project layout

```text
<project_repo>/
├── models/
│   └── <project_name>.model.lkml
├── views/
│   └── <project_name>.view.lkml
├── schemas/
│   └── README.md            # optional, pasted DESCRIBE output
├── scripts/
│   ├── README.md
│   └── mysql_query.py       # or clickhouse_query.py / mongo_query.py
├── .cursor/
│   └── rules/
│       ├── lookml-standards.mdc
│       ├── lookml-view-standards.mdc
│       ├── lookml-sql-patterns.mdc
│       ├── lookml-best-practices.mdc
│       ├── project-structure.mdc
│       └── git-workflow.mdc
├── .env.example
├── .gitignore
├── README.md
└── requirements.txt
```

## Model file

- `connection: "<connection_name>"` — exact string from `get_models`. No
  quotes around the connection in code paths, but the string itself is
  quoted in LookML.
- `include: "/views/**/*.view.lkml"` — single recursive include is fine
  for small projects.
- One `explore: <project_name>` per project to start. Add joins only when
  a tile needs them. Each join declares `type` and `relationship`
  explicitly; never leave them defaulted.
- If the explore needs a date guard, use a `parameter` of type `date`
  with a sensible `default_value` and reference it via
  `sql_always_where: ${view.date_raw} > TIMESTAMP({% parameter view.start_date %}) ;;`.

## View file

- `view: <name> { sql_table_name: <db>.<table> ;; … }` — fully qualified
  table name. Avoid `derived_table` for the smoke / first version of a
  project; only introduce one when the user asks for a metric that
  cannot be expressed as a dimension or measure.
- `dimension: id { primary_key: yes; type: number; sql: ${TABLE}.id ;;
  hidden: yes }` — always declare a primary key and hide it.
- `dimension_group: <date_field>` for any timestamp dimension — gives
  Looker `date`, `week`, `month`, `quarter`, `year`, `time`, `raw`
  timeframes for free. Never hand-roll separate `dimension: ..._date`
  / `dimension: ..._month` fields.
- `group_label`s — use a numbered scheme (`"1. DATE"`, `"2. CONTESTANT
  INFO"`, …) so the field picker is ordered.
- Boolean dimensions: `type: yesno`, named `is_<thing>`.
- `description:` on every public dimension and measure. Required.
- Hidden helpers (`hidden: yes`) for intermediate calculations.
- Field references inside SQL use `${TABLE}.col` for raw columns and
  `${other_dimension}` for derived ones — never hardcode the table name.
- Suggestions on string dimensions where the value-set is enumerable
  (`suggestions: ["Eligible", "Unprocessable", …]`).
- Ratio / rate measures: always `numerator / NULLIF(denominator, 0)`.
- Value formats: `value_format: "#,##0.00"` for money,
  `value_format: "0.00%"` for rates.

## Measures

- `count_distinct` for entity counts (rows can multi-count if joins
  fan out).
- `sum` for additive money / volume only when the dimension is
  per-row-additive — annotate the description if a column multi-counts
  per attempt or per booking, and offer a "safe" variant.
- Filter measures with explicit conditions in `sql:` (`CASE WHEN
  candidacy = 'Eligible' THEN ${id} END`) rather than `filters: [...]`
  unless the value-set is closed and short.

## Forbidden patterns

- `SELECT *` in a `derived_table`.
- Hardcoded date bounds in `sql:` (`WHERE created_at > '2025-01-01'`).
  Use a `parameter` of type `date`.
- Mixing two unrelated tables in one view to "save a join". Use joins.
- PDTs (`derived_table` with `persist_for` / `sql_trigger_value`)
  unless explicitly requested by the user — they cost real connection
  time and rarely pay back at the smoke-test stage.
- Secrets in `.env`, in any LookML file, or in `manifest.lkml`.
  `.env` is `.gitignore`d; `.env.example` ships with empty values.

## File-level conventions

- Section headers with `# -------------------------` between groups.
- Snake_case field names everywhere.
- One blank line between dimensions / measures inside the same group.
- No trailing whitespace; LF line endings.
- LookML files end with a newline.

## Testing

- Use the project's local DB CLI (`scripts/mysql_query.py` / etc.) to
  sanity-check at least one measure before pushing — count of rows in
  the underlying table should match the count measure modulo any
  filters you applied.
- After pushing, run a Looker MCP `query` against the new explore to
  confirm Looker resolves the LookML and the connection works.
- Compare `query` numbers with `query_sql` (which returns the generated
  SQL Looker would run) when a discrepancy is suspected — paste the
  generated SQL into the DB CLI and run it directly.

## Git workflow inside a project repo

- Branch off `master` (or `main`, whichever the project uses).
- Branch name: `feature/<short-slug>` or `fix/<short-slug>`. Don't
  reuse the parent agent-setup repo's `automation/<shortLink>-<slug>`
  scheme inside project repos — those are different boards.
- Commits describe the LookML change, not the tooling that authored it.
- Open a PR per change so a Looker admin can review before pulling
  into the connected branch.
