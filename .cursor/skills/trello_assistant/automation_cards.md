# Automation cards (separate board)

When the user asks to add or file a card for **new Automation functionality** (any agent, automation, AI pipeline, internal tool to automate a workflow), put it on the **Content Integration - AI Automation** board, not the Content Integration board this skill otherwise targets.

| Item | ID |
|------|-----|
| Board **Content Integration - AI Automation** ([link](https://trello.com/b/pIpbeOvU/content-integration-ai-automation)) | `69eb6abd2401830e634500b8` |
| List **NEW** (default for new cards) | `69eb6b008e21e4b4960d8537` |

Use the **user-trello** MCP. `set_active_board` with the board ID above, then `add_card_to_list` on the **NEW** list.

## Card style

Keep it short and human-written. No `⊙` headings, no rigid templates, no AI footer. Write like a teammate filing a quick note. Skip the dedup pass and grooming machinery in [`SKILL.md`](./SKILL.md) — those rules apply to the Content Integration board only.

## Required sections

Three plain markdown headings, in this order:

```markdown
## Summary
One or two sentences: what the automation does and why we want it.

## Implementation plan
Three to six bullets. The actual steps, in plain language.

## Requirements
What needs to exist or be decided before we start (data, access, owners, dependencies).
```

If a section has nothing real to say, write one honest sentence ("No external dependencies." / "TBD — need to confirm with X.") rather than padding.
