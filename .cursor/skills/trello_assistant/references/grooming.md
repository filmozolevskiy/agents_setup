# Grooming prep — developer-centric in-flight report

Run when the user asks to **prep grooming** / produce a **grooming report** / list **what each dev has in flight**. Users review it the same way every week — do not invent a different layout.

## What the report is

- Developers only, per [`../roles.md`](../roles.md) § Developers. Everyone else (QA, analysts, specialists, manual agent team) is excluded.
- **Every card currently sitting in the 6 in-flight lists**, regardless of recent activity:

  | Order | List | ID |
  |---|---|---|
  | 1 | In Progress | `61d5cfd748343984d1dd4fc3` |
  | 2 | TODO | `61d5cfd1ffca1f891a0fd237` |
  | 3 | Blocked | `679d612a6f880eb62c672aa1` |
  | 4 | Staging | `68de85f3a35d950e37cefc8b` |
  | 5 | Fixes needed | `65563ff118d482065927fa4b` |
  | 6 | Ready for Deployment | `68e7ce249a3c3f669f04399b` |

- If any list ID 404s or returns empty unexpectedly, run `get_lists` against the board and refresh the mapping — admins occasionally rename or recreate a list.
- Cards idle for 14+ days carry a `**STALE 14d+**` marker.
- A card can appear under multiple devs; counts are lines, not unique board cards.

## Procedure

1. `set_active_board` with `61d5cf784c6396541499e7ce` once per session.
2. `get_cards_by_list_id` for each of the 6 lists above. Save each response as a JSON array to a file (one per list) — the MCP response body is already a JSON array.
3. Run the script:

   ```bash
   python3 .cursor/skills/trello_assistant/scripts/grooming_report.py \
     --list "In Progress:/abs/path/in_progress.json" \
     --list "TODO:/abs/path/todo.json" \
     --list "Blocked:/abs/path/blocked.json" \
     --list "Staging:/abs/path/staging.json" \
     --list "Fixes needed:/abs/path/fixes_needed.json" \
     --list "Ready for Deployment:/abs/path/ready_for_deployment.json" \
     --out reports/grooming_devs_inflight_$(date -u +%F).md
   ```

4. Summarize to the user: per-list volumes, biggest in-flight queues, stale cards worth flagging. Link to the file in `reports/`.

## Keep the developer mapping honest

The script hard-codes Trello member IDs → display names in `DEVELOPERS`. When someone joins or leaves the dev team, update both [`../roles.md`](../roles.md) § Developers **and** `DEVELOPERS` in `scripts/grooming_report.py`. A missing entry silently drops that dev's cards from the report.

## What not to do

- Do not filter by `dateLastActivity` window. The report is "everything in flight", not "touched this week".
- Do not include non-dev roles, even if they have cards in the in-flight lists.
- Do not include `QA`, `QA Tracking 👀`, `Done`, `Parking`, or any other list. Only the 6 in-flight lists above.
- Do not re-order the per-dev sub-buckets. Always `In Progress → TODO → Blocked → Staging → Fixes needed → Ready for Deployment`.
- Do not drop the `**STALE 14d+**` flag or change the 14d threshold without the user asking.
