# Deduplication — before creating a card

Never create a card until the board has been checked for existing work covering the same change or fix.

## Procedure

1. `set_active_board` with `61d5cf784c6396541499e7ce` once per session, then `get_lists`.
2. Pull cards from every list. Use `get_cards_by_list_id` per list and save each response as JSON.
3. Filter with the repo script — never shell-pipe huge JSON.

   ```bash
   python3 .cursor/skills/trello_assistant/scripts/filter_cards.py \
     --terms "keyword1" "keyword2" \
     --exclude "listID1" "listID2" \
     -- path/to/cards_backlog.json path/to/cards_ready_for_dev.json
   ```

   Or pipe via stdin: `... filter_cards.py --terms "keyword" < cards.json`.

   The script parses real JSON (`json.load`), accepts a top-level array or an object wrapping it. Output is one line per card, `name | url`, deduped, sorted by name. Prefers `url` (slug-bearing) over `shortUrl`.

4. Match on title prefix (`AMADEUS`, `RESPRO`, …), core keywords, carrier / office / GDS named in the request, booking ID, hash, error text. For candidates, also `get_card` with `includeMarkdown: true` to compare descriptions.

## Outcomes

- **Duplicate:** do not create. Tell the user which card(s) cover it (use `shortUrl` / `url`). Offer to add new examples, queries, or links via `add_comment` or `update_card_details` on that card.
- **Similar but not duplicate:** create the new card on Backlog and note overlaps inline in `⊙ **Details**` as `[title](shortUrl) — same office, different error`. No separate "Related cards" section unless the user asks.
- **Nothing related:** create. Do not add a "none found" line unless it helps the team.

When the user explicitly wants a new card even though a close duplicate exists (e.g. split scope), note the duplicate inline in Details and explain the split in one short sentence.
