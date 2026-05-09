# Reporter — configured MCP servers

The `reporter` skill in this repo dispatches through one MCP server.
Identifier, tool names, and auth model live here so the skill itself
stays generic and other agents can route without re-discovering them
every session.

| Channel | MCP server identifier | Where it lives | Reads its auth from |
|---------|----------------------|----------------|---------------------|
| Slack   | `plugin-slack-slack` | Cursor's Slack plugin (managed by Cursor's plugin system, not by this repo) | The plugin's own auth flow — call `mcp_auth` on the server once per machine, or use Cursor's plugin settings UI. |

Gmail was originally on the roadmap for this skill but was dropped on
[VRYfNyBs](https://trello.com/c/VRYfNyBs) — sender Gmail access is not
currently available. If a Gmail surface is needed later, file a new
card and re-add the channel here; the skill's interface (`channel`,
`recipient`, `subject`, `body`) is already shaped to accept it.

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

## Smoke-test checklist (deferred)

Once the Cursor Slack plugin is authenticated (`plugin-slack-slack`
exposes more than just `mcp_auth`), drive the `reporter` skill end to
end and record the proofs on Trello card
[VRYfNyBs](https://trello.com/c/VRYfNyBs):

1. Send one Slack DM to Filipp's user ID; capture the `ts`.
2. Paste it onto the card's closing comment.
3. If the descriptor argument names differed from the table above,
   correct this file in the same PR.
