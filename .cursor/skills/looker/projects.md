# Looker projects registry

The agent only touches Looker projects / GitHub repos listed below. When the
user asks for changes to a project not in the table, stop and propose
adding it before doing any other work.

Each row is **one Looker project ↔ one GitHub repo**. Adding a new project
means adding the row in the same change as the work that introduces it.

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
