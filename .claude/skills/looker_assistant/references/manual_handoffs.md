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

## Required Links block (paste before every handoff block)

Every reply that asks the user to take an action — merge a PR, pull
and deploy in Looker, add a deploy key, grant a model role, refresh
a dashboard — MUST start its "Your next step" section with the
Links block below. Reason: the user shouldn't have to scroll back
to find URLs to act on. One-click access, every time.

The block is rendered as a bulleted list (not a code block), so each
URL is clickable in the chat UI. Omit lines that genuinely don't
apply (e.g. no source card for a self-initiated cleanup) — but never
silently skip a line that does apply. If you don't know a URL, ask;
don't ship the handoff without it.

> **Links**
>
> - **PR / commit**: `<pull request URL>` (or `<commit URL>` if no PR)
> - **GitHub repo**: `<https://github.com/<owner>/<repo>>`
> - **Looker project**: `<https://flighthub.looker.com/projects/<project_name>>`
> - **Explore**: `<https://flighthub.looker.com/explore/<model>/<explore>>` (only if the change affects a specific explore)
> - **Affected dashboard(s)**: `<https://flighthub.looker.com/dashboards/<id>>` (one bullet per dashboard; omit the line if none)
> - **Looker folder**: `<https://flighthub.looker.com/folders/<id>>` (when the work touches a specific folder, e.g. a new project's home folder)
> - **Source**: `<Trello card URL>` / `<genesis PR URL>` / `<Slack thread link>` / `<Notion page URL>` (whichever triggered the work; omit the line only if the work was self-initiated)

**Rules of thumb:**

- Always paste the **full URL**, not a label. The chat UI renders
  raw URLs as clickable links; a bare project name does not click.
- The same Links block goes at the **top** of Blocks A, B, and C
  below. Do not split links between sections.
- When the work spans two repos (e.g. a LookML repo PR plus an
  `agents_setup` catalog commit), add a second "PR / commit"
  bullet — one line per linked artefact.

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

Fill in: `<dashboard_url>`, `<one-line summary of what changed>`,
plus every link in the Links block above.

> ## What you need to do next
>
> **Links**
>
> - **Affected dashboard**: `<dashboard_url>`
> - **Looker folder**: `<folder_url>` *(only if relevant)*
> - **Source**: `<Trello / Slack / Notion link>` *(omit if self-initiated)*
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
`<plain-english summary of what changed>`, plus every link in the
Links block.

> ## What you need to do next
>
> **Links**
>
> - **PR**: `<pull request URL>` (or commit URL if no PR)
> - **GitHub repo**: `<https://github.com/<owner>/<repo>>`
> - **Looker project**: `<https://flighthub.looker.com/projects/<project_name>>`
> - **Explore**: `<https://flighthub.looker.com/explore/<model>/<explore>>` *(only if the change affects a specific explore)*
> - **Affected dashboard(s)**: `<https://flighthub.looker.com/dashboards/<id>>` *(one bullet per dashboard; omit the line if none)*
> - **Source**: `<Trello card / genesis PR / Slack thread / Notion page>` *(omit if self-initiated)*
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
`ota`), `<initial_commit_sha>`, `<repo_default_branch>` (the repo's
real default branch, e.g. `main`), plus every link in the Links block.

> ## What you need to do next
>
> **Links**
>
> - **GitHub repo**: `<repo_url>`
> - **Initial commit**: `<repo_url>/commit/<initial_commit_sha>`
> - **Looker (Develop → Manage LookML Projects)**: `https://flighthub.looker.com/projects`
> - **Source**: `<Trello card / Notion page / Slack thread>` *(omit if self-initiated)*
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
> 7. **Check the production branch name matches the repo.** Open the
>    project's **Settings → Configuration** and look at **Git
>    Production Branch Name**. Looker often defaults this to `master`,
>    but new GitHub repos use `main`. If they differ, set it to the
>    repo's real default branch (`main` here: `<repo_default_branch>`),
>    click **Save**. Getting this wrong is the #1 silent failure:
>    production serves an empty/nonexistent branch, so non-dev users
>    and the API/MCP account get **"Model is not configured"** while
>    your own Develop Mode looks fine (dev reads the real branch).
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
- Shipping a handoff block without the Links block on top. The
  user should never need to scroll up to find the PR, the repo, the
  Looker project, or the affected dashboard — every URL the action
  needs is at the top of the handoff, as a bulleted list of full
  URLs (not labels). Omit only lines that genuinely don't apply;
  never silently skip a line because the URL is inconvenient to
  fetch — ask for it instead.
- Naming an artefact without linking it. "Open the
  `content_integration_optimizer` project in Looker" is wrong;
  "Open `https://flighthub.looker.com/projects/content_integration_optimizer`"
  is right. Same rule for repos, dashboards, folders, Trello cards,
  genesis PRs, and Notion pages.
- Diagnosing "Model is not configured" / 404 as a model-set
  permission problem when it is really a **production branch
  mismatch**. Symptom pattern: Develop Mode works for the agent's
  owner, but non-dev users and the MCP/API account 404 on the
  explore, and `get_explores` fails while the LookML is valid and
  pushed. Root cause is almost always Looker's **Git Production
  Branch Name** pointing at a branch that does not exist in the repo
  (`master` vs `main`). Fix: Project **Settings → Configuration →
  Git Production Branch Name** = the repo's real default branch,
  Save, then **Deploy to Production**. Confirmed on
  `content_integration_booking_rules_shadow`, 2026-08-11.
