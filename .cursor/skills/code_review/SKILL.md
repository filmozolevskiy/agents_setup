---
name: code-review
description: >-
  Use when the user wants a pull request reviewed against the team's coding
  standards on `mventures/genesis` — trigger phrases: "review this PR",
  "code review for <PR link>", "what would JP say about this PR", "check this
  diff against our standards", "QA my own draft PR before I ask for review",
  "lint this PR against our review rules". Loads the mined standards corpus
  at `.cursor/skills/code_review/references/standards.md` (a flat list of
  numbered Rules `R<NN>`, each backed by ≥2 of JP's historical PR review
  permalinks), walks the PR diff via the GitHub MCP, and emits findings to
  chat by default. Optional gated post-back posts the findings as a single
  GitHub PR review (comments only, never an approval / request-changes
  state) on explicit user `approve`. Also covers re-mining and refreshing
  the standards corpus from new JP comments on an incremental cadence.
  Genesis only — no other repos.
---

# Code Review

Review a genesis pull request against the team's mined coding standards.
The standards live in [`references/standards.md`](references/standards.md)
— each rule is a recurring theme in JP's historical PR review comments
backed by ≥2 distinct PR permalinks. The skill walks the PR diff, finds
violations of those rules, and reports them to chat.

The skill stops at "here are the findings." Posting back to the PR is a
separate, explicitly-gated step (comments only, never approve / request
changes). Mutating the codebase is out of scope.

## When to use

- "review this PR <link>" / "code review for <PR>".
- "what would JP flag on this PR" / "check this diff against our standards".
- "QA my own draft PR before asking for review" — self-check on a
  not-yet-opened PR.
- "refresh code_review standards" / "re-mine JP comments" — refresh
  motion only.

## When NOT to use

- The PR is in a non-genesis repo. Genesis only.
- The user wants design feedback, architectural review, or "is this a
  good approach" — the skill enforces *recurring* standards, not
  one-shot architectural judgment. Send that to a human reviewer.
- The user wants to *write* code or fix violations. The skill cites; it
  does not edit.
- Auto-running on every PR via webhook / Action. The skill is
  user-invoked, chat-first.

## Inventory (fixed)

| Item | Value |
|------|-------|
| Repo | `mventures/genesis` |
| Reviewer of record | `jpleveille-mv` (JP) — see [`CONTEXT.md`](CONTEXT.md) |
| Standards file | [`references/standards.md`](references/standards.md) |
| Raw corpus dump | `reports/code_review/jp_comments.jsonl` (gitignored) |
| Mining script | `.cursor/skills/code_review/scripts/mine_jp_comments.py` |
| GitHub MCP | `project-0-agents_setup-GitHub` (tools: `search_issues`, `get_pull_request`, `get_pull_request_files`, `get_pull_request_comments`, `get_pull_request_reviews`, `create_pull_request_review`) |
| Initial corpus window | 3 months back from first mine — see [`docs/adr/0001-chat-first-output-with-gated-post-back.md`](docs/adr/0001-chat-first-output-with-gated-post-back.md) |
| Refresh cadence | manual trigger, incremental from `max(pr_merged_at)` |

## Rule shape

Every entry in `standards.md` follows this template. The mining motion
produces them; the review motion consumes them.

```markdown
### R<NN>: <short imperative title>

**Rule:** <one sentence, imperative>

**Why:** <one sentence — the failure mode the rule prevents>

**Smell to detect:** <concrete pattern a reviewer or agent can grep / eyeball — file globs, code shapes, naming, structural cue>

**Skip if:** <optional bullet list — contextual cues that suppress or downgrade a smell match; cite the dev pushback permalink that justifies the guard>

**Evidence:**
- https://github.com/mventures/genesis/pull/<N>#discussion_r<id> — "<JP quote, trimmed>"
- https://github.com/mventures/genesis/pull/<N>#discussion_r<id> — "<JP quote, trimmed>"

**Severity:** blocker | nit

**last_evidence_at:** YYYY-MM-DD
```

Field rules:

- **R<NN>** is sequential and stable. Rules retired during refresh keep
  their number; the next new rule gets the next free number. Never
  renumber.
- **Smell to detect** is the positive match — agent flags if any bullet
  matches.
- **Skip if** is optional. When present, agent suppresses the finding
  if any bullet matches (or downgrades to `weak` when the bullet says
  so explicitly). Each bullet cites the dev pushback permalink that
  justifies the guard — same provenance discipline as Evidence.
- **Evidence** has ≥2 entries from ≥2 distinct PRs. A rule with one PR
  of evidence is a one-off taste call, not a Standard — drop it.
- **Severity** defaults to `nit`. Promote to `blocker` only when JP's
  cited comments use words like "must", "no", "this is a bug",
  "blocker" repeatedly across the evidence set.
