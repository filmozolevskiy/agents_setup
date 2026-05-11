---
name: deployment-review
description: >-
  Use when something started failing at a known point in time and the user
  asks "what changed in genesis around T?", "what was deployed between T1
  and T2?", "which PR caused this regression?", "correlate the spike to a
  deploy", "did a deploy land before <symptom> showed up?", or any
  variation that needs a ranked list of merged PRs in a regression window
  on the genesis repo. Walks merges into the production branch
  (`mventures/genesis` → `develop`) via the GitHub MCP, ranks candidates
  by symptom-keyword overlap against PR title / body / changed files /
  linked Trello card, and surfaces the top N with rationale. Genesis only
  — no other repos.
---

# Deployment Review

Correlate a regression window on `mventures/genesis` to the merged PRs
most likely to have caused it. Reads the production branch's merge
history through the GitHub MCP, scores each PR against the symptom the
user named, and returns a ranked shortlist with the evidence the user
needs to confirm or rule each one out.

The skill stops at "here are the most likely PRs and why." It does not
revert, hot-fix, or open follow-up cards on its own — that is the user's
call once they pick the suspect.

## When to use

- "<symptom> started failing around <timestamp>" / "what changed in
  genesis on <date>".
- "What was deployed between <T1> and <T2>" — the user wants the
  timeline, not a single suspect.
- ClickHouse error spike, bookability rate drop, optimizer leak hits a
  cliff, Payhub Sale failure surge — anything where the *time* is the
  signal and "blame the deploy" is on the table.
- Pre-rollback triage: which one PR to revert first.

## When NOT to use

- The symptom has no clean onset time (gradual degradation over weeks).
  Use `bookability_analysis` / `optimizer_analysis` to find a real
  break first; this skill is useless without a window.
- The change you suspect is in a non-genesis repo. Genesis only —
  separate skills handle other surfaces.
- Looking up the diff of one specific PR you already know about. Just
  open the PR on GitHub or call `get_pull_request` directly.
- Re-counting failure rates by deploy. That belongs in
  `bookability_analysis` (joining ClickHouse / MySQL slices to a deploy
  timeline) once a candidate PR has been picked here.

## Inventory (fixed)

| Item | Value |
|------|-------|
| Repo | `mventures/genesis` |
| Production branch (merge target) | `develop` |
| Deployment proxy | merges into `develop` (no separate Deployments API source) |
| Local clone (optional) | `$GENESIS_PATH` from `.env` (auto-synced by [`codebase_access`](../codebase_access/SKILL.md) — `.cursor/skills/codebase_access/scripts/sync_genesis.sh`) |
| GitHub MCP | `user-GitHub` (tools `list_pull_requests`, `get_pull_request`, `get_pull_request_files`, `list_commits`) |
| Ranking helper | `.cursor/skills/deployment_review/scripts/rank_prs.py` |
| PAT (header use) | `GITHUB_PERSONAL_ACCESS_TOKEN` in `.env` (only when the agent needs the REST API directly; MCP is preferred) |

`develop` is the production-equivalent branch on this repo. Treat every
PR with `merged_at` in the window and `base.ref == "develop"` as a
deployment candidate; do not double-count by also pulling closed PRs
that never merged.

## Workflow

### 1. Pin the regression window

Get one anchor timestamp from the user (or a CTE the user already ran):
the first time the symptom showed up. Default the window to the **24
hours before** that anchor — most regressions ship 0–24h before the
symptom is noticed.

If the user gives a range (`--from T1 --to T2`), use it verbatim. If
they give a single timestamp `T`, use `[T - 24h, T]`. State the window,
the timezone, and the anchor in one short line back to the user before
querying GitHub.

### 2. Pull merged PRs into `develop` in the window

GitHub's `list_pull_requests` does not filter by `merged_at` directly;
list `state=closed`, `base=develop`, `sort=updated`, `direction=desc`,
and walk pages until `updated_at` precedes the window's lower bound.
Drop entries where `merged_at` is null (closed-but-not-merged) or falls
outside the window.

```javascript
list_pull_requests({
  owner: "mventures",
  repo: "genesis",
  state: "closed",
  base: "develop",
  sort: "updated",
  direction: "desc",
  per_page: 100,
  page: 1,
})
```

Save the filtered set to a JSON file under `reports/` (gitignored) —
the helper script reads it. One object per PR with at least
`number`, `title`, `user.login`, `merged_at`, `body`,
`html_url`, `labels[].name`.

### 2a. (Narrow symptoms) Sanity-check with `search_issues`

When the symptom is a single distinctive token (a supplier name like
`intelisys`, a unique error code like `NDC-1348`, an unambiguous module
name) — anything that is unlikely to appear in PR titles outside the
relevant area — run a GitHub Code Search via the MCP first to bound the
candidate set:

```javascript
search_issues({
  q: "repo:mventures/genesis is:pr is:merged "
   + "merged:2026-05-05T19:24:00Z..2026-05-07T19:24:00Z intelisys",
  per_page: 50,
})
```

