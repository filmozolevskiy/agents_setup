# Manual handoffs — what the agent cannot do

The Looker MCP exposes read, query, and dashboard-authoring tools. It
does **not** expose:

- Creating a Looker project from a GitHub repo (admin UI step).
- Triggering "Pull from Production" / "Deploy to Production" on an
  external-git project.
- Validating LookML, granting model permissions, or assigning model
  sets to roles.
- Editing or deleting existing dashboard tiles / filters.

For every Looker operation the agent performs, classify what (if
anything) the human still needs to do, and end the reply with the
matching block below — verbatim, with the placeholders filled in. Do
not paraphrase. Users skim these blocks; consistent wording matters.

## Decision tree

```
Did this reply ...

  ... only call read tools (get_models, get_explores, query, ...)?
      → No handoff block. Just report findings.

  ... add or edit a dashboard / tile / filter via the MCP only,
      WITHOUT pushing any LookML?
      → Use Block A — "Refresh only".

  ... push LookML to an existing, already-connected project repo?
      → Use Block B — "Pull + Deploy".

  ... create a brand-new GitHub repo + initial LookML scaffold for a
      project that is NOT YET connected in Looker?
      → Use Block C — "Connect new project" (subsumes B).

If a single reply did several of these, use the strongest applicable
block (C > B > A) and add a one-line note about the dashboard work.
```

---

## Block A — Refresh only

Use when the only Looker change was via MCP authoring tools
(`make_dashboard`, `add_dashboard_filter`, `add_dashboard_element`,
`make_look`) and no `git push` happened on a project repo.

Fill in: `<dashboard_url>`.

> ## Your next step
>
> No Looker admin action needed — the change is live now.
>
> 1. Open the dashboard: <dashboard_url>
> 2. If you had it open already, hard-refresh (⌘⇧R / Ctrl⇧R) so the
>    new tiles / filters appear.
>
> Tell me once you see it and I'll move on.

---

## Block B — Pull + Deploy

Use when the agent pushed one or more commits to a project repo that
is **already connected** in Looker.

Fill in: `<project_name>`, `<commit_sha>`, `<one-line summary of what
the LookML change adds>`.

> ## Your next step
>
> External-git Looker projects do not auto-deploy. The new LookML is
> in GitHub but Looker has not pulled it yet, so any tile that depends
> on the new fields will show `LookML error` until you do this:
>
> 1. Looker → toggle **Develop Mode** on (top-right pencil icon).
> 2. Open the **`<project_name>`** project.
> 3. In the git toolbar at the top of the file editor, click
>    **Pull from Production** (or **Pull Latest** in older Looker
>    versions). It should fetch commit `<commit_sha>`.
> 4. Click **Validate LookML**. It must report **0 errors** — if it
>    does not, paste the error back to me, do not deploy.
> 5. Click **Deploy to Production**.
>
> What this change adds: <one-line summary>.
>
> Reply "deployed" and I will verify with `get_explores` /
> `get_measures` / `run_dashboard` and add any tiles that depend on
> the new fields.

---

## Block C — Connect new project

Use when the agent just created a new GitHub repo and pushed the
initial LookML scaffold for a project that does **not yet** exist in
Looker.

Fill in: `<project_name>`, `<repo_url>` (e.g.
`https://github.com/<owner>/<project_name>`), `<connection>` (e.g.
`ota`), `<initial_commit_sha>`.

> ## Your next step
>
> The GitHub repo is live but Looker does not know about it yet. The
> first connect is a one-time admin task; I cannot do it through the
> MCP.
>
> ### 1. Create the Looker project (one time)
>
> 1. Looker → **Develop → Manage LookML Projects → New LookML
>    Project**.
> 2. Name: **`<project_name>`** (this MUST match the repo name and
>    the model file basename — do not rename).
> 3. Starting Point: **Blank Project**.
> 4. Git Connection: **External Git Repository**.
> 5. Repository URL: `<repo_url>.git`.
> 6. Save.
>    - For a **public** repo over HTTPS, Looker may not prompt for a
>      deploy key — that is fine.
>    - For a **private** repo, Looker generates a deploy key. Add it
>      under `Settings → Deploy keys` on the GitHub repo with
>      **write** access, then paste it back into Looker's
>      **Configure Git**.
>
> ### 2. Pull the initial scaffold and deploy
>
> 1. Toggle **Develop Mode** on.
> 2. Open the **`<project_name>`** project.
> 3. Git toolbar → **Pull from Production**. Should fetch commit
>    `<initial_commit_sha>`.
> 4. **Validate LookML**. Must report **0 errors**.
> 5. **Deploy to Production**.
>
> ### 3. Permission the model (only if needed)
>
> If `<connection>` is on a Looker instance that gates models per
> role: Admin → Roles → add `<project_name>` to the model sets that
> should see it. If you are not sure, skip this step — you will
> notice if a `query` returns "no model permission" and we can add
> it then.
>
> ### 4. Confirm
>
> Reply "connected" once Step 2 is done. I will run `get_models`,
> `get_explores`, and a smoke `query` against the new explore to
> confirm Looker resolved the LookML and the connection actually
> pulls rows.

---

## Anti-patterns

- Closing a session with "all done" / "deployed" / "live" when the
  user has not actually done the pull+deploy. The agent has no MCP
  tool that triggers a deploy — saying "deployed" is a lie.
- Inventing a deploy command (`looker deploy`, REST `update_project`,
  etc.). It does not exist in this MCP; do not pretend otherwise.
- Pasting only a summary of what to do ("just pull and deploy") —
  always paste the full numbered block. Users skim; the steps and
  the validate-before-deploy gate are load-bearing.
- Assuming dashboard tiles will "fix themselves" once LookML is
  pushed. They will not — Looker must pull and deploy first, and
  then the tiles' next run picks up the new model.
