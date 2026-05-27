---
name: skill-creator
description: >-
  Use when adding, scaffolding, or wiring a new project-local skill in this
  repo; when the user asks to "create a skill", "add a skill", "scaffold a
  skill", "register a skill", "wire up a slash command", "iterate on a
  skill", "evaluate a skill", "benchmark a skill", or "optimize a skill
  description"; or when a workflow has stabilised enough that it deserves
  its own `.cursor/skills/<name>/` folder. Covers the full motion:
  SKILL.md + `.claude/commands/<name>.md` wrapper + routing rows in
  `CLAUDE.md` § Skills Index and `.cursor/rules/rules.mdc` § Skills Index,
  plus the eval-and-iterate loop (test cases, subagent runs, benchmark
  viewer, description optimization). Project-local only — cross-project
  skills go under `~/.cursor/skills/` and use the global `create-skill`
  skill instead.
---

# Skill Creator

Two motions:

1. **Scaffold** a new project skill so it lands in the right place and
   is reachable from both routing tables.
2. **Iterate** on a skill against test cases — draft → run evals →
   review → improve → repeat, with optional description optimization.

## When to use

- "create a skill", "add a skill for X", "scaffold a skill", "register a
  slash command", "make a SKILL.md for X" → scaffolding motion.
- "iterate on skill X", "evaluate skill X", "benchmark skill X", "optimize
  the description for X", "run test cases against X" → iteration motion.
- A repeated workflow (3+ sessions) has stabilised and warrants its own
  routing entry.
- An existing rule under `.cursor/rules/` has grown branching steps,
  inputs, and per-mode workflows and now needs to graduate into a skill.

## When NOT to use

- **Cross-project workflow** → `~/.cursor/skills/<name>/`. Use the global
  `create-skill` skill instead.
- **One-shot rule that applies every session** (writing style, db access
  conventions) → `.cursor/rules/<name>.md`. No skill folder.
- **Tool-only helper with no instructions** → `scripts/<name>.py`. No
  skill folder.
- **Database documentation** → `db-docs/`. Use `db_access` instead.

---

## Scaffolding motion

### Repo conventions (fixed)

| Item | Convention |
|------|------------|
| Folder name | snake_case, e.g. `bookability` |
| Frontmatter `name:` | kebab-case, e.g. `bookability-analysis` |
| Slash command file | matches folder, e.g. `.claude/commands/bookability.md` |
| Entry point | `.cursor/skills/<name>/SKILL.md` |
| Long-form docs | `.cursor/skills/<name>/references/<topic>.md` |
| Helpers | `.cursor/skills/<name>/scripts/<name>.py` |
| Routing | both `CLAUDE.md` § Skills Index **and** `.cursor/rules/rules.mdc` § Skills Index |

Existing skills to mirror for tone and shape: `trello_assistant/SKILL.md`
(rich, multi-section), `qa_assistant/SKILL.md` (workflow-driven),
`db_access/SKILL.md` (foundation skill with shared infra).

### Inputs to gather

Before writing files, pin down:

1. **`<name>`** — folder (snake_case) and frontmatter `name:` (kebab-case).
2. **Trigger phrases** — 3+ concrete things the user actually says
   ("audit X", "why did Y fail", "create a card for Z"). These go in the
   `description` verbatim so future routing matches.
3. **Scope** — one or two sentences. What the skill does, what it does not.
4. **Supporting files** — `references/*.md` for long-form material,
   `scripts/*.py` for helpers, sample inputs / fixtures if any.
5. **Cross-skill dependencies** — which skills this one calls into. List
   them; the body links to those skills, not duplicates their content.

If any of these is unclear, ask before writing files. Stub skills age
badly — they sit in the routing table promising a workflow that does not
exist.

### Files to create / update

For a new skill named `<name>` (snake_case folder, kebab-case `name:`):

1. **`.cursor/skills/<name>/SKILL.md`** — required. Frontmatter + body.
2. **`.claude/commands/<name>.md`** — thin wrapper:

   ```markdown
   ---
   description: <one-line trigger summary, mirrors SKILL.md description>
   ---

   Load and follow `.cursor/skills/<name>/SKILL.md`.
   ```

3. **`CLAUDE.md` § Skills Index** — append row in **Pick when** format.
   Keep alphabetical.
4. **`.cursor/rules/rules.mdc` § Skills Index** — append matching row
   linking to the SKILL.md. Keep alphabetical and synchronised with the
   row in `CLAUDE.md`.
5. **Optional:** `.cursor/skills/<name>/references/`, `scripts/`,
   sample inputs, fixtures.

### SKILL.md frontmatter

```yaml
---
name: <kebab-case-name>
description: >-
  Use when <triggering condition>. <Concrete trigger phrases users say>.
  <Scope / data sources / tools the skill covers>.
---
```

