---
name: skill-creator
description: >-
  Use when adding, scaffolding, or wiring a new project-local skill in this
  repo, when the user asks to "create a skill", "add a skill", "scaffold a
  skill", "register a skill", or "wire up a slash command", or when a
  workflow has stabilised enough that it deserves its own
  `.cursor/skills/<name>/` folder. Covers the full motion: SKILL.md +
  `.claude/commands/<name>.md` wrapper + routing rows in
  `CLAUDE.md` § Skills Index and `.cursor/rules/rules.mdc` § Skills Index.
  Project-local only — cross-project skills go under `~/.cursor/skills/`
  and use the global `create-skill` skill instead.
---

# Skill Creator

Scaffolds a new project skill so it lands in the right place, with the
right shape, and is reachable from both routing tables. The motion is
small but easy to get half-right (`.cursor/rules/rules.mdc` row missing,
slash command wrapper missing, frontmatter `description`
summarising the workflow instead of stating triggers). This skill exists
so the agent gets it whole every time.

## When to use

- User says "create a skill", "add a skill for X", "scaffold a skill",
  "register a slash command", "make a SKILL.md for X".
- A repeated workflow (3+ sessions) has stabilised and warrants its own
  routing entry.
- An existing rule under `.cursor/rules/` has grown branching steps,
  inputs, and per-mode workflows and now needs to graduate into a skill.

## When NOT to use

- **Cross-project workflow** → `~/.cursor/skills/<name>/`. Use the global
  `create-skill` skill (`~/.cursor/skills-cursor/create-skill/SKILL.md`)
  instead. Project skills live in this repo only.
- **One-shot rule that applies every session** (writing style, db access
  conventions) → `.cursor/rules/<name>.md`. No skill folder.
- **Tool-only helper with no instructions** → `scripts/<name>.py`. No
  skill folder.
- **Database documentation** → `db-docs/`. Run `/table_analysis` instead.

## Repo conventions (fixed)

| Item | Convention |
|------|------------|
| Folder name | snake_case, e.g. `bookability_analysis` |
| Frontmatter `name:` | kebab-case, e.g. `bookability-analysis` |
| Slash command file | matches folder, e.g. `.claude/commands/bookability_analysis.md` |
| Entry point | `.cursor/skills/<name>/SKILL.md` |
| Long-form docs | `.cursor/skills/<name>/references/<topic>.md` |
| Helpers | `.cursor/skills/<name>/scripts/<name>.py` |
| Routing | both `CLAUDE.md` § Skills Index **and** `.cursor/rules/rules.mdc` § Skills Index |

Existing skills to mirror for tone and shape: `trello_assistant/SKILL.md`
(rich, multi-section), `table_analysis/SKILL.md` (narrower, two entry
points), `qa_assistant/SKILL.md` (workflow-driven).

## Inputs to gather

Before writing files, pin down:

1. **`<name>`** — folder (snake_case) and frontmatter `name:` (kebab-case).
   Verb-first or topic-first; match neighbours.
2. **Trigger phrases** — 3+ concrete things the user actually says
   ("audit X", "why did Y fail", "create a card for Z"). These go in the
   `description` verbatim so future routing matches.
3. **Scope** — one or two sentences. What the skill does, what it does
   not.
4. **Supporting files** — `references/*.md` for long-form material,
   `scripts/*.py` for helpers, sample inputs / fixtures if any.
5. **Cross-skill dependencies** — does this skill call into
   `bookability_analysis`, `table_analysis`, etc.? List them; the body
   should link to those skills, not duplicate their content.

If any of these is unclear, ask the user before writing files. Stub
skills age badly — they sit in the routing table promising a workflow
that does not exist.

## Files to create / update

For a new skill named `<name>` (snake_case folder, kebab-case `name:`):

1. **`.cursor/skills/<name>/SKILL.md`** — required. Frontmatter + body
   (template below).
2. **`.claude/commands/<name>.md`** — thin wrapper:

   ```markdown
   ---
   description: <one-line trigger summary, mirrors SKILL.md description>
   ---

   Load and follow `.cursor/skills/<name>/SKILL.md`.
   ```

3. **`CLAUDE.md` § Skills Index** — append row in **Pick when** format:
   `| /<name> | <one sentence: pick when …> |`. Keep alphabetical.
4. **`.cursor/rules/rules.mdc` § Skills Index** — append matching
   row with a markdown link to the SKILL.md (not the slash command):
   `| [`<name>`](../skills/<name>/SKILL.md) | <one sentence …> |`. Keep
   alphabetical and synchronised with the row in `CLAUDE.md`.
5. **Optional:** `.cursor/skills/<name>/references/`,
   `.cursor/skills/<name>/scripts/`, sample inputs, fixtures.

## SKILL.md frontmatter

```yaml
---
name: <kebab-case-name>
description: >-
  Use when <triggering condition>. <Optional second sentence with concrete
  trigger phrases users say>. <Optional third sentence naming the scope
  / data sources / tools the skill covers>.
---
```

