# lookml_project_skeleton

File-by-file scaffold for a new GitHub-backed Looker project. The Looker
agent skill (`.cursor/skills/looker/`) reads this directory, substitutes
placeholders, and pushes the result to a fresh repo via the GitHub MCP
`push_files` tool.

## Placeholders

| Token | Replaced with |
|-------|---------------|
| `__PROJECT_NAME__` | snake_case project name; matches GitHub repo, Looker project, model file, view file |
| `__CONNECTION__` | Looker connection name (e.g. `ota`) |
| `__SQL_TABLE_NAME__` | Fully-qualified table (e.g. `ota.bookings`) |
| `__OWNER__` | GitHub login of the owner |
| `__PURPOSE__` | One-line purpose for `README.md` |

## Files in the skeleton

- `models/__PROJECT_NAME__.model.lkml`
- `views/__PROJECT_NAME__.view.lkml`
- `.cursor/rules/lookml-best-practices.mdc`
- `.cursor/rules/lookml-standards.mdc`
- `.cursor/rules/lookml-view-standards.mdc`
- `.cursor/rules/lookml-sql-patterns.mdc`
- `.cursor/rules/project-structure.mdc`
- `.cursor/rules/git-workflow.mdc`
- `scripts/mysql_query.py`
- `scripts/README.md`
- `.env.example`
- `.gitignore`
- `requirements.txt`
- `README.md`

## What's NOT in the skeleton

- Anything Looker-instance-specific (folder IDs, dashboard IDs).
- A populated `.env` file. `.env` is ignored; only `.env.example` ships.
- LookML for tables other than `__SQL_TABLE_NAME__`. Add joins / extra
  views in follow-up commits, after the initial connection works.
- A pre-built dashboard. Dashboards live in Looker, not in LookML, and
  are created via the MCP after the project is connected.