- **last_evidence_at** is the newest `pr_merged_at` across the rule's
  Evidence permalinks. Auto-maintained by the mining script. Never edit
  by hand.

## Review motion

User pastes a PR URL. The skill:

### 1. Load the standards

Read `references/standards.md` end-to-end. If the file is missing or
empty, stop and tell the user to run the mining motion first.

### 2. Fetch the PR diff

```javascript
get_pull_request({ owner: "mventures", repo: "genesis", pull_number: <N> })
get_pull_request_files({ owner: "mventures", repo: "genesis", pull_number: <N> })
```

Cap at the first ~50 files. Larger PRs get a note in the report:
"Reviewed first 50 of <total> files; re-run with `--scope <glob>` for
the rest." (Scope flag is informational — the skill does not implement
filtering; the user re-invokes with a narrower mental scope.)

### 3. Walk each Rule against the diff

For each `R<NN>` in `standards.md`, evaluate its `Smell to detect`
against the changed files / hunks. A finding is one (rule, file, line
range) tuple. Multiple violations of the same rule in the same file
produce multiple findings — do not deduplicate.

Then, for each smell match, consult the rule's `Skip if:` bullets (if
present) against the same hunk and the surrounding package:

- If any bullet matches and reads as a hard suppression, drop the
  finding entirely.