Rules:

- `name`: lowercase, hyphens only. Max 64 chars.
- `description`: starts with `Use when`. Third person. Max ~1024 chars.
  Includes the trigger phrases the user actually says. **Do not summarise
  the workflow.** Description = WHEN to use; body = HOW. Workflow
  summaries cause the agent to follow the description instead of reading
  the body — see the `writing-skills` skill for the empirical case.

## SKILL.md body shape

Match the in-repo style. Skip sections that do not apply:

1. **One-line purpose** at the top. State what the skill does in plain
   English. No marketing.
2. **When to use / When NOT to use** — the routing decisions the agent
   needs.
3. **Inputs / Tooling / Inventory** — concrete IDs, paths, env vars,
   commands. Reusable across invocations.
4. **Workflow / Steps** — numbered or sectioned. Each step is an
   imperative ("Run X", "Open Y", "Write Z"). Show concrete commands
   with paths. Do not paraphrase tool calls.
5. **What not to do** — explicit anti-patterns. Close loopholes that
   produced past mistakes.
6. **References** — link to sibling files for long-form material. Keep
   one level deep.

Writing style is governed by `.cursor/rules/rules.mdc` § MUST → Writing
style: plain, direct, imperative. No "I'll", "Let me", "Sure". Cut
adjectives that do not change meaning. Lead with the answer.

Aim for under ~500 lines. Spill anything longer into
`references/<topic>.md` and link from SKILL.md (one level deep).

## Step-by-step

1. **Confirm scope.** Run `ls .cursor/skills/` and grep `description:`
   lines for overlap. If a close duplicate exists, point the user at it
   and stop. If the workflow only triggers in one session per quarter,
   keep it as a `.cursor/rules/<name>.md` instead.
2. **Pick the names.** Folder snake_case, frontmatter kebab-case, slash
   command file matches folder. Verify nothing collides with existing
   skills or rules.
3. **Draft the description.** 2–4 sentences, opens with "Use when".
   Paste in 3+ concrete trigger phrases users would say. Re-read the
   user's request and confirm at least one phrase from it appears
   verbatim in the description.
4. **Write `SKILL.md`.** Use the body shape above. Keep imperatives.
   Concrete paths, IDs, commands. No narrative.
5. **Add the slash command wrapper.** Two-line wrapper that points at
   `SKILL.md`. Mirror `.claude/commands/qa_assistant.md`.
6. **Update both routing tables.** `CLAUDE.md` § Skills Index **and**
   `.cursor/rules/rules.mdc` § Skills Index. The rows must agree
   on the **Pick when** sentence; only the link target differs (slash
   command vs. SKILL.md path). Out-of-sync rows are the most common
   defect when a skill is added by hand.
7. **Lint.** Run:

   ```bash
   python3 .cursor/skills/skill_creator/scripts/lint_skill.py <name>
   ```

   The script checks frontmatter shape, that `description` starts with
   `Use when`, that the slash command wrapper exists and points at the
   SKILL.md, and that both routing tables contain a row referencing the
   skill. Fix anything it flags before handing off.
8. **Smoke test.** Open a new chat / agent run and trigger the skill
   with one of the phrases from its description. Confirm the agent
   picks it up. If it does not, the description is too vague —
   strengthen the triggers and re-test.

## What not to do

- Do not place skills in `~/.cursor/skills-cursor/` — that path is
  Cursor's built-in skills, not this repo.
- Do not skip the slash command wrapper. Several existing skills
  (`bookability_analysis`, `table_analysis`, `trello_assistant`)
  currently lack one and should be backfilled; do not add to the gap.
- Do not summarise the skill's workflow in `description`. Workflow
  summaries cause the agent to skip the body.
- Do not add a routing row in only one of the two tables. The pair must
  stay in sync.
- Do not invent a new top-level folder. Skill content lives under
  `.cursor/skills/<name>/`. Reusable helpers go under `scripts/` only
  when other skills need them.
- Do not stub a SKILL.md with TODOs and ship it. An empty skill in the
  routing table tells the agent a workflow exists when it does not.

## References

- Global skill-authoring guidance:
  `~/.cursor/skills-cursor/create-skill/SKILL.md`. Use it for skills
  that live outside this repo.
- Routing tables to mirror: `CLAUDE.md` § Skills Index and
  `.cursor/rules/rules.mdc` § Skills Index.
- Slash command pattern: `.claude/commands/qa_assistant.md`,
  `.claude/commands/optimizer_analysis.md`.
- In-repo style examples: `.cursor/skills/trello_assistant/SKILL.md`,
  `.cursor/skills/table_analysis/SKILL.md`,
  `.cursor/skills/qa_assistant/SKILL.md`.
- Lint script: `.cursor/skills/skill_creator/scripts/lint_skill.py`.
