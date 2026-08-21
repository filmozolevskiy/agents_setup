# Restricted tag dimension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose **Attempt Restricted Values** on the New Optimizer explore so Diego can group and filter by the Restricted reason text.

**Architecture:** Add one `GROUP_CONCAT` column to the existing attempt-tag pivot. Surface it as a public string dimension on the main view. Update catalog docs in `agents_setup`. No dashboard tile or filter.

**Tech Stack:** LookML in [filmozolevskiy/content_integration_optimizer](https://github.com/filmozolevskiy/content_integration_optimizer). Verification via Looker MCP `query` vs `.cursor/skills/db_access/scripts/mysql_query.py`. Spec: [`.cursor/skills/looker/docs/2026-08-13-restricted-tag-dimension-design.md`](./2026-08-13-restricted-tag-dimension-design.md).

## Global Constraints

- Join by `ota.optimizer_tags.name = 'Restricted'`. Never hardcode id 281.
- Do not add a yes/no flag, dashboard filter, or tile on [1642](https://flighthub.looker.com/dashboards/1642).
- Do not touch `Aborted` or `FareIncreased`.
- Do not edit `GLOSSARY.md`.
- Looker `.lkml` edits go through a PR on `content_integration_optimizer`. User Pull + Deploy after merge.
- Do not commit `agents_setup` unless the user asks.

---

### Task 1: Pivot column + hidden dimension

**Files:**
- Modify: `/tmp/content_integration_optimizer/views/optimizer_attempt_tags_pivot.view.lkml`

**Interfaces:**
- Consumes: existing `{% condition %}` push-down and `STRAIGHT_JOIN` pattern
- Produces: hidden `attempt_restricted_values` string on `optimizer_attempt_tags_pivot`

- [x] **Step 1: Baseline MySQL** (field does not exist in Looker yet)

```bash
set -a && source .env && set +a
python3 .cursor/skills/db_access/scripts/mysql_query.py query "
SELECT oat.value AS attempt_restricted_values, COUNT(DISTINCT oc.attempt_id) AS attempts
FROM ota.optimizer_candidates oc
JOIN ota.optimizer_attempt_tags oat ON oat.attempt_id = oc.attempt_id
JOIN ota.optimizer_tags ot ON ot.id = oat.tag_id
WHERE ot.name = 'Restricted'
  AND oc.created_at >= NOW() - INTERVAL 2 DAY
GROUP BY oat.value
ORDER BY attempts DESC;
"
```

Expected: the 8 Restricted reason strings with attempt counts.

- [x] **Step 2: Add the GROUP_CONCAT and hidden dimension**

After the Filtered `GROUP_CONCAT` line:

```lkml
        GROUP_CONCAT(DISTINCT CASE WHEN ot.name = 'Restricted' THEN oat.value END ORDER BY oat.value SEPARATOR ', ') AS attempt_restricted_values,
```

After `dimension: attempt_filtered_values`:

```lkml
  dimension: attempt_restricted_values   { type: string     sql: ${TABLE}.attempt_restricted_values   ;; hidden: yes }
```

- [x] **Step 3: Confirm the pivot SQL still joins catalog by `ot.name`, not `ot.id`.**

---

### Task 2: Public dimension on the main view

**Files:**
- Modify: `/tmp/content_integration_optimizer/views/content_integration_optimizer.view.lkml`

**Interfaces:**
- Consumes: `optimizer_attempt_tags_pivot.attempt_restricted_values`
- Produces: public `content_integration_optimizer.attempt_restricted_values`

- [x] **Step 1: Insert after `attempt_filtered_values`:**

```lkml
  dimension: attempt_restricted_values {
    type: string
    sql: ${optimizer_attempt_tags_pivot.attempt_restricted_values} ;;
    group_label: "4. TAGS"
    label: "Attempt Restricted Values"
    description: "Comma-separated values of any Restricted tags on the ATTEMPT (e.g. 'Fare increase detected', 'dida baggage selections will disable optimization'). Source: ota.optimizer_attempt_tags joined to ota.optimizer_tags on name='Restricted'. NULL when the attempt has no Restricted tag. Propagates to every contestant of the attempt."
  }
```

---

### Task 3: Catalog docs in agents_setup

**Files:**
- Modify: `/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_tags.md`
- Modify: `/Users/filippmozolevskiy/Repositories/agents_setup/.cursor/skills/db_access/db-docs/mysql/optimizer_attempt_tags.md`

**Interfaces:**
- Consumes: catalog query `SELECT id, name FROM ota.optimizer_tags WHERE name = 'Restricted'`
- Produces: documented attempt-level value-carrying tag `Restricted` (id 281)

- [x] **Step 1: Add catalog row 281 and bump snapshot date to 2026-08-14.**
- [x] **Step 2: List `Restricted` among attempt-level tags in `optimizer_attempt_tags.md`.**

---

### Task 4: PR + Looker handoff

**Files:** none in agents_setup

- [x] **Step 1: Branch `add-restricted-attempt-tag` from `master`, commit, push, open PR.** ([PR #8](https://github.com/filmozolevskiy/content_integration_optimizer/pull/8), commit `6a6dc90`)
- [ ] **Step 2: After the user merges and Pull + Deploys, run Looker `query`:**

```
model: content_integration_optimizer
explore: content_integration_optimizer
fields: [content_integration_optimizer.attempt_restricted_values, content_integration_optimizer.attempts_count]
filters: { content_integration_optimizer.date_date: "2 days", content_integration_optimizer.attempt_restricted_values: "-NULL" }
```

Compare value set and attempt counts to the Task 1 SQL. A few rows of drift is normal. A missing value is a fail.
