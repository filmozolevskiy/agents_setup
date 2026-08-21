# Restricted tag as an Optimizer dimension

Date: 2026-08-13
Skill: `looker`
Status: approved in chat (approach A — values string, field picker only)

## Problem

Diego asked to add tag `Restricted` as a dimension on the Optimizer dashboard so he can group and filter by the reason text.

The tag exists in production. It is not in Looker.

Evidence (MySQL `ota`, timestamps as stored):

- Catalog: `optimizer_tags.id = 281`, `name = 'Restricted'`, `created_at = 2026-08-12 11:54:29`.
- Grain: attempt-level only. 117 rows on `optimizer_attempt_tags` through `2026-08-13 15:13:22`. 0 rows on `optimizer_candidate_tags` from `2026-08-12` onward.
- Values: 8 distinct reason strings. Max 1 value per attempt.
- Observed values: `Fare increase detected`, `farelogix optimization blocked for AA with seats selected`, `intelisys baggage selections will disable optimization`, `dida baggage selections will disable optimization`, `amadeus baggage selections will disable optimization`, `Blocked by Internal QA: real_fare_increase`, `Blocked by Internal QA: Disabled optimizer`, `travelfusion baggage selections will disable optimization`.

Diego’s query also filtered `tag_id IN (281, 291)`. 291 is a different tag: `Aborted`. Out of scope.

## Decision

Add one public string field **Attempt Restricted Values** on the New Optimizer explore (`content_integration_optimizer`). Same shape as **Attempt Filtered Values**.

Do not add a dashboard filter or tile on [Optimizer Dashboard 1642](https://flighthub.looker.com/dashboards/1642). Diego adds the field to looks himself.

Do not add a yes/no “is restricted” flag.

## Field contract

| Item | Value |
|------|--------|
| Explore | `content_integration_optimizer` (“New Optimizer”) |
| Public field | `content_integration_optimizer.attempt_restricted_values` |
| Label | Attempt Restricted Values |
| Group | `4. TAGS` |
| Type | string |
| Empty case | `NULL` when the attempt has no Restricted tag |
| Join key | `ota.optimizer_tags.name = 'Restricted'` — never hardcoded id 281 |
| Collapse | `GROUP_CONCAT(DISTINCT … ORDER BY value SEPARATOR ', ')` even though today’s max is 1 value per attempt |

The field applies to every contestant row of a matching attempt. Filtering it keeps the whole attempt, not one contestant. That is the existing attempt-tag rule in [content_integration_optimizer.view.lkml](https://github.com/filmozolevskiy/content_integration_optimizer/blob/master/views/content_integration_optimizer.view.lkml) (attempt-level TAGS block).

## Files

LookML repo [filmozolevskiy/content_integration_optimizer](https://github.com/filmozolevskiy/content_integration_optimizer):

1. [views/optimizer_attempt_tags_pivot.view.lkml](https://github.com/filmozolevskiy/content_integration_optimizer/blob/master/views/optimizer_attempt_tags_pivot.view.lkml) — add the `GROUP_CONCAT` column and a hidden dimension `attempt_restricted_values`. Keep the existing `{% condition %}` push-down. Do not add a new derived table.
2. [views/content_integration_optimizer.view.lkml](https://github.com/filmozolevskiy/content_integration_optimizer/blob/master/views/content_integration_optimizer.view.lkml) — add the public dimension next to `attempt_filtered_values`, reading `${optimizer_attempt_tags_pivot.attempt_restricted_values}`.

This repo (`agents_setup`):

3. [`/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_tags.md`](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_tags.md) — add catalog row 281 `Restricted` (attempt-level, value-carrying). Refresh the catalog snapshot date.
4. [`/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_attempt_tags.md`](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_attempt_tags.md) — list `Restricted` among attempt-level tags.

No model-file join change. `optimizer_attempt_tags_pivot` is already joined `left_outer` / `many_to_one` on `attempt_id`.

## Looker gate

Edits to the two `.lkml` files need the chat proposal in [refactor_proposal.md](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/looker/references/refactor_proposal.md). Tier: new public field (additive). Existing tiles keep the same values.

No file write, push, or PR until the user replies `approve` / `yes` / `lgtm` / `ship it` / `looks good` to that proposal.

After merge, the user Pull + Deploy in Looker (handoff Block B in [manual_handoffs.md](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/looker/references/manual_handoffs.md)). The agent cannot deploy.

## Verification

Schema (already documented; re-confirm before proposing):

- `ota.optimizer_attempt_tags.value` (`varchar(255)`) — [`optimizer_attempt_tags.md`](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_attempt_tags.md)
- `ota.optimizer_tags.name` — [`optimizer_tags.md`](/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_tags.md)

Numeric, after deploy. Grain is **distinct attempts**, not contestant rows (the explore fans out one row per contestant). Date window is candidate `created_at`, same as the explore’s `date` filter.

1. Looker `query`: fields `attempt_restricted_values` + count distinct `attempt_id`, filters `date_date` = last 2 days and `attempt_restricted_values` is not null.
2. Matching MySQL (same 2-day window, timestamps as stored):

```sql
SELECT
    oat.value AS attempt_restricted_values,
    COUNT(DISTINCT oc.attempt_id) AS attempts
FROM ota.optimizer_candidates oc
JOIN ota.optimizer_attempt_tags oat ON oat.attempt_id = oc.attempt_id
JOIN ota.optimizer_tags ot ON ot.id = oat.tag_id
WHERE ot.name = 'Restricted'
  AND oc.created_at >= NOW() - INTERVAL 2 DAY
GROUP BY oat.value
ORDER BY attempts DESC;
```

3. Compare the value set and the per-value attempt counts. A few rows of drift is normal (in-flight inserts). A missing value or a large gap is a fail.

Existing dashboard 1642 tiles must keep the same numbers (additive field, unused by current tiles).

## Out of scope

- `Aborted` (id 291) and `FareIncreased` (id 301).
- Yes/no `Attempt Is Restricted`.
- Dashboard filter or tile on [1642](https://flighthub.looker.com/dashboards/1642).
- The older [Optimizer dashboard 1403](https://flighthub.looker.com/dashboards/1403) / `optimizer` model.
- Glossary change. `Restricted` is a tag name, not a new product surface.

## Rollback

Revert the LookML commit in `content_integration_optimizer`, then Pull + Deploy. Revert the catalog-doc commit in `agents_setup` separately. Existing tiles do not reference the new field, so rollback does not change dashboard numbers.
