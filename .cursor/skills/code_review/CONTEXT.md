# code_review

The skill that reviews a genesis pull request against a mined corpus of standards extracted from JP's historical PR comments.

## Language

**Standard**:
A recurring theme in JP's PR review comments, supported by ≥2 distinct PR permalinks. The unit of judgment the skill enforces.
_Avoid_: convention, guideline, rule-of-thumb

**Rule**:
A single structured entry in `standards.md` (`R<NN>`) representing one Standard. Has 6 fields: Rule, Why, Smell to detect, Evidence, Severity, last_evidence_at.
_Avoid_: standard (use Standard for the concept, Rule for the entry), check, lint

**Smell to detect**:
The concrete pattern a reviewer (human or agent) greps or eyeballs to spot a Rule violation in a diff. File globs, code shapes, naming, structural cues — never JP's words.
_Avoid_: pattern, anti-pattern, signal

**Evidence permalink**:
A `https://github.com/mventures/genesis/pull/<N>#discussion_r<id>` URL anchoring one of JP's comments to a Rule. A Rule with fewer than 2 distinct PRs of Evidence is not a Standard and does not ship.
_Avoid_: citation, reference, source

**Corpus**:
The JSONL dump at `reports/code_review/jp_comments.jsonl` (gitignored) — every JP review comment and review-summary on a merged-into-`develop` PR in the configured window. The raw mining artifact Rules are clustered from.
_Avoid_: dataset, archive, comment dump

**Histogram gate**:
The approval step between raw mining and Rule drafting. Agent shows clustered theme labels with comment counts; user approves macro shape (merge / split / drop) before any Rule prose is written.
_Avoid_: cluster review, theme approval

**Refresh**:
A user-triggered incremental re-mine from `max(pr_merged_at)` onward, producing a 3-bucket diff gate (New / Reinforced / Going stale) against the existing `standards.md`. Never scheduled, never automatic.
_Avoid_: update, sync, re-mine (use Refresh)

**Gated post-back**:
The optional second step where the agent reformats a chat-only review into a GitHub PR review payload, shows the full payload in chat, and posts only on explicit user approval. Never posts an approval / request-changes state — comments only.
_Avoid_: auto-comment, post to PR, push review

**JP**:
Jean-Philippe Léveillé (`jpleveille-mv`), Senior Lead Developer at FlightHub. The single authoring source of truth for the Corpus. Other reviewers' comments are filtered out at mine time.
_Avoid_: the lead, the senior, reviewers
