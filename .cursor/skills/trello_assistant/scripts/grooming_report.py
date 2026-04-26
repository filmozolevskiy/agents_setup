#!/usr/bin/env python3
"""Grooming prep report — developers only, every in-flight card.

The canonical format produced here is:

    # Grooming prep — developers, every in-flight card

    Snapshot: YYYY-MM-DD HH:MM UTC · Board: [Content Integration](...)

    Developers per [`.cursor/skills/trello_assistant/roles.md`](...):
    Avi, Ivan, Andrei Skachkou, Razvan, JP, JM, Maria-Christine.

    Every card currently sitting in **Ready for Dev · In Progress · Blocked ·
    Staging · Fixes needed · Ready for Deployment** that has a dev attached,
    regardless of recent activity. `STALE 14d+` = no activity in the last 2
    weeks.

    ## Board in-flight volume
    - **In Progress** — N cards
    - ...

    ## Per-developer in-flight
    ### <Name> — <N> in-flight
    - **<List>** (<n>)
      - #<idShort> · [<title>](<url>) — last activity YYYY-MM-DD (Nd ago)
        · <marks> · **STALE 14d+**

Inputs are the JSON dumps produced by the `user-trello` MCP's
`get_cards_by_list_id` tool — one dump per in-flight list.

Usage:
    python3 grooming_report.py \\
        --list "In Progress:/abs/path/in_progress.json" \\
        --list "Ready for Dev:/abs/path/ready_for_dev.json" \\
        --list "Blocked:/abs/path/blocked.json" \\
        --list "Staging:/abs/path/staging.json" \\
        --list "Fixes needed:/abs/path/fixes_needed.json" \\
        --list "Ready for Deployment:/abs/path/ready_for_deployment.json" \\
        --out reports/grooming_devs_inflight_YYYY-MM-DD.md

Flags:
    --stale-days  Days with no activity to mark STALE (default 14).
    --out         Output file. If omitted, printed to stdout.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

BOARD_URL = "https://trello.com/b/61d5cf784c6396541499e7ce"

# Trello member IDs → display name. Source of truth:
# .cursor/skills/trello_assistant/roles.md § Developers. Keep in sync when a
# dev joins or leaves the team. If a name in roles.md is missing here, the
# report will silently drop their cards.
DEVELOPERS: dict[str, str] = {
    "568c0256cb8424314be08117": "Avi Aialon",
    "63ea60e86b05cd6cfff70a68": "Ivan Tarasov",
    "66704a164a6d2ba8ef333f24": "Andrei Skachkou",
    "699350b9a5a16bd0897e9c28": "Razvan",
    "5c86b3feab208e448e37919e": "Jean-Philippe Léveillé (JP)",
    "58caf5193fbebfa072d991ac": "Jean-Marc Jodoin (JM)",
    "6965316cbfe3dcb82a029c44": "Maria-Christine Catiche",
}

# Short-form roster used in the intro sentence. Keep order aligned with
# DEVELOPERS for readability.
SHORT_NAMES = [
    "Avi",
    "Ivan",
    "Andrei Skachkou",
    "Razvan",
    "JP",
    "JM",
    "Maria-Christine",
]

IN_FLIGHT_LISTS = [
    "In Progress",
    "Ready for Dev",
    "Blocked",
    "Staging",
    "Fixes needed",
    "Ready for Deployment",
]


@dataclass
class Card:
    id: str
    id_short: int
    name: str
    url: str
    list_name: str
    date_last_activity: datetime
    members: list[str] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_cards(path: Path, list_name: str) -> list[Card]:
    raw = json.loads(path.read_text())
    if not isinstance(raw, list):
        raise ValueError(f"{path}: expected a top-level JSON array")
    cards: list[Card] = []
    for item in raw:
        cards.append(
            Card(
                id=item["id"],
                id_short=int(item.get("idShort", 0)),
                name=(item.get("name") or "").strip(),
                url=item.get("url") or item.get("shortUrl") or "",
                list_name=list_name,
                date_last_activity=_parse_iso(item["dateLastActivity"]),
                members=list(item.get("idMembers") or []),
                labels=[
                    label.get("name", "")
                    for label in (item.get("labels") or [])
                    if isinstance(label, dict) and label.get("name")
                ],
            )
        )
    return cards


def _is_bug(card: Card) -> bool:
    return any("bugs" in n.lower() for n in card.labels)


def _marks(card: Card) -> str:
    parts: list[str] = []
    if _is_bug(card):
        parts.append("bug")
    non_bug = [n for n in card.labels if n.lower() != "bugs & fixes"]
    if non_bug:
        parts.append(", ".join(n.lower() for n in non_bug))
    return f" · {' · '.join(parts)}" if parts else ""


def _days_idle(card: Card, now: datetime) -> int:
    return (now - card.date_last_activity).days


def _card_line(card: Card, now: datetime, stale_days: int) -> str:
    idle = _days_idle(card, now)
    stale = f" · **STALE {stale_days}d+**" if idle >= stale_days else ""
    return (
        f"  - #{card.id_short} · [{card.name}]({card.url}) — "
        f"last activity {card.date_last_activity.strftime('%Y-%m-%d')} "
        f"({idle}d ago){_marks(card)}{stale}"
    )


def _person_block(
    name: str,
    cards_by_list: dict[str, list[Card]],
    now: datetime,
    stale_days: int,
) -> list[str]:
    total = sum(len(v) for v in cards_by_list.values())
    out = [f"### {name} — {total} in-flight", ""]
    for lst in IN_FLIGHT_LISTS:
        cards = cards_by_list.get(lst, [])
        if not cards:
            continue
        out.append(f"- **{lst}** ({len(cards)})")
        cards_sorted = sorted(cards, key=lambda c: -c.date_last_activity.timestamp())
        for c in cards_sorted:
            out.append(_card_line(c, now, stale_days))
        out.append("")
    return out


def build_report(
    cards: list[Card],
    per_list_totals: dict[str, int],
    now: datetime,
    stale_days: int,
) -> str:
    by_dev: dict[str, dict[str, list[Card]]] = defaultdict(lambda: defaultdict(list))
    for card in cards:
        for mid in card.members:
            if mid in DEVELOPERS:
                by_dev[DEVELOPERS[mid]][card.list_name].append(card)

    def dev_total(name: str) -> int:
        return sum(len(v) for v in by_dev.get(name, {}).values())

    # All devs appear in the report; they are sorted by active in-flight lines
    # desc. Devs with zero cards get a `_(no cards in the 6 in-flight lists)_`
    # placeholder so the section reviews completely.
    ordered_names = sorted(DEVELOPERS.values(), key=lambda n: -dev_total(n))

    lines: list[str] = []
    lines.append("# Grooming prep — developers, every in-flight card")
    lines.append("")
    lines.append(
        f"Snapshot: {now.strftime('%Y-%m-%d %H:%M UTC')} · "
        f"Board: [Content Integration]({BOARD_URL})"
    )
    lines.append("")
    lines.append(
        "Developers per [`.cursor/skills/trello_assistant/roles.md`]"
        "(../.cursor/skills/trello_assistant/roles.md): "
        + ", ".join(SHORT_NAMES)
        + "."
    )
    lines.append("")
    lines.append(
        "Every card currently sitting in **"
        + " · ".join(IN_FLIGHT_LISTS)
        + f"** that has a dev attached, regardless of recent activity. "
        f"`STALE {stale_days}d+` = no activity in the last "
        f"{stale_days // 7 if stale_days % 7 == 0 else stale_days} "
        f"{'weeks' if stale_days >= 14 and stale_days % 7 == 0 else 'days'}."
    )
    lines.append("")

    lines.append("## Board in-flight volume")
    lines.append("")
    for lst in IN_FLIGHT_LISTS:
        lines.append(f"- **{lst}** — {per_list_totals.get(lst, 0)} cards")
    lines.append("")

    lines.append("## Per-developer in-flight")
    lines.append("")
    lines.append(
        "A card can appear under multiple devs; counts are lines, not unique "
        "board cards."
    )
    lines.append("")

    for name in ordered_names:
        blocks = by_dev.get(name) or {}
        if not blocks:
            lines.append(f"### {name} — 0 in-flight")
            lines.append("")
            lines.append("_(no cards in the 6 in-flight lists)_")
            lines.append("")
            continue
        lines.extend(_person_block(name, blocks, now, stale_days))

    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--list",
        dest="lists",
        action="append",
        required=True,
        help=(
            "'<List name>:<abs path to JSON dump>' — repeat once per "
            "in-flight list (Ready for Dev, In Progress, Blocked, Staging, "
            "Fixes needed, Ready for Deployment)."
        ),
    )
    parser.add_argument(
        "--stale-days",
        type=int,
        default=14,
        help="Days idle before a card is flagged STALE (default 14).",
    )
    parser.add_argument("--out", default=None, help="Optional output file.")
    args = parser.parse_args()

    all_cards: list[Card] = []
    per_list_totals: dict[str, int] = {}
    seen_lists: set[str] = set()
    for entry in args.lists:
        name, _, path = entry.partition(":")
        name = name.strip()
        if not name or not path:
            raise SystemExit(f"Bad --list entry: {entry!r}")
        if name not in IN_FLIGHT_LISTS:
            raise SystemExit(
                f"Unknown list {name!r}. Expected one of: "
                + ", ".join(IN_FLIGHT_LISTS)
            )
        cards = load_cards(Path(path), name)
        per_list_totals[name] = len(cards)
        all_cards.extend(cards)
        seen_lists.add(name)

    missing = [lst for lst in IN_FLIGHT_LISTS if lst not in seen_lists]
    if missing:
        raise SystemExit(
            "Missing --list dumps for: " + ", ".join(missing)
        )

    now = datetime.now(timezone.utc)
    report = build_report(all_cards, per_list_totals, now, args.stale_days)

    if args.out:
        Path(args.out).write_text(report)
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
