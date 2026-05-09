# Reporter — configured MCP servers

The `reporter` skill in this repo dispatches through the two MCP
servers below. Identifiers, tool names, and required env vars live
here so the skill itself stays generic and other agents can route
without re-discovering them every session.

| Channel | MCP server identifier (in `.cursor/mcp.json`) | Send tool | Reads its env from |
|---------|----------------------------------------------|-----------|--------------------|
| Gmail   | `gmail`                                      | `send_email` | `.env` (`GMAIL_OAUTH_KEYS_B64` + `GMAIL_CREDENTIALS_B64`, base64 of the two OAuth JSONs) |
| Slack   | `slack`                                      | `conversations_add_message` | `.env` (`SLACK_MCP_*` vars) |

The wrapper scripts launched by Cursor:

- Gmail: [`scripts/mcp_gmail.sh`](./scripts/mcp_gmail.sh) — runs
  `npx -y @gongrzhe/server-gmail-autoauth-mcp`.
- Slack: [`scripts/mcp_slack.sh`](./scripts/mcp_slack.sh) — runs
  `npx -y slack-mcp-server@latest --transport stdio`.

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

### Package

[`slack-mcp-server`](https://www.npmjs.com/package/slack-mcp-server)
(repository: [`korotovsky/slack-mcp-server`](https://github.com/korotovsky/slack-mcp-server)).
Picked because it is the actively-maintained successor to the
deprecated `@modelcontextprotocol/server-slack`, supports both bot
(`xoxb-`) and user OAuth (`xoxp-`) tokens, and gates the write tool
behind an explicit env var (safer default than always-on posting).

### Send tool the reporter calls

`conversations_add_message`. Off by default — the wrapper sets
`SLACK_MCP_ADD_MESSAGE_TOOL=true` so the tool is registered. Argument
names — verify against the descriptor on first run:

| Reporter input | Slack MCP argument |
|----------------|--------------------|
| `recipient`    | `channel_id` (channel `C…`, DM `D…`, or pre-resolved user `U…`) |
| `body`         | `payload` (mrkdwn text) |
| `thread_ts`    | `thread_ts` |

The reporter does not look users up by display name; it passes the
literal Slack ID. Use `channels_list` (read-only, registered by
default) to discover IDs once and cache them in the caller, not in
this file.

### One-time setup (the user runs these once)

1. **Pick or create a Slack app.** Go to
   <https://api.slack.com/apps>, *Create New App → From scratch*, name
   it (e.g. `agents-setup-reporter`), pick the workspace.
2. **Add OAuth scopes** under *OAuth & Permissions*:
   - **Bot token scopes (`xoxb-`):** `chat:write`,
     `chat:write.public` (post into channels the bot is not a member
     of), `im:write` (open / DM), `users:read` (resolve `@handle` →
     `U…` if needed).
   - **User token scopes (`xoxp-`)**, if you want the message to come
     from a real user account: `chat:write`, `im:write`.
3. **Install to workspace.** Same screen → *Install to workspace* →
   approve. Copy the resulting `xoxb-…` (Bot User OAuth Token) and / or
   `xoxp-…` (User OAuth Token).
4. **Put the token in `.env`.** Pick one (xoxp recommended for human-
   looking sends; xoxb if a bot identity is fine):

   ```ini
   SLACK_MCP_XOXP_TOKEN=xoxp-...
   # or
   SLACK_MCP_XOXB_TOKEN=xoxb-...
   ```

   Optional — restrict posting to specific channels:

   ```ini
   SLACK_MCP_ADD_MESSAGE_TOOL=C0123456789,C9876543210
   ```

5. **Confirm the wrapper picks it up.** Either restart Cursor or run:

   ```bash
   ./.cursor/skills/reporter/scripts/mcp_slack.sh </dev/null | head -1
   ```

   The script exits non-zero with a clear message if no token is set.

### Required env (in `.env`)

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `SLACK_MCP_XOXP_TOKEN` | one of these | User OAuth token (recommended). |
| `SLACK_MCP_XOXB_TOKEN` | one of these | Bot token. Limited to channels the bot is a member of. |
| `SLACK_MCP_XOXC_TOKEN` + `SLACK_MCP_XOXD_TOKEN` | one of these | Browser-extracted tokens (last-resort; only if no app install is possible). |
| `SLACK_MCP_ADD_MESSAGE_TOOL` | optional | Wrapper defaults this to `true`. Set to a comma-separated channel list to restrict. |

`.env.example` carries the canonical layout — do not invent extra
`SLACK_*` vars here without updating that file at the same time.

## Smoke-test checklist (deferred)

Once both setup blocks above are green (the four env vars in `.env`:
`GMAIL_OAUTH_KEYS_B64`, `GMAIL_CREDENTIALS_B64`, one of the
`SLACK_MCP_XOX*` tokens, and a Cursor restart), drive the `reporter`
skill end to end and record the proofs on Trello card
[VRYfNyBs](https://trello.com/c/VRYfNyBs):

1. Send one Gmail to Filipp's literal email; capture the message ID.
2. Send one Slack DM to Filipp's user ID; capture the `ts`.
3. Paste both onto the card's closing comment.
4. If the descriptor argument names differed from the tables above,
   correct this file in the same PR.
