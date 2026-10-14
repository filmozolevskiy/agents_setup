---
name: growthbook
description: >-
  Use when the user asks about a GrowthBook feature flag or experiment (XP):
  "is flag X on", "what does the FareFamilyPenaltyFeeMarkup XP do", "check
  the targeting rules for <flag>", "what variation is <attribute> bucketed
  into", "is this experiment still running", "what changed on this flag
  recently", or references "GrowthBook" / "XP" / "feature flag" by name.
  Also use when another skill (bookability, optimizer, debugger,
  deploy_blamer) traces a code path through
  `src/Ota/FeatureFlags/Flags/*` and needs the live flag definition — not
  just the PHP wrapper class — to confirm targeting, rollout percentage, or
  which variation is live in a given environment. Covers read access to
  flags, experiments, and their rules via the GrowthBook MCP server. Does
  not cover creating or toggling flags — FlightHub GrowthBook write access
  goes through the GrowthBook app UI, not this skill.
---

# GrowthBook

FlightHub self-hosts GrowthBook. This skill is the entry point for reading
feature-flag / experiment (XP) state: whether a flag is on, its targeting
rules, its variations, and its recent change history.

## When to use

- User asks whether a flag or experiment is on, off, or rolled out to some
  percentage / attribute segment.
- User names an XP the genesis backend reads via GrowthBook — e.g.
  `FareFamilyPenaltyFeeMarkup`, `FareFamilyChangeRefundMarkup`,
  `FareFamilyChangeRefundMarkupMobile` (see
  `src/Ota/FeatureFlags/Flags/` in the genesis codebase for the full list
  of PHP wrapper classes) — and wants to know the flag's current
  definition, not just how the code consumes it.
- Another skill's investigation (bookability, optimizer, debugger,
  deploy_blamer) hits a `FlagMutator\GrowthBook` or
  `External\GrowthBook\Api` call and needs live confirmation of what the
  flag actually evaluates to, to avoid guessing from code alone.
- User wants a link to a flag or experiment page to drop into a Trello
  card, PR description, or chat reply.

## When NOT to use

- Creating, archiving, or toggling a flag's state — do that in the
  GrowthBook app UI (`https://gb.flighthub.com`), not through this skill.
  This skill is read-oriented.
- The question is fully answered by reading the PHP wrapper class under
  `src/Ota/FeatureFlags/Flags/` (e.g. "what attributes does this flag
  read") — use `codebase_access` directly, no need to hit the live API.
- Deploy/regression triage where the question is "what PR changed this
  behavior" — that's `deploy_blamer`, even if a flag is involved.

## Tooling

The GrowthBook MCP server (`@growthbook/mcp`) is registered in
`.cursor/mcp.json` as `growthbook`, launched via
[`scripts/mcp_growthbook.sh`](scripts/mcp_growthbook.sh). The script
sources `.env` for `GB_API_KEY`, `GB_EMAIL`, and `GB_API_URL` (self-hosted
API at `https://gb-api.flighthub.com`; app at `https://gb.flighthub.com`
per `.env.example`) and execs `npx -y @growthbook/mcp@latest`.

If the `growthbook` MCP tools are not visible in the current session
(server config changes require a fresh session to pick up), tell the user
to restart the session — do not try to invoke `mcp_growthbook.sh` directly
as a shell command; it's a long-running MCP server process, not a
one-shot script.

`GB_API_KEY` is a management REST API key / PAT, not the SDK client key
genesis uses at runtime (`growthbook_client_key` in `Solar_Config`,
consumed by `src/Ota/FeatureFlags/External/GrowthBook/Api.php`). Read
scope is enough for this skill's purpose.

## Workflow

1. Confirm the flag or experiment name. If the user only described
   behavior ("that thing that waives the change fee"), cross-reference
   `src/Ota/FeatureFlags/Flags/` via `codebase_access` first to get the
   exact GrowthBook key the PHP class reads.
2. Query the GrowthBook MCP tools for the flag/experiment definition:
   current state (on/off per environment), targeting rules, variations,
   rollout percentage.
3. Answer with the concrete state, not a paraphrase — quote the
   targeting condition or variation weights as given by the tool.
4. Cite the flag with its full GrowthBook app URL
   (`https://gb.flighthub.com/features/<flag-key>` or
   `https://gb.flighthub.com/experiment/<experiment-id>`), never the bare
   flag key — per the project's linkable-artefact rule.

## What not to do

- Don't toggle or edit a flag through this skill. Point the user at the
  GrowthBook app for writes.
- Don't answer flag-state questions from memory or from the PHP wrapper
  class alone — the wrapper only shows what attributes are read, not the
  live targeting/rollout. Query the MCP server.
- Don't cite a flag by bare key name in a report, card, or PR — always
  the full app URL.

## References

- MCP launcher: [`scripts/mcp_growthbook.sh`](scripts/mcp_growthbook.sh)
- MCP registration: `.cursor/mcp.json` (`growthbook` entry)
- Credentials: `.env` (`GB_API_KEY`, `GB_EMAIL`, `GB_API_URL`) — see
  `.env.example` for the self-hosted host comments.
- genesis-side flag wrapper classes:
  `.cursor/skills/codebase_access/codebase/src/Ota/FeatureFlags/Flags/`
  (read via `codebase_access`)
- genesis-side GrowthBook client:
  `.cursor/skills/codebase_access/codebase/src/Ota/FeatureFlags/External/GrowthBook/Api.php`,
  `.../FlagMutator/GrowthBook.php`
