# System map (Flighthub / agents_setup)

Shared context: **where to search**, **what things mean**, and **durable log/observability hints**.  
Agents: **read** this early in investigations; **append** verified facts so others do not reinvent the wheel.

Maintained under the **MongoDB rule** (`.cursor/rules/mongodb.md`): see that file for when to read/update.

---

## Glossary (internal & common terms)

| Term | Meaning | Notes |
|------|---------|--------|
| Payhub | Internal payment processor | Use when investigating **charges on our merchant**, internal payment flow, or Flighthub-side payment handling (not only external card gateways). **Extend this row** when you confirm log sources or dashboards. |

_Add rows as you confirm definitions._

---

## Observability by workflow

### Bookability / content sources

- MySQL `ota` bookability tables are the **first** stop for rates and attempts; see the **bookability analysis** skill for queries.
- **MongoDB `debug_logs`** (and related collections) often hold supplier-side detail after SQL; the bookability skill describes when to go there. **Add per–content-source log hints below** when verified.

**Content source hints** (log filters, services, caveats — verified entries only):

| Content source / area | Where to look | Hint |
|----------------------|---------------|------|
| _Example: add rows_ | | |

### Payments / charges (Payhub)

- See **Glossary → Payhub**. **Add** index names, log service names, or query patterns here once confirmed.

---

## Data locations (pointers)

| Need | Where |
|------|--------|
| Table/collection purpose & columns | `db-docs/` and scripts `scripts/mysql_query.py`, `scripts/mongo_query.py`, `scripts/clickhouse_query.py` |
| Bookability SQL workflow | `.cursor/skills/bookability_analysis/SKILL.md` |
| MongoDB `debug_logs` / `optimizer_logs` | `.cursor/rules/mongodb.md` |

Do **not** paste full schemas in this file; link to `db-docs/` or the relevant skill.

---

## Changelog (optional)

| Date | Change |
|------|--------|
| _YYYY-MM-DD_ | _Initial stub._ |