Rules:

- `name`: lowercase, hyphens only. Max 64 chars.
- `description`: starts with `Use when`. Third person. Max ~1024 chars.
  Includes the trigger phrases the user actually says. **Do not summarise
  the workflow.** Description = WHEN to use; body = HOW. Workflow
  summaries cause the agent to follow the description instead of reading
  the body.
- Agents tend to **undertrigger** skills. Be slightly pushy in the
  description — list adjacent intents that should still pull this skill
  in, even when the user does not name it.

### SKILL.md body shape

Match in-repo style. Skip sections that do not apply:

1. **One-line purpose** at the top. Plain English. No marketing.
2. **When to use / When NOT to use** — routing decisions.
3. **Inputs / Tooling / Inventory** — concrete IDs, paths, env vars,
   commands. Reusable across invocations.
4. **Workflow / Steps** — numbered or sectioned. Imperatives ("Run X",
   "Open Y"). Concrete commands with paths. No paraphrased tool calls.
5. **What not to do** — explicit anti-patterns. Close loopholes from
   past mistakes.
6. **References** — link to sibling files for long-form material. Keep
   one level deep.

Writing style: plain, direct, imperative. No "I'll", "Let me", "Sure".
Cut adjectives that do not change meaning. Lead with the answer.

Aim for under ~500 lines. Spill anything longer into
`references/<topic>.md` and link from SKILL.md (one level deep).

### Step-by-step (scaffolding)

1. **Confirm scope.** Run `ls .cursor/skills/` and grep `description:`
   lines for overlap. If a close duplicate exists, point the user at it
   and stop. If the workflow triggers only once a quarter, keep it as a
   `.cursor/rules/<name>.md`.
2. **Pick the names.** Folder snake_case, frontmatter kebab-case, slash
   command matches folder. Verify nothing collides.
3. **Draft the description.** 2–4 sentences, opens with "Use when".
   Paste in 3+ concrete trigger phrases. Confirm at least one phrase
   from the user's request appears verbatim.
4. **Write `SKILL.md`.** Use the body shape above. Imperatives.
   Concrete paths, IDs, commands. No narrative.
5. **Add the slash command wrapper.** Two-line wrapper pointing at
   `SKILL.md`. Mirror `.claude/commands/qa_assistant.md`.
6. **Update both routing tables.** `CLAUDE.md` and `rules.mdc` rows
   must agree on the **Pick when** sentence; only the link target
   differs. Out-of-sync rows are the most common defect.
7. **Lint.** Run:

   ```bash
   python3 .cursor/skills/skill_creator/scripts/lint_skill.py <name>
   ```

   Checks frontmatter shape, `description` opens with `Use when`,
   slash command wrapper exists, both routing tables reference the
   skill. Fix anything it flags before handing off.
8. **Smoke test.** Open a new chat and trigger the skill with a phrase
   from its description. If it does not pick up, strengthen the
   triggers and re-test.

---

## Iteration motion (evals + improve loop)

Use when the user already has a skill draft and wants to test it,
benchmark it, or harden the description. The loop is: draft → run test
cases (with and without the skill) → review outputs → improve the skill
→ rerun → repeat. Stop when the user is satisfied or feedback is empty.

### Capture intent

Pin down four things before writing test cases. Extract from the
conversation first; ask only for the gaps:

1. What should this skill enable the agent to do?
2. When should it trigger? (user phrases / contexts)
3. Expected output format?
4. Are outputs objectively verifiable? File transforms, data extraction,
   code generation, fixed workflow steps → yes, assertions help.
   Subjective outputs (writing style, design) → skip assertions; rely on
   human review.

### Write the test cases

Save 2–3 realistic prompts — the kind a real user would type, not
abstract requests. Save to `evals/evals.json` under the skill folder:

```json
{
  "skill_name": "<name>",
  "evals": [
    {"id": 1, "prompt": "User's task prompt", "expected_output": "Description", "files": []}
  ]
}
```

Full schema in [`references/schemas.md`](references/schemas.md). Skip
assertions for now — draft them while runs are in progress.

### Run with and without the skill, in the same turn

For each test case, spawn two subagents in the same turn — one with the
skill, one without. Don't stagger; launch them together so they finish
around the same time.

Workspace layout (sibling to the skill folder):

```
<skill-name>-workspace/
└── iteration-1/
    ├── eval-0-<descriptive-name>/
    │   ├── with_skill/outputs/
    │   ├── without_skill/outputs/   # or old_skill/ when improving
    │   └── eval_metadata.json
    └── eval-1-...
```

Each subagent prompt:

