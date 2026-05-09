# Reporter — configured MCP servers

The `reporter` skill in this repo dispatches through the two MCP
servers below. Identifiers, tool names, and required env vars live
here so the skill itself stays generic and other agents can route
without re-discovering them every session.

| Channel | MCP server identifier | Where it lives | Reads its auth from |
|---------|----------------------|----------------|---------------------|
| Gmail   | `gmail` (in `.cursor/mcp.json`) | self-hosted: `scripts/mcp_gmail.sh` runs `npx -y @gongrzhe/server-gmail-autoauth-mcp` | `.env` (`GMAIL_OAUTH_KEYS_B64` + `GMAIL_CREDENTIALS_B64`, base64 of the two OAuth JSONs) |
| Slack   | `plugin-slack-slack`            | Cursor's Slack plugin (managed by Cursor's plugin system, not by this repo) | The plugin's own auth flow — call `mcp_auth` on the server once per machine, or use Cursor's plugin settings UI |

After the first successful send, the agent should record the actual
tool descriptor names — the discovery step in
[`SKILL.md`](./SKILL.md) § MCP servers points readers here, so this
file is the cache of "what worked last time."

## Gmail

### Package

[`@gongrzhe/server-gmail-autoauth-mcp`](https://www.npmjs.com/package/@gongrzhe/server-gmail-autoauth-mcp)
(repository: [`GongRzhe/Gmail-MCP-Server`](https://github.com/GongRzhe/Gmail-MCP-Server)).
Picked because it ships its own OAuth flow as a one-off subcommand
(`auth`) and runs over stdio out of the box. The upstream repo went
read-only mid-2025 but the package on npm still installs and
authenticates against current Gmail APIs; revisit if Google's official
Workspace MCP graduates from developer preview.

### Credentials live in `.env` only

Repo policy: every MCP credential goes in `.env` (gitignored); nothing
under `~/`. The wrapper [`scripts/mcp_gmail.sh`](./scripts/mcp_gmail.sh)
honours that — it materialises the two OAuth JSON blobs (`GMAIL_OAUTH_KEYS_B64`
and `GMAIL_CREDENTIALS_B64`) into a per-process `mktemp` directory at
launch, points the upstream MCP at them via `GMAIL_OAUTH_PATH` /
`GMAIL_CREDENTIALS_PATH`, and `rm -rf`s the temp dir on exit. No
credentials touch `~/.gmail-mcp/` or any other persistent location.

### Send tool the reporter calls

`send_email` (also exposes `draft_email`, `read_email`, `search_emails`,
…). Argument names — verify against the descriptor on first run, then
record any variants here:

| Reporter input | Gmail MCP argument |
|----------------|-------------------|
| `recipient`    | `to` (string or array of strings) |
| `subject`      | `subject` |
| `body`         | `body` (plain text) or `htmlBody` (HTML) |
| `cc`           | `cc` |
| `bcc`          | `bcc` |

### One-time setup (the user runs these once per laptop)

1. **Create a Google Cloud project + OAuth client.**
   - Go to <https://console.cloud.google.com/>, create or pick a
     project.
   - Enable the Gmail API: *APIs & Services → Library → Gmail API →
     Enable*.
   - Create OAuth credentials: *APIs & Services → Credentials →
     Create Credentials → OAuth client ID*. Pick **Desktop app** for
     a personal laptop install, or **Web application** if you want
     to share the same client between machines (Web app needs
     `http://localhost:3000/oauth2callback` in *Authorized redirect
     URIs*).
   - Download the resulting JSON.
2. **Encode the OAuth client JSON and paste it into `.env`.**

   ```bash
   base64 -i ~/Downloads/client_secret_<id>.json | tr -d '\n'
   ```

   Add the output to `.env` as:

   ```ini
   GMAIL_OAUTH_KEYS_B64=<the long base64 string from above>
   ```

3. **Run the one-time browser flow via the wrapper.** The wrapper
   handles temp-file materialisation; you never touch `gcp-oauth.keys.json`
   on disk yourself.

   ```bash
   ./.cursor/skills/reporter/scripts/mcp_gmail.sh auth
   ```

   This opens the system browser, prompts for the Google account that
   will send the email, captures the resulting `credentials.json` from
   the temp dir, base64-encodes it, and prints a `GMAIL_CREDENTIALS_B64=…`
   line for you to paste into `.env`.

4. **Paste that line into `.env`.** Replace any existing
   `GMAIL_CREDENTIALS_B64=…` entry with the new value.

5. **Confirm the wrapper picks them up.** Either restart Cursor (so
   `.cursor/mcp.json` re-reads the `gmail` entry) or, in a terminal:

   ```bash
   ./.cursor/skills/reporter/scripts/mcp_gmail.sh </dev/null | head -1
   ```

   The script exits non-zero with a clear message if either env var
   is missing or fails to decode.

### Required env (in `.env`)

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `GMAIL_OAUTH_KEYS_B64`  | Yes | base64 of the OAuth client JSON downloaded from Google Cloud Console. |
| `GMAIL_CREDENTIALS_B64` | Yes (after first auth) | base64 of the `credentials.json` issued by the browser flow. The wrapper's `auth` subcommand prints the line for you. |

`.env.example` carries the canonical layout — do not invent extra
`GMAIL_*` vars here without updating that file at the same time. The
upstream package's `GMAIL_OAUTH_PATH` / `GMAIL_CREDENTIALS_PATH` env
vars are owned by the wrapper (it sets them to the per-process tmp
files); do not set them yourself.

### Re-auth

When the refresh token expires (rare) or you switch the sender Google
account, re-run `./.cursor/skills/reporter/scripts/mcp_gmail.sh auth`
and replace the `GMAIL_CREDENTIALS_B64=…` line in `.env`. The
`GMAIL_OAUTH_KEYS_B64` line stays put unless you rotate the OAuth
client itself.

## Slack

### Server

The Cursor Slack plugin: server identifier `plugin-slack-slack`. It is
managed by Cursor's plugin system, not by this repo — there is no
wrapper script under `scripts/`, no entry in `.cursor/mcp.json`, no
token in `.env`. The plugin handles its own OAuth (Slack workspace
install + scope grants) through the Cursor UI; the agent only sees a
stable MCP server once the user authenticates.

This was a deliberate switch away from a self-hosted
`slack-mcp-server` wrapper. The plugin owns the token lifecycle (issue,
rotate, revoke) and the scope set, which removes a class of failure
modes (`missing_scope` boot failures, manual reinstalls after every
scope change, `xoxp-` / `xoxe.xoxp-` shape confusion). Trade-off: this
repo does not control the plugin's tool surface — it discovers it.

### Send tool the reporter calls

**Discover at runtime, not from this file.** Until the plugin is
authenticated and its tool descriptors land under
`mcps/plugin-slack-slack/tools/*.json`, the only descriptor visible is
`mcp_auth`. After auth, list the descriptors and pin the send tool's
real name + arguments here.

Conventional names plugin-style Slack MCPs expose for posting messages
(check the descriptor):

- `post_message` / `chat_postMessage` / `send_message` — top-level send.
- `send_dm` — DM helper, when present.

Likely caller-input mapping (verify against the actual descriptor):

| Reporter input | Slack plugin argument (likely) |
|----------------|-------------------------------|
| `recipient`    | a channel ID (`C…`), DM ID (`D…`), pre-resolved user ID (`U…`), or `#channel-name` — the descriptor will spell out which it accepts |
| `body`         | `text` (mrkdwn) and / or `blocks` (Block Kit JSON) |
| `thread_ts`    | `thread_ts` |

**First-run procedure.** When the reporter first dispatches over Slack
in a new session:

1. List `mcps/plugin-slack-slack/tools/`.
2. Read the send-tool descriptor for the actual argument names.
3. Update this section in the same PR if the names disagree with the
   table above.

### One-time setup (the user runs this once per machine)

1. Install / enable the **Slack** plugin in Cursor (Settings → Plugins
   → Slack).
2. From any agent session that has the `plugin-slack-slack` server
   visible, call its `mcp_auth` tool with `{}` — Cursor pops the
   workspace install / scope-grant flow.
3. Approve the install in the browser. Cursor caches the auth; the
   `STATUS.md` for the server flips from "needs authentication" to
   ready, and additional tool descriptors appear under
   `mcps/plugin-slack-slack/tools/`.
4. There is nothing to put in `.env`.

### Required env (in `.env`)

None. The plugin owns its own auth.

If you find yourself reaching for `SLACK_MCP_*` env vars to make
something work, you are looking at the old self-hosted wrapper docs in
git history — that path is gone on purpose. Either re-authenticate the
plugin, or ask the user to.

## Smoke-test checklist (deferred)

Once both surfaces are green:

- Gmail: `GMAIL_OAUTH_KEYS_B64` + `GMAIL_CREDENTIALS_B64` set in
  `.env`, Cursor restarted so it spawns the `gmail` server.
- Slack: the Cursor Slack plugin is authenticated (`plugin-slack-slack`
  exposes more than just `mcp_auth`).

Drive the `reporter` skill end to end and record the proofs on Trello
card [VRYfNyBs](https://trello.com/c/VRYfNyBs):

1. Send one Gmail to Filipp's literal email; capture the message ID.
2. Send one Slack DM to Filipp's user ID; capture the `ts`.
3. Paste both onto the card's closing comment.
4. If the descriptor argument names differed from the tables above,
   correct this file in the same PR.
