# Looker projects registry

The agent only touches Looker projects / GitHub repos listed below. When the
user asks for changes to a project not in the table, stop and propose
adding it before doing any other work.

Each row is **one Looker project ↔ one GitHub repo**. Adding a new project
means adding the row in the same change as the work that introduces it.

## Active projects

| Name | GitHub repo | Looker project name | Connection | Owner | Purpose |
|------|-------------|---------------------|------------|-------|---------|
| `content_integration_optimizer` | [filmozolevskiy/content_integration_optimizer](https://github.com/filmozolevskiy/content_integration_optimizer) | `content_integration_optimizer` | `ota` | filmozolevskiy | Reference repo. Optimizer candidates / attempts / bookings analytics. Drives the `Content Integration Optimizer` model in Looker. |
| `looker_skill_smoketest_bookings` | [filmozolevskiy/looker_skill_smoketest_bookings](https://github.com/filmozolevskiy/looker_skill_smoketest_bookings) | `looker_skill_smoketest_bookings` | `ota` | filmozolevskiy | Verification project for this skill. Minimal LookML over `ota.bookings`. Used as the smoke test that the bootstrap subflow works end-to-end. Not a production dashboard. |

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
