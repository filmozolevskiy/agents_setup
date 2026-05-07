# Refactor proposal — chat block template

The approval gate in [`SKILL.md`](../SKILL.md) § Approval gate
requires the agent to post a written proposal in chat before any
edit to a `.lkml` file in a registered project. Keep proposals
**lean**: state the main changes, not a per-rule essay.

## When to use the template

| Situation | Use template? |
|---|---|
| Edit to existing `.lkml` in a registered project | **Yes** |
| Tier 1 perf change in [`optimizing_existing_projects.md`](./optimizing_existing_projects.md) | **Yes** |
| Tier 2 change (rename, value shift, view split) | **Yes** — fill `Affected` with `<old> → <new>` per tile |
| Bootstrapping a new project from the skeleton | No — describe the intended shape in chat instead |
| New dashboard / filter / tile via Looker MCP (no LookML touched) | No — short heads-up in chat |
| Read-only Looker MCP / DB CLI / `query_sql` runs | No |

## The block

Paste verbatim, fill the placeholders, post in chat **before** the
first file write. Quote the user's reply word back when applying
("Got `approve`, applying now.").

````markdown
## Proposed Looker change

**Scope**: <one sentence — file(s) / dashboard(s) / project>
**Why**: <one sentence — user-visible reason>
**Tier**: 1 / 2 / refactor / bootstrap

**Change**:

```lkml
<the new / changed LookML, or a tight diff sketch>
```

**Affected**: <dashboard `<id>` "<title>": no value change | <old> → <new>>; or "None — sandbox / new file"

**Rollback**: <`git revert <sha>` and ask user to redeploy | delete tile via UI | …>

Reply **`approve`** (or `yes` / `lgtm` / `ship it` / `looks good`) to apply.
````

## Filling the sections

- **Scope** — name the file path or the dashboard / tile, not the
  abstract goal.
- **Why** — user-visible reason. "Office is a dimension we filter
  on" beats "Apply rule 3 from the best-practices doc".
- **Tier** — 1 = no public field changes value or name; 2 = at
  least one does (rename, value shift, fan-out fix, new
  `always_filter:`); refactor = readability / structure pass
  (tag the individual changes Tier 1 / Tier 2 inside the block);
  bootstrap = does not use this template.
- **Change** — the actual LookML (or one-line diff bullets for
  multi-file). No more than ~20 lines pasted verbatim; longer
  diffs become bullets.
- **Affected** — Tier 1: usually "no value change" per dashboard,
  but still name the dashboard. Tier 2: per-tile `<old> → <new>`,
  no "unknown" — pause and run the queries first if you can't
  predict.
- **Rollback** — concrete command or step. "git revert" without a
  SHA is not enough when the apply involves multiple commits.

## When the proposal is too big for chat

If the change spans many files, post the **same lean block** in
chat with the *Change* section as one bullet per file (path + one
line of intent). Drop the full diff into a `reports/looker_proposal_<shortLink>.md`
only if the user asks for it.

## Standards check (mental, not in the block)

Before posting, walk the
[`lookml_best_practices.md`](./lookml_best_practices.md)
refactor checklist (rules 1–10 + R1–R5) yourself. Do **not** dump
the per-rule mapping into the proposal — readers don't want a
checklist essay. If a change violates a rule on purpose, call that
out in *Why* in plain language.

## What not to do

- Do not start file writes "while the user thinks about it". The
  gate is binding.
- Do not pad the block with rule-by-rule justification, schema
  verification dumps, or correlation essays. Save those for the
  PR description, not the proposal.
- Do not collapse Tier 2 changes into a Tier 1 proposal because
  "the value change is small". Any value or surface change is
  Tier 2.
- Do not interpret silence as approval. Silence is not in the
  approval-signal list.
