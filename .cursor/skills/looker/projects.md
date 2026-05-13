# Looker projects registry

The agent only touches Looker projects / GitHub repos listed below. When the
user asks for changes to a project not in the table, stop and propose
adding it before doing any other work.

Each row is **one Looker project ↔ one GitHub repo**. Adding a new project
means adding the row in the same change as the work that introduces it.

## Testing changes to this skill

Use **`looker_skill_smoketest_bookings`** as the test bed for any change
to this skill — new bootstrap-subflow steps, edits to
`references/lookml_best_practices.md`, new manual-handoff blocks, etc.
It is the only project in the registry whose explicit purpose is
"break-things-and-find-out", so:

- Push experimental LookML there, not into a production project.
- Exercise dashboard-edit changes on dashboard **1742**
  ("Looker skill smoketest — Bookings"); revert tile additions you do
  not want to keep.
- The data layer is `ota.bookings`, which is documented under
  `.cursor/skills/db_access/db-docs/mysql/bookings.md`, so numeric
  cross-checks are cheap.

If a change to the skill fundamentally cannot be exercised on this
project (e.g. a feature that only matters for ClickHouse-backed
projects), say so explicitly and propose a separate smoke-test project
before merging.

## Connection constraints

| Connection | Write-capable? | Notes |
|------------|---------------|-------|
| `ota` | **No** | Looker service account is read-only. Confirmed 2026-05-11: no scratch/PDT schema exists on the MySQL instance. `aggregate_table:` PDTs and warehouse-side materialization are both unavailable. Use `persist_with:` (Tier 1 B) as the only viable caching layer. |
| `ota_phoenix` | Unknown | Not yet verified. Run the scratch-schema check before proposing Tier 1 A on `ota_phoenix`-backed explores. |
| `clickhouse-jupiter` | Unknown | Not yet verified. |
| `clickhouse-prod` | Unknown | Not yet verified. Used by `content_integration_-fare_family` (`fare_family` model). Run the scratch-schema check before proposing Tier 1 A on `clickhouse-prod`-backed explores. |

## Active projects

The **GitHub repo basename** and the **Looker project name** are equal
in newly-bootstrapped projects (this skill enforces the rule). For
projects that pre-date the skill the two can drift; both columns are
listed so the agent can navigate either way.

