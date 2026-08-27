# Split and group — Content Integration cards

Break big work into independent cards. Group siblings with the **Project** custom field and `⊙ Similar / relevant cards`. **Never create a parent / epic / tracker card.**

This file is for the **Content Integration** board only. Automation parent/child rules in [`../automation_cards.md`](../automation_cards.md) stay as they are.

## Investigation before create (mandatory)

Investigation is session work. It is not a Trello card.

Do not call `add_card_to_list` until all of these are true:

1. The shippable outcome is known.
2. The split is known (one card, or one card per supplier / per outcome).
3. **Definition of Done** is real `* DoD1: <text>` lines.
4. **Visibility** has a query that shows the wrong behaviour (per sibling, scoped to that supplier / outcome).
5. **Possible solution / expected behavior** is included when we know what should happen instead.

Use `db_access`, `bookability`, `debugger`, or `codebase_access` until the bar is met. Discovery dumps stay in the chat.

**Do not file** `(Investigation Pending)` cards or `* DoD1: _TO BE DONE_`. Honour one exception: the user says “skip investigation, file a pending card.”

## When to split

Propose N cards instead of one when any of these is true:

- More than one independently shippable outcome.
- Each supplier needs its own change (different adapter, different operation, different office rules).
- The draft would be Size `L`, or **Definition of Done** would go past three items.

**Do not split** when several suppliers share one code change. That is one card.

**Do not split** an existing board card unless the user says “split this card.”

**Honour overrides:** “file one card” / “do not split.”

### Existing card the user asked to split

1. Narrow that card to one outcome. Keep it on its current list.
2. File the other slices as new Backlog cards.
3. Same Project value. Cross-link every sibling.
4. Do not leave the original as an empty tracker. Do not archive it if it still holds one real slice.

### Mid-work split

A second supplier or a second outcome appears while working a card. File a sibling on **Backlog**. Same Project. Cross-link. Do not turn the first card into a parent. Do not put the sibling on In Progress.

## Grouping (no parent)

| Tool | Use for |
|------|---------|
| Type labels (`Bugs & Fixes`, `Optimization`, …) | Work type. Not a sibling group. |
| **Project** custom field | Sibling group key. Visible on the card front. |
| `⊙ Similar / relevant cards` | Bidirectional links. Mandatory on every sibling. |

Lone cards leave Project empty. Do not add a Project option for a single card.

### Reuse vs new Project option

Call `get_board_custom_fields` and read the field named **Project** (`id` `653bf653d526a0bd397d0850` — refresh from the tool if it 404s).

- Reuse an existing option when it covers the **whole** sibling set (`Fare Families`, `Make Dida happen`, `Rebooker`, …).
- Add a new option only when no existing option covers the set.
- Name the new option after the **shared outcome**, no supplier prefix. Good: `InvalidAgeForPaxType`. Bad: `DIDA InvalidAge`.

Existing program labels (`Fare Families`, `Project Sherlock`) stay as labels when the team already uses them. They do not replace Project.

### How to add a Project option

The Trello MCP can **set** Project on a card (`update_card_custom_field`). It cannot add a dropdown option. After approval, run:

```bash
python3 .cursor/skills/trello_assistant/scripts/add_project_option.py --add "InvalidAgeForPaxType"
```

The script prints JSON with `id` and `text`. It reuses an existing option on a case-insensitive name match and does not create a duplicate. Then set Project on every sibling:

- `update_card_custom_field`: `customFieldId` = Project field id, `type` = `list`, `value` = the option id.

## Approval and write order

A split is **one** approval. Show in chat, then wait:

1. Project: existing option name **or** the new option name to add.
2. Every sibling: title + full description body (the markdown you will send).
3. Type labels for each card.

On approval, in this order:

1. Add the Project option if needed (`add_project_option.py`).
2. `add_card_to_list` on Backlog for each sibling. Omit `⊙ Similar / relevant cards` on this first write — URLs do not exist yet. Assign Filipp, then Maryna, then Alexander on each card.
3. `update_card_custom_field` Project on each sibling.
4. `update_card_details` on **each** sibling with `⊙ Similar / relevant cards` listing the other siblings as `[title](shortUrl) — same change, different supplier` (or `same program, different outcome`).

Dedup the set **before** the approval message. Siblings are not duplicates of each other. See [`dedup.md`](dedup.md).

## Title alignment

Keep the ALL-CAPS supplier / area prefix different per sibling. Align the clause after the colon so the group is obvious:

- `DIDA: InvalidAgeForPaxType on infant PTC`
- `AMADEUS: InvalidAgeForPaxType on infant PTC`

## What not to do

- Do not create a parent card, a `Child cards` checklist, or a parent attachment on Content Integration cards.
- Do not put a sibling group in Blocked because another sibling is unfinished.
- Do not add a new Project option when an existing option covers the set.
- Do not name a Project option after one supplier.
- Do not file until the investigation bar is met (unless the user skips investigation).
- Do not silently file one fat card when the split rules fire. Propose the split in the approval message.
