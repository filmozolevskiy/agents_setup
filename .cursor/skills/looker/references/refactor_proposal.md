# Refactor proposal — chat block template

The approval gate in [`SKILL.md`](../SKILL.md) § Approval gate
requires the agent to post a written proposal in chat before any
edit to a `.lkml` file in a registered project. This file is the
template. One block per proposal; one proposal per refactor.

## When to use this template

| Situation | Use template? |
|---|---|
| Edit to existing `.lkml` in a registered project (refactor, perf, fix) | **Yes** |
| Tier 1 perf change in [`optimizing_existing_projects.md`](./optimizing_existing_projects.md) — adds `aggregate_table:`, `datagroup`, etc. | **Yes** (Tier doesn't gate or un-gate; it shapes the proposal) |
| Tier 2 change (rename, value-shift, splitting view) | **Yes** — fill the per-tile impact line for every affected dashboard |
| Bootstrapping a new project from the skeleton | No — describe the intended shape in chat instead, no formal block |
| New dashboard / filter / tile via Looker MCP (no LookML touched) | No — short heads-up in chat is enough |
| Read-only Looker MCP / DB CLI / `query_sql` / `db_access` runs | No |

## The block

Paste verbatim, fill in the placeholders, post in chat **before**
the first file write or `push_files`. Do not split it across multiple
messages. Quote the user's reply word in the apply-announcement
("Got `approve`, applying now.").

````markdown
## Proposed Looker change

**Scope**: <one sentence — file(s) / dashboard(s) / project>
**Why**: <one sentence — the user-visible reason, not the LookML internals>
**Tier**: 1 (no value change) / 2 (value or surface change) / refactor / bootstrap

**Before → after**:
- `<path/to/file.view.lkml>` — <field / setting>: `<before>` → `<after>`
- `<path/to/file.model.lkml>` — <…>
- … (one bullet per concrete change; no "various tweaks")

**Standards applied** (from `lookml_best_practices.md`):
- Rule <N> (<short name>) — <how this change satisfies it>
- … (every change maps to a rule; if a change matches none of the
  ten high-impact rules or the readability standards, name that
  explicitly so we can decide whether the rule list needs updating)

**Dashboards / tiles potentially affected**:
- Dashboard `<id>` "<title>" → tile "<title>": <expected impact, e.g.
  "no value change", "<old> → <new> (<delta>%)", "field renamed —
  tile breaks until alias / migration is in place">
- … (or the literal line "None — sandbox folder / new view file"
  when the change cannot reach an existing tile)

**Rollback**:
- <`git revert <sha>` on the project repo, then ask user to pull+deploy in Looker>
- <or: delete tile via Looker UI, restore previous version, etc.>

Reply **`approve`** (or `yes` / `lgtm` / `ship it` / `looks good`) to
apply. Push back on any line and I'll revise.
````

## Filling each section honestly

### Scope

One sentence. Name the file path or the dashboard / tile, not the
abstract goal. "Refactor `bookings.view.lkml` to split out
`bookings_payments_base`" beats "Improve readability of the bookings
explore".

### Why

User-visible reason. "The view is 380 lines and three measures share
the same `COALESCE` expression" is good. "Apply rule 9 from the best
practices doc" is not — that's a *standards applied* line, not a
*why*.

### Tier

- **Tier 1** — no public field changes value or name. Examples:
  add `aggregate_table:`, attach `datagroup:`, push duplicated SQL
  into a hidden helper, hide noisy join fields, narrow a verified
  `relationship:`. See [`optimizing_existing_projects.md`](./optimizing_existing_projects.md) § Tier 1.
- **Tier 2** — at least one public field changes name, type, or
  value. Examples: rename a dimension, fix `sql_distinct_key:` on a
  fanning measure, add `always_filter:` to a previously unbounded
  explore, split a view in a way that touches its public surface.
- **Refactor** — readability / structure pass that mostly applies
  the standards in [`lookml_best_practices.md`](./lookml_best_practices.md).
  Tag the individual changes Tier 1 or Tier 2 in the *Before → after*
  bullets — a refactor batch can mix tiers.
- **Bootstrap** — does not use this template (no existing surface).

### Before → after

One bullet per concrete change. For a renamed field, write it as one
bullet (`<old name> → <new name>`), not as a delete + add. For a
multi-file refactor (e.g. extracting a base view), list each file's
contribution. Do not collapse to "various tweaks"; the reviewer
should be able to mentally diff from this list alone.

### Standards applied

Map each *Before → after* bullet to a rule. Use the rule numbers from
[`lookml_best_practices.md`](./lookml_best_practices.md) (high-impact
rules 1–10) and the section names from its readability standards
(field ordering, group_label, label/description, view file size,
`# Why:` comments, refactor checklist). If a bullet matches no
existing rule, say so — that is signal that the rule list is
incomplete.

### Dashboards / tiles potentially affected

For Tier 1 the line is usually "no value change" per tile. Still
list the tiles — the verification protocol in
[`optimizing_existing_projects.md`](./optimizing_existing_projects.md) § Step 4
runs on this list, and missing tiles means missing verification.

For Tier 2, fill the actual delta per tile. If you cannot predict the
delta yet, say so explicitly (`unknown — needs query before approval`)
and pause — do not post the proposal until you can.

If the change cannot reach an existing tile (new view file in a
sandbox folder, hidden helper that no measure references yet), use
the literal line "None — sandbox folder / new view file". Do not
omit the section.

### Rollback

Concrete command or step. "git revert" without a SHA is not enough
when the apply involves multiple commits. If the rollback requires
the user to pull+deploy in Looker, say so — that is the same manual
handoff in [`manual_handoffs.md`](./manual_handoffs.md).

## When the proposal is too big for chat

If *Before → after* runs past ~80 lines (large multi-file refactor,
extracting an `extends:` base, splitting a 600-line view), still post
the **full block** in chat. Big proposals need to be reviewed where
the conversation lives, not buried in a `reports/` file. The only
exception is when the user explicitly asks for a written report —
then drop `reports/looker_proposal_<shortLink>.md` and paste a 5–10
line summary block in chat with a link.

## What not to do

- Do not start file writes "while the user thinks about it". The
  gate is binding.
- Do not post a proposal without a *Standards applied* mapping.
  Refactors that don't apply a rule are not refactors.
- Do not collapse Tier 2 changes into a Tier 1 proposal because
  "the value change is small". Any value or surface change is
  Tier 2 and the per-tile delta is mandatory.
- Do not interpret silence as approval. Silence is not in the
  approval-signal list.
- Do not skip the *Dashboards / tiles potentially affected* line
  on the grounds that "nobody uses that field". Saved tiles can
  reference fields the field picker no longer surfaces; verify
  with `query` before claiming zero impact.
