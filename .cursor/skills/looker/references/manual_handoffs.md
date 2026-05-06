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
matching block below — verbatim, with the placeholders filled in.

The blocks are written for a non-technical reader. Do not paraphrase
them into engineer-speak. The decision tree, intro, and anti-patterns
on this page are for the agent; everything inside the `>` blockquotes
is what the user actually sees, so it must read like instructions a
human would give a colleague over Slack — not like release notes.

When you fill in `<one-line summary>` placeholders, write the summary
the same way: in plain language, no LookML / SQL terms ("a new field
that shows the cancellation rate", not "a `type: number` measure with
`value_format_name: percent_2`"). If the change is invisible to the
user (e.g. a Tier 1 perf improvement), say so — "speed-up under the
hood; numbers on the dashboard will not change".

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

Fill in: `<dashboard_url>`, `<one-line summary of what changed>`.

> ## What you need to do next
>
> Nothing in Looker — the change is already live.
>
> 1. Open the dashboard: <dashboard_url>
> 2. If you had it open in another tab already, refresh the page
>    (Cmd-Shift-R on Mac, Ctrl-Shift-R on Windows) so the new view
>    loads.
>
> What's new: <one-line summary>.
>
> Just reply when you've had a look and I'll move on.

---

## Block B — Pull + Deploy

Use when the agent pushed one or more commits to a project repo that
is **already connected** in Looker.

Fill in: `<project_name>`, `<commit_sha>` (short hash is fine),
`<plain-english summary of what changed>`.

> ## What you need to do next
>
> I made changes in GitHub. Looker doesn't pick them up automatically —
> it needs you to load and turn them on. Should take about 30 seconds.
>
> 1. Open Looker.
> 2. In the top-right corner, turn on **Develop Mode** (the pencil
>    icon goes green).
> 3. Open the **`<project_name>`** project.
> 4. At the top of the project page, click **Pull from Production**
>    (sometimes labelled **Pull Latest**). This downloads the new
>    version from GitHub.
> 5. Click **Validate LookML**. This is a quick check for typos.
>    It should say "no errors". If it shows anything red, copy that
>    text and send it to me — **don't click Deploy yet**.
> 6. Click **Deploy to Production**. This makes the new version live.
>
> Before you reply, one quick sanity check (this catches the most
> common mix-up): in the project's git toolbar, the **production**
> line should now show the short hash `<commit_sha>`. If it still
> shows an older hash, the deploy didn't actually go through — usually
> because the dev branch was pushed but Deploy to Production wasn't
> clicked, or Validate LookML caught an error and you missed it.
>
> What's changing: <plain-english summary>.
>
> Reply "deployed" once the production hash matches `<commit_sha>` and
> I'll verify everything works the way it should.

---

## Block C — Connect new project

Use when the agent just created a new GitHub repo and pushed the
initial LookML scaffold for a project that does **not yet** exist in
Looker.

Fill in: `<project_name>`, `<repo_url>` (e.g.
`https://github.com/<owner>/<project_name>`), `<connection>` (e.g.
`ota`), `<initial_commit_sha>`.

> ## What you need to do next
>
> The GitHub repo is ready, but Looker doesn't know about it yet. The
> first time you connect a new project to Looker is a manual setup —
> I can't do it through the tools I have. Three short stages, ~5
> minutes the first time.
>
> ### Stage 1 — Create the Looker project (one-time setup)
>
> 1. In Looker, go to **Develop → Manage LookML Projects → New LookML
>    Project**.
> 2. **Name**: `<project_name>` exactly. (Don't rename it — the name
>    has to match the GitHub repo and the file inside it, otherwise
>    nothing connects.)
> 3. **Starting Point**: choose **Blank Project**.
> 4. **Git Connection**: choose **External Git Repository**.
> 5. **Repository URL**: paste `<repo_url>.git`.
> 6. Click **Save**.
>    - If the GitHub repo is **public**, Looker may just connect with
>      no extra prompt. That's fine.
>    - If it's **private**, Looker will generate a "deploy key". Copy
>      it, go to the GitHub repo → **Settings → Deploy keys → Add
>      deploy key**, paste it in, tick **Allow write access**, save.
>      Then go back to Looker's **Configure Git** screen and click
>      through to finish.
>
> ### Stage 2 — Load the starter files into Looker
>
> 1. Turn on **Develop Mode** (pencil icon, top-right).
> 2. Open the **`<project_name>`** project.
> 3. In the git toolbar at the top, click **Pull from Production**.
>    This pulls the starter files from GitHub. The production line
>    should then show the short hash `<initial_commit_sha>`.
> 4. Click **Validate LookML**. Should say "no errors". If it says
>    anything red, paste it back to me — don't deploy yet.
> 5. Click **Deploy to Production**.
>
> ### Stage 3 — Make sure people can see it (only sometimes needed)
>
> Some Looker instances restrict models by role. If, after deploy,
> you (or a colleague) try to use the new project and Looker says
> "no model permission":
>
> - Go to **Admin → Roles**.
> - Find the role(s) that should have access.
> - Add `<project_name>` to the role's model set.
>
> If you don't get that error, you can ignore this stage entirely.
>
> ### Stage 4 — Tell me you're done
>
> Reply "connected" once Stage 2 is finished. I'll then verify the
> project is registered in Looker, the explore resolves, and a quick
> sample query actually returns rows from the database. If anything
> is off, I'll surface it before going further.

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