```
Execute this task:
- Skill path: <path-to-skill>          # omit for baseline when creating
- Task: <eval prompt>
- Input files: <eval files or "none">
- Save outputs to: <workspace>/iteration-<N>/<eval-name>/with_skill/outputs/
- Outputs to save: <what the user cares about>
```

**Baseline depends on context.** Creating a new skill → baseline is no
skill. Improving an existing skill → snapshot the skill first
(`cp -r <skill-path> <workspace>/skill-snapshot/`) and point the
baseline subagent at the snapshot.

Per-eval `eval_metadata.json` (assertions can start empty):

```json
{"eval_id": 0, "eval_name": "descriptive-name", "prompt": "…", "assertions": []}
```

### While runs are in progress, draft assertions

Don't idle. Draft assertions for each test case and explain them to the
user. Good assertions are objectively verifiable and have descriptive
names that read clearly in the viewer. For programmatic checks, write
and run a script — don't eyeball.

Subjective skills (style, design): skip assertions. Human review is the
only signal worth trusting.

Update `eval_metadata.json` and `evals/evals.json` with the assertions
once drafted.

### Capture timing as subagents complete

Each subagent task notification carries `total_tokens` and `duration_ms`.
Save immediately to `timing.json` in the run directory — this is the
only time the data is available:

```json
{"total_tokens": 84852, "duration_ms": 23332, "total_duration_seconds": 23.3}
```

### Grade, aggregate, launch viewer

Once all runs complete:

1. **Grade.** Spawn a grader subagent that reads
   [`agents/grader.md`](agents/grader.md) and evaluates assertions
   against outputs. Save to `grading.json` per run. The viewer requires
   exact field names: `text`, `passed`, `evidence`.

2. **Aggregate.** From the skill_creator directory:

   ```bash
   python3 -m scripts.aggregate_benchmark <workspace>/iteration-N --skill-name <name>
   ```

   Produces `benchmark.json` + `benchmark.md` with pass_rate, time,
   tokens for each configuration (mean ± stddev + delta). Place each
   with_skill row before its baseline counterpart. Schema in
   [`references/schemas.md`](references/schemas.md).

3. **Analyst pass.** Read [`agents/analyzer.md`](agents/analyzer.md) and
   surface patterns aggregate stats hide — non-discriminating assertions,
   high-variance evals, time / token tradeoffs.

4. **Launch viewer.** From the skill_creator directory:

   ```bash
   nohup python3 eval-viewer/generate_review.py \
     <workspace>/iteration-N \
     --skill-name "<name>" \
     --benchmark <workspace>/iteration-N/benchmark.json \
     > /dev/null 2>&1 &
   VIEWER_PID=$!
   ```

   For iteration 2+, also pass
   `--previous-workspace <workspace>/iteration-<N-1>`. In headless
   environments (no display), use `--static <out.html>` to emit a
   standalone HTML file — feedback downloads as `feedback.json` on submit;
   copy it back into the workspace.

5. **Tell the user.** "Outputs tab → per-test review and feedback.
   Benchmark tab → pass rates, timing, tokens. Submit All Reviews when
   done."

### Read feedback and improve

When the user signals done, read `feedback.json` from the workspace:

```json
{"reviews": [{"run_id": "eval-0-with_skill", "feedback": "…", "timestamp": "…"}],
 "status": "complete"}
```

Empty feedback = the user thought it was fine. Focus on entries with
specific complaints.

Kill the viewer:

```bash
kill $VIEWER_PID 2>/dev/null
```

### How to improve

1. **Generalise from feedback.** The skill runs against many future
   prompts, not just these test cases. Resist overfitting to the
   examples. If a single issue is stubborn, try a different metaphor or
   workflow pattern instead of an oppressive MUST.
2. **Keep the prompt lean.** Read the transcripts, not just the final
   outputs. Cut sections that waste the model's time.
3. **Explain the why.** Replace rigid MUSTs / ALL-CAPS with reasoning the
   model can apply to edge cases. Theory of mind beats rote.
4. **Bundle repeated work.** If every subagent independently wrote the
   same helper (`create_docx.py`, `build_chart.py`), put it in
   `scripts/` once and point the skill at it.

### Iteration loop

1. Apply improvements to the skill.
2. Rerun all test cases into a fresh `iteration-<N+1>/`, including
   baselines. For "new skill" runs, baseline stays `without_skill`.
   For "improving" runs, choose: original snapshot or previous iteration.
3. Launch viewer with `--previous-workspace` pointing at iteration N.
4. Wait for feedback.
5. Improve, repeat.

Stop when the user says they are happy, feedback is empty, or progress
stalls.

### Advanced: blind comparison

For "is the new version actually better?" questions, spawn the
comparator described in [`agents/comparator.md`](agents/comparator.md) —
it judges two outputs without knowing which is which. Pair with
[`agents/analyzer.md`](agents/analyzer.md) to explain why the winner won.
Optional; most loops don't need it.