| Name | GitHub repo | Looker project name | Connection | Owner | Purpose |
|------|-------------|---------------------|------------|-------|---------|
| `content_integration_optimizer` | [filmozolevskiy/content_integration_optimizer](https://github.com/filmozolevskiy/content_integration_optimizer) | `content_integration_optimizer` | `ota` | filmozolevskiy | Reference repo for this skill. Optimizer candidates / attempts / bookings analytics. Drives the `Content Integration Optimizer` model in Looker. |
| `looker_skill_smoketest_bookings` | [filmozolevskiy/looker_skill_smoketest_bookings](https://github.com/filmozolevskiy/looker_skill_smoketest_bookings) | `looker_skill_smoketest_bookings` | `ota` | filmozolevskiy | Verification project for this skill. Minimal LookML over `ota.bookings`. Used as the smoke test that the bootstrap subflow works end-to-end. Not a production dashboard. |
| `Optimizer_looker` | [filmozolevskiy/Optimizer_looker](https://github.com/filmozolevskiy/Optimizer_looker) | `optimizer` | `ota` | filmozolevskiy | Optimizer analytics (production). Single model `optimizer`. Repo and Looker project name disagree — repo is `Optimizer_looker`, project is `optimizer`. |
| `looker_tracking_system` | [filmozolevskiy/looker_tracking_system](https://github.com/filmozolevskiy/looker_tracking_system) | `tracking` | `ota` | filmozolevskiy | Tracking / event analytics. Single model `tracking`. |
| `Sherlok_Looker` | [filmozolevskiy/Sherlok_Looker](https://github.com/filmozolevskiy/Sherlok_Looker) | `sherlok` | `clickhouse-jupiter` | filmozolevskiy | Sherlock investigation logs. Single model `sherlok_project` (model name does not match project name; pre-skill convention). |
| `looker_allert_system` | [filmozolevskiy/looker_allert_system](https://github.com/filmozolevskiy/looker_allert_system) | `bookability_allert_system` | `ota`, `ota_phoenix` | filmozolevskiy | Bookability + search alert system. Multi-model: `alerting`, `search`, `bookability_alert`, `search_alert`. "allert" typo is intentional (preserved from original Looker project name). |
| `content_integration_cancellation` | [filmozolevskiy/content_integration_cancellation](https://github.com/filmozolevskiy/content_integration_cancellation) | `cancellation` | multiple (default-all) | filmozolevskiy | Cancellation analytics. Single model `cancellation`. Looker project is currently bound to every connection on the instance — narrow before adding new explores. |
| `route_limiter_XP` | [filmozolevskiy/route_limiter_XP](https://github.com/filmozolevskiy/route_limiter_XP) | `route_limiter_xp` | `ota_phoenix` | filmozolevskiy | Route-limiter experiment analytics. Single model `route_limiter_xp`. |
| `content_integration_search` | [filmozolevskiy/content_integration_search](https://github.com/filmozolevskiy/content_integration_search) | `content_integration_search` | `ota_phoenix` | filmozolevskiy | Search analytics for Content Integration. Single model `content_integration_search`. |
| `content_integration_manual_tasks_visibility` | [filmozolevskiy/content_integration_manual_tasks_visibility](https://github.com/filmozolevskiy/content_integration_manual_tasks_visibility) | `content_integration_manual_tasks_vivibility` | `ota` | filmozolevskiy | Visibility into manual ops tasks. Single model `content_integration_manual_tasks_vivibility`. NOTE: the model file basename has a `vivibility` typo (preserved from the live Looker project name); the repo name is spelled correctly. |
| `content_integration_jupiter_logs` | [filmozolevskiy/content_integration_jupiter_logs](https://github.com/filmozolevskiy/content_integration_jupiter_logs) | `jupiter` | `clickhouse-jupiter` | filmozolevskiy | Looker visibility for the Jupiter project. Repo backs the Looker `jupiter` project (file: `models/jupiter_tags.model.lkml`). Looker [folder 547](https://flighthub.looker.com/folders/547). `get_models` exposes `jupiter` + `ci_jupiter_logs` models on this project to the MCP role; `jupiter_tags` may be gated by role / not have an explore yet. |
| `content_integration_alert_system` | [filmozolevskiy/content_integration_alert_system](https://github.com/filmozolevskiy/content_integration_alert_system) | `contente_itegration_alert` | `ota_phoenix` | filmozolevskiy | Content-Integration alerting block (Datatonic-style anomaly detection on top of `ota_phoenix`). Single model `content_itegration_alert`. Looker [folder 479](https://flighthub.looker.com/folders/479). Looker project name preserves the `contente_itegration_alert` double-typo (one `n` missing in `contente` and `itegration`); do not "fix" it — every dashboard tile keys off this name. Distinct from `looker_allert_system` / `bookability_allert_system` above. |
| `content_integration_-fare_family` | [filmozolevskiy/content_integration_-fare_family](https://github.com/filmozolevskiy/content_integration_-fare_family) | `fare_family` | `clickhouse-prod`, `ota` | filmozolevskiy | Fare family analytics ([Looker dashboard 1518](https://flighthub.looker.com/dashboards/1518)). Migrated from an external company-git repo to this user-owned GitHub repo via a two-parent merge commit bridging the orphan `master` (Looker bootstrap) and dev branch histories (master tip `079fe6c3`, 2026-05-12). Multi-model: `fare_family` on `clickhouse-prod`, `mysql_model` on `ota`. Repo name has a stray `_-` between `integration` and `fare_family`; preserved as-is because GitHub URL is already wired into Looker's Configure Git — do not "fix" without explicit ask. Note: `get_models` still returns a third model `fara_family` on `clickhouse-prod` — confirmed 2026-05-12 to be a stale duplicate held only in Looker's in-memory production state, intentionally not ported. It drops cleanly at the first Pull+Deploy from this repo; do not re-add it. |

## Adding a new project

1. Pick a short, snake_case name. The Looker project name, the GitHub repo
   name, and the registry entry should match.
2. Stand up the repo via the bootstrap subflow
   (`references/bootstrap_lookml_repo.md`).
3. Add a row above with: name, repo URL, Looker project name, connection,
   owner, one-sentence purpose.
4. Open the PR. Keep registry edits in the same PR as the bootstrap so a
   reviewer sees both legs.

## Removing / archiving a project

- Move the row to an `## Archived projects` section at the bottom of this
  file (do not silently delete).
- Note the date and reason in one short line.
- The agent must refuse work on archived entries until the user re-activates
  them explicitly.