- If any bullet matches and reads as a downgrade ("emit `weak` unless
  the class also exhibits…"), keep the finding but mark it `weak` and
  carry the `Why weak:` line from the `Skip if:` text.

`Skip if:` exists because dev pushback on prior automated reviews
showed the agent firing on smell matches that JP himself would not
flag in context (factory-instantiated classes for R06 / R08,
sibling-pattern DTOs for R17). Adding to `Skip if:` is the cheapest
way to fix a false positive without retiring the rule.

### 4. Emit the chat report

```
Findings: <X> firm, <W> weak across <Y> rules · <B> blocker · <N> nit

[R07 blocker · firm] BookingService.java:142
  Rule: Wrap multi-step DB writes in an explicit transaction.
  Found: Three sequential repository writes with no transaction boundary.
  Evidence: <permalink to JP's anchor comment cited in R07>

[R14 nit · weak] OptimizerCandidateBuilder.java:88
  Rule: Use the named constructor, not the positional one.
  Found: `new Candidate(...)` with 7 positional args.
  Evidence: <permalink>
  Why weak: Inline comment above the call explains the positional order is required to match an upstream supplier payload — author likely knows.

---

Positive observation (not a finding):
  <path> — <one sentence stating what the diff changed and which rule it repairs / aligns with>.
```

Top-line summary line first, then one block per finding sorted
**blocker before nit**, then by file path. No prose wrapping.

**Confidence tag (`· firm` / `· weak`)** appears on every finding next to
the severity. `firm` means the Smell to detect matches and the context
gives no reason to defer; `weak` means the Smell matches but a
contextual cue suggests the violation is deliberate, already known, or
out of scope. A `weak` finding always carries a one-line **`Why weak:`**
annotation immediately under the Evidence line. Use `weak` sparingly —
when in doubt, mark `firm`; the user can dismiss false positives faster
than re-investigate buried real ones.

**Positive observation (optional)** — append a single `Positive
observation (not a finding):` section at the bottom when the diff
contains a change that *repairs* an existing rule violation in the
touched file (e.g. replaces a magic literal with a named constant,
narrows a `protected` member to `private`, deletes an unused method).
One sentence per observation. Names the file and the rule it aligns
with. Skip the section entirely when the diff has no such change — do
not invent observations to fill it.

### 5. (Optional, gated) Post back to GitHub

Only when the user says "post it" / "post to PR" / "send to GitHub":

1. Reformat findings into the `create_pull_request_review` payload
   shape:
   - `body` = top-line summary + any Positive observation lines (a
     short note on weak findings is fine — "<N> additional weak
     findings shown in chat, not posted").
   - `comments` = one inline per **firm** finding only (`path`, `line`,
     `body` = `[R<NN> severity] Rule: … · Found: … · Evidence: <permalink>`).
     **Weak findings stay in chat; do not post them as inline comments.**
   - `event` = `COMMENT`. **Never `APPROVE` or `REQUEST_CHANGES`.**
2. Paste the full proposed payload in chat. Ask for `approve`.
3. On `approve`, call `create_pull_request_review`. Paste the resulting
   review URL back to the user. On anything else, stop.

## Mining motion (initial — first time only)

Produces `standards.md` from scratch. ~3 months back from today,
JP-authored review comments + review summaries on PRs merged into
`develop`. Single run, ~1k JP comments expected.

### 1. Fetch the corpus

```bash
python3 .cursor/skills/code_review/scripts/mine_jp_comments.py \
  --since 2026-03-09 \
  --out reports/code_review/jp_comments.jsonl
```

The script paginates merged PRs via `search_issues` (`repo:mventures/genesis
is:pr is:merged base:develop merged:>=<since> commenter:jpleveille-mv`),
then for each PR pulls `get_pull_request_comments` + `get_pull_request_reviews`,
filters to `user.login == "jpleveille-mv"`, and writes one JSON-line per
comment with the 12 fields defined in [`CONTEXT.md`](CONTEXT.md) (Corpus
term).

State the totals back: PRs walked, comments captured, comments dropped
(threads JP replied to but didn't anchor).

### 2. Cluster (histogram gate)

Group comments by recurring theme. Map-reduce over the JSONL — batch by
~300 comments, propose cluster labels per batch, then merge labels
across batches. Show the user a flat histogram:

```
Proposed themes (NN comments, NN distinct PRs):
  - Transaction boundaries on multi-step writes (42 comments, 18 PRs)
  - Null handling at supplier response boundaries (31 comments, 14 PRs)
  - Test fixtures over inline magic numbers (24 comments, 9 PRs)
  - ...
```

User approves macro shape — `merge X+Y`, `split Z into A/B`, `drop W`,
`keep`. No Rule prose is written until the user signs off the histogram.

### 3. Draft `standards.md`

For each approved theme, draft the full Rule entry (all 6 fields,
≥2 distinct PR permalinks pulled directly from the cluster). Drop any
theme that does not meet the ≥2-distinct-PR threshold — those are
one-offs.

Write the full file in one pass. Number sequentially from `R01`.

### 4. User edit pass

Hand the file to the user for one substantive edit (merge / split /
drop / re-word). After that, lock in v1.

## Refresh motion

User says "refresh code_review standards" / "re-mine JP comments".

### 1. Incremental fetch

```bash
python3 .cursor/skills/code_review/scripts/mine_jp_comments.py \
  --since "$(max-last-evidence-at-from-standards-md)" \
  --append reports/code_review/jp_comments.jsonl
```

The script reads the current `standards.md`, computes the max
`last_evidence_at`, and uses it as the new `--since`. Appends to the
existing JSONL — does not re-fetch.

### 2. 3-bucket diff gate

Cluster the new comments. Show the user three lists, not one:

```
New themes (no existing Rule):
  - <theme>: NN comments, NN PRs

Reinforced (existing Rule picks up evidence):
  - R07 (Transaction boundaries): +6 comments, +3 PRs → last_evidence_at 2026-06-08
  - R14: +2 comments, +1 PR → last_evidence_at 2026-06-05

Going stale (existing Rule, no new evidence in refresh window):
  - R03: last_evidence_at 2025-12-14 (>6 months)
  - R11: last_evidence_at 2025-11-02 (>6 months)
```

User approves per bucket: which New themes become Rules, which Going-
stale Rules get demoted or dropped. Reinforced rules auto-append the
new permalinks and bump `last_evidence_at` — no user input needed.

### 3. Apply and commit

Write the updated `standards.md`. One git commit per refresh — the
commit message names the window (`refresh: standards from <since> to
<today>`).

## What not to do

- Do not run the review motion if `standards.md` is empty. Tell the
  user to mine first.
- Do not post a PR review without the user's explicit `approve` against
  the full payload shown in chat.
- Do not post `APPROVE` or `REQUEST_CHANGES` as the review state. Ever.
  Comments only — see [`docs/adr/0001-chat-first-output-with-gated-post-back.md`](docs/adr/0001-chat-first-output-with-gated-post-back.md).
- Do not include findings without a Rule ID. Every finding cites
  `R<NN>` and one Evidence permalink from that rule.
- Do not mine non-JP comments. The corpus is JP-authored only. Other
  reviewers' comments get filtered at fetch time.
- Do not write Rules with one PR of evidence. ≥2 distinct PRs or drop.
- Do not edit `last_evidence_at` by hand. It is derived; the mining
  script maintains it.
- Do not commit `reports/code_review/jp_comments.jsonl`. It is
  gitignored — the raw mining artifact, not source-of-truth.
- Do not extend the skill to non-genesis repos without a new ADR.
- Do not auto-schedule the refresh. Manual trigger only.

## References

- Glossary: [`CONTEXT.md`](CONTEXT.md) — Standard, Rule, Smell to
  detect, Evidence permalink, Corpus, Histogram gate, Refresh, Gated
  post-back, JP.
- Output discipline ADR: [`docs/adr/0001-chat-first-output-with-gated-post-back.md`](docs/adr/0001-chat-first-output-with-gated-post-back.md).
- Standards corpus: [`references/standards.md`](references/standards.md).
- Mining script: [`scripts/mine_jp_comments.py`](scripts/mine_jp_comments.py).
- Sibling skill (genesis read access): [`../codebase_access/SKILL.md`](../codebase_access/SKILL.md).
- Sibling skill (PR-to-deploy correlation): [`../deploy_blamer/SKILL.md`](../deploy_blamer/SKILL.md).
- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
