# Bootstrap a new GitHub-backed LookML project

End-to-end procedure for spinning up a new Looker project, backed by its
own GitHub repository, registered in `projects.md`, and ready for a
Looker admin to connect via "New LookML Project → Bare → from existing
repo".

## Inputs you need from the user

- **`<project_name>`** — short, snake_case. Will be used for the GitHub
  repo name, the Looker project name, the model file name, and the view
  file name. They all match.
- **Database / connection** — pick a connection that already exists on
  the Looker instance (run `get_models`, look at the `connections` field
  on existing projects). If the connection does not exist yet, stop —
  that is a Looker admin task.
- **Tables / collections / explores in scope** — start with one. Multi-
  table projects come later.
- **Owner** — username of the person responsible for the project.

## Step 1 — Discover the connection

```text
get_models  → look for a model on the same connection family as the
              user's data. Note `connections: ["ota"]` (or similar).
```

If the user names a connection that does not appear in `get_models`,
stop and ask for confirmation — agents do not create Looker connections.

## Step 2 — Sketch the LookML before pushing

Write the model + view files locally first (in this agent-setup repo's
working tree under `/tmp/<project_name>/` or a similar scratch
location), then iterate. Key decisions:

- `sql_table_name` — fully-qualified `<db>.<table>`.
- Primary key — pick one column, declare `primary_key: yes`, mark
  `hidden: yes`.
- One `dimension_group: date` for the obvious time column.
- A handful of dimensions (3–8) covering the columns the user actually
  wants to slice by.
- A few measures — `count` (always), `count_distinct` on the primary
  key, plus one or two domain-specific sums or ratios.

If you don't know what the columns are, run `table_analysis` first —
the smoke test for this skill is on `ota.bookings`, which already has
docs at `.cursor/skills/db_access/db-docs/mysql/bookings.md`.

## Step 3 — Create the GitHub repo via the GitHub MCP

Tool: `create_repository` on `user-GitHub` MCP.

```json
{
  "name": "<project_name>",
  "description": "Looker project: <one-line purpose>",
  "private": false,
  "autoInit": false
}
```

`autoInit: false` is deliberate — the next step writes the initial
commit. An auto-init README would force a merge later.

The repo is created under the authenticated user (or org). The owner
shown in `projects.md` matches the GitHub login.

## Step 4 — Push the initial scaffold via `push_files`

Tool: `push_files` on `user-GitHub` MCP.

Files come from
[`../templates/lookml_project_skeleton/`](../templates/lookml_project_skeleton/).
Substitute these placeholders before pushing:

| Placeholder | Substitute with |
|-------------|-----------------|
| `__PROJECT_NAME__` | `<project_name>` |
| `__CONNECTION__` | Looker connection name (e.g. `ota`) |
| `__SQL_TABLE_NAME__` | Fully-qualified `<db>.<table>` |
| `__OWNER__` | GitHub login of the owner |
| `__PURPOSE__` | One-line purpose for the README |

Push everything in one commit with a message like
`Initial LookML scaffold for <project_name>`.

The skeleton already includes:

- `models/__PROJECT_NAME__.model.lkml`
- `views/__PROJECT_NAME__.view.lkml`
- `.cursor/rules/lookml-standards.mdc`,
  `.cursor/rules/lookml-view-standards.mdc`,
  `.cursor/rules/lookml-sql-patterns.mdc`,
  `.cursor/rules/lookml-best-practices.mdc`,
  `.cursor/rules/project-structure.mdc`,
  `.cursor/rules/git-workflow.mdc`
- `scripts/mysql_query.py`, `scripts/README.md`
- `.env.example`, `.gitignore`, `README.md`, `requirements.txt`

## Step 5 — Register in `projects.md`

Add a row to `.cursor/skills/looker/projects.md` with name, repo URL,
Looker project name (= `<project_name>`), connection, owner, purpose.

## Step 6 — Hand off Looker connection to a human admin

The MCP cannot create a Looker project from a GitHub repo. Tell the
user, in the closing PR comment, what the admin needs to do:

1. Looker → **Develop → Manage LookML Projects → New LookML Project**.
2. Name: `<project_name>`. Starting Point: **Blank Project** with
   **Git Connection: External Git Repository**.
3. Repository URL: `https://github.com/<owner>/<project_name>.git`.
4. Save → Looker generates a deploy key. Add it under
   `Settings → Deploy keys` on the GitHub repo, with write access.
5. Looker → **Configure Git** → enter the deploy key → connect.
6. Pull latest → confirm the model and view show up in **Develop**.

Do not pretend the agent did this; it didn't.

## Step 7 — Smoke test once the admin has connected the repo

When the admin reports the project is connected:

1. `get_models` → confirm the new model is listed.
2. `get_explores` (`model: <project_name>`) → confirm the explore.
3. `get_dimensions` / `get_measures` → confirm fields show up.
4. `query` → run one of the count measures, e.g.

   ```json
   {
     "model": "<project_name>",
     "explore": "<project_name>",
     "fields": ["<view>.<count_measure>"],
     "limit": 1
   }
   ```

   Cross-check the returned number against
   `python3 scripts/mysql_query.py query "SELECT COUNT(*) FROM <db>.<table> ..."`
   inside the project repo (or the agent-setup `scripts/`).
5. If the numbers diverge, do not silently fix the LookML — surface the
   diff to the user.

## Step 8 — Build the first dashboard

See [`dashboards_and_tiles.md`](./dashboards_and_tiles.md). The
verification project (`looker_skill_smoketest_bookings`) is the
worked example.