---

## Description optimization

The frontmatter `description` is the primary trigger mechanism. After
the skill stabilises, offer to optimise it. Bad eval queries → bad
descriptions; spend time on the eval set.

### Generate trigger eval queries

20 queries total, mix of should-trigger and should-not-trigger. Save as:

```json
[
  {"query": "the user prompt", "should_trigger": true},
  {"query": "another prompt", "should_trigger": false}
]
```

Queries must be realistic — concrete file paths, column names, company
names, casual speech, typos, abbreviations. Mix lengths. Edge cases beat
clear-cut ones; the user will sign off.

- **Should-trigger (8–10):** different phrasings of the same intent,
  cases where the user doesn't name the skill, adjacent intents this
  skill should still win.
- **Should-not-trigger (8–10):** near-misses — share keywords or domain
  but actually need something else. Obvious negatives ("write a fibonacci
  function" against a PDF skill) don't test anything.

### Review with the user

1. Read `assets/eval_review.html`.
2. Replace placeholders:
   - `__EVAL_DATA_PLACEHOLDER__` → the JSON array (raw, no quotes).
   - `__SKILL_NAME_PLACEHOLDER__` → the skill's name.
   - `__SKILL_DESCRIPTION_PLACEHOLDER__` → the current description.
3. Write to `/tmp/eval_review_<name>.html` and `open` it.
4. The user edits, toggles, exports. File lands in `~/Downloads/` (watch
   for `eval_set (1).json` if there are multiple).

### Run the optimization loop

```bash
python3 -m scripts.run_loop \
  --eval-set <path-to-trigger-eval.json> \
  --skill-path <path-to-skill> \
  --model <model-id-powering-this-session> \
  --max-iterations 5 \
  --verbose
```

Use the model ID powering the current session so the trigger test
matches what the user experiences. The loop splits 60/40 train/test,
runs each query 3× for a reliable trigger rate, proposes improvements
based on failures, re-evaluates on both sets, and selects
`best_description` by test score (not train) to avoid overfitting.

Tell the user it will take time; tail output for progress.

### How triggering actually works

Skills appear with `name + description` in `available_skills`. The agent
consults a skill only when it can't easily handle the task on its own.
**Simple one-step queries don't trigger skills even with a perfect
description match** — the agent handles them directly. Make trigger
eval queries substantive enough that consulting a skill is worth it.

### Apply the result

Take `best_description` from the JSON output, update the SKILL.md
frontmatter, and show the user before/after with the scores.

---

## Packaging (only if `present_files` is available)

```bash
python3 -m scripts.package_skill <path/to/skill-folder>
```

Direct the user to the resulting `.skill` file for install.

---

## What not to do

- Don't place project skills in `~/.cursor/skills-cursor/` — that path is
  for cross-project skills.
- Don't skip the slash command wrapper.
- Don't summarise the workflow in `description`. Workflow summaries make
  the agent skip the body.
- Don't add a routing row in only one of the two tables. The pair stays
  in sync.
- Don't stub a SKILL.md with TODOs and ship it.
- Don't run trigger optimization on a skill the user hasn't agreed is in
  good shape — wasted tokens.
- Don't grade subjective outputs with assertions. Use human review.
- Don't write custom HTML for the viewer — use `generate_review.py`.

---

## References

- Scripts: [`scripts/`](scripts/) — `aggregate_benchmark.py`,
  `run_loop.py`, `package_skill.py`, `quick_validate.py`,
  `improve_description.py`, `generate_report.py`, `run_eval.py`,
  `utils.py`, `lint_skill.py`.
- Subagent briefs: [`agents/grader.md`](agents/grader.md),
  [`agents/comparator.md`](agents/comparator.md),
  [`agents/analyzer.md`](agents/analyzer.md).
- Viewer: [`eval-viewer/generate_review.py`](eval-viewer/generate_review.py).
- Schemas: [`references/schemas.md`](references/schemas.md).
- Trigger-eval review template: [`assets/eval_review.html`](assets/eval_review.html).
- Routing tables to mirror: `CLAUDE.md` § Skills Index,
  `.cursor/rules/rules.mdc` § Skills Index.
- Slash command pattern: `.claude/commands/qa_assistant.md`,
  `.claude/commands/optimizer.md`.
- In-repo style examples: `.cursor/skills/trello_assistant/SKILL.md`,
  `.cursor/skills/qa_assistant/SKILL.md`,
  `.cursor/skills/db_access/SKILL.md`.
- Global skill-authoring guidance:
  `~/.cursor/skills-cursor/create-skill/SKILL.md` — use that for skills
  living outside this repo.