If `total_count` is small (≤ 5) the result is the answer at the
title/body grain; you can skip step 3 entirely for the PRs not in that
set, saving one `get_pull_request_files` call per dropped candidate. If
`total_count` is large or the symptom is generic (`payhub failures`,
`amadeus errors`), skip this step — the keyword-overlap ranker is the
right tool for those. Code Search misses silent file-touchers (a PR
that touches `src/Supplier/Intelisys/...` without saying "intelisys" in
title or body), but those are rare enough that step 3 + the ranker
will surface them anyway when needed.

### 3. Enrich each PR with changed files

For every PR in the window, call `get_pull_request_files` and merge the
returned `filename` list into the PR record under a `files` key. Cap at
the first ~50 files per PR — anything bigger is almost always a
mass-rename / lint sweep and contributes noise to the ranking.

A PR's body and labels are already in the `list_pull_requests`
response; do not refetch with `get_pull_request` unless you need the
mergeable state or the timeline events.

### 4. Rank against the symptom

Hand the enriched JSON and the user's symptom phrase to the ranking
helper:

```bash
python3 .cursor/skills/deployment_review/scripts/rank_prs.py \
  --prs-file reports/prs_<from>_<to>.json \
  --symptom "PayHub Sale failures" \
  --top 10
```

The helper:

- Tokenizes the symptom (lowercase, drops words ≤ 2 chars, drops
  English stopwords).
- Expands a small set of known area aliases (`payhub` → `payhub`,
  `sale_pgwy`, `payment`, `gateway`; `optimizer` → `optimizer`,
  `contestant`, `reprice`; `bookability` → `bookable`, `availability`,
  `verifyprice`; etc. — see [`scripts/rank_prs.py`](scripts/rank_prs.py)
  for the full table).
- Scores each PR: title match `+3`/keyword, changed-file path match
  `+2`/keyword, body match `+1`/keyword, plus `+5` if any label name
  contains a matched keyword.
- Extracts a Trello card link from the PR body via the regex
  `trello\.com/c/([A-Za-z0-9]+)` and surfaces it.
- Outputs a markdown table sorted by score (ties broken by `merged_at`
  desc) with one row per PR: rank, PR (linked), author, merged_at,
  files matched, score, Trello card, rationale.

### 5. Hand the table to the user

Paste the table back to the user as the answer. Add **one** short
paragraph above it stating the window, the symptom, and the anchor
timestamp the window was built from. Do not editorialize the suspects —
the user reads the rationale column and decides.

If the top score is `0`, say so plainly: "No PR in the window touches
files / titles matching `<symptom>`." Then list the top 5 anyway
(sorted by `merged_at` desc) so the user can eyeball them — sometimes
the keyword model misses a renamed module.

## Output shape

```markdown
Window: 2026-05-06 18:00 UTC → 2026-05-07 18:00 UTC (24h before the
first ClickHouse spike at 2026-05-07 18:14 UTC). Symptom: "PayHub Sale
failures". Repo: mventures/genesis @ develop.

| # | PR | Author | Merged (UTC) | Score | Files matched | Trello | Rationale |
|---|-----|--------|--------------|-------|---------------|--------|-----------|
| 1 | [#12345 PAYHUB: refactor Sale gateway selector](…) | jdoe | 2026-05-07 14:02 | 11 | `app/services/payhub/sale.rb`, `lib/payment/gateway.rb` | [vfq9kuwV](…) | title hits `payhub`+`sale`; files hit `payhub`/`payment`/`gateway` |
| 2 | … |
```

## What not to do

- Do not query non-genesis repos. The card scopes this skill to genesis
  only.
- Do not treat the helper's score as a verdict. It is a ranker, not a
  classifier — the user reads the rationale column and confirms with a
  diff or a test booking.
- Do not paste the full PR list when the user asked for "the suspects".
  Top 10 by score (or top 5 + a "no clean match" note) is the contract.
- Do not refetch `get_pull_request` for every PR in the window. The
  list response carries enough context; only paginate `_files` on top.
- Do not mutate the genesis repo. Read-only. Reverts and rollbacks are
  the user's decision after this skill hands them the shortlist.
- Do not invent a deployment source. Merges into `develop` is the
  canonical timeline for this repo. If the team starts publishing
  GitHub Deployments later, update this skill (and the card the change
  is filed against) before the agent picks them up.
- Do not skip the timezone in the window line. UTC by default; if the
  user gave a local time, convert and state both.

## References

- Card the skill was built against:
  [vfq9kuwV — Deployment review skill](https://trello.com/c/vfq9kuwV).
- GitHub MCP tool descriptors:
  `~/.cursor/projects/.../mcps/user-GitHub/tools/list_pull_requests.json`,
  `.../get_pull_request_files.json`,
  `.../list_commits.json`.
- Optional local clone helper: [`codebase_access`](../codebase_access/SKILL.md) — `.cursor/skills/codebase_access/scripts/sync_genesis.sh`.
- Skill conventions: [`../skill_creator/SKILL.md`](../skill_creator/SKILL.md).
