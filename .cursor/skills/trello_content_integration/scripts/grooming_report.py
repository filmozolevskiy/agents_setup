#!/usr/bin/env python3
"""Build a weekly grooming report from Trello card JSONs dumped by the
user-trello MCP `get_cards_by_list_id` tool.

Usage:
    python3 grooming_report.py \
        --since 2026-04-10 --until 2026-04-17 \
        --list "Ready for Dev:/path/to/ready_for_dev.json" \
        --list "In Progress:/path/to/in_progress.json" ...

The script reads each JSON dump (as produced by the MCP tool) and groups
cards updated inside the [since, until] window (based on
``dateLastActivity``) by developer, using a hard-coded mapping derived
from ``.cursor/skills/trello_content_integration/roles.md``.
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

DEVELOPERS: dict[str, str] = {
    "568c0256cb8424314be08117": "Avi Aialon",
    "63ea60e86b05cd6cfff70a68": "Ivan Tarasov",
    "66704a164a6d2ba8ef333f24": "Andrei Skachkou",
    "662170438c50974e5a808067": "Andrei Varanita",
    "699350b9a5a16bd0897e9c28": "Razvan",
    "5c86b3feab208e448e37919e": "Jean-Philippe Léveillé (JP)",
    "58caf5193fbebfa072d991ac": "Jean-Marc Jodoin (JM)",
    "6965316cbfe3dcb82a029c44": "Maria-Christine Catiche",
}


@dataclass
class Card:
    id: str
    id_short: int
    name: str
    url: str
    list_name: str
    date_last_activity: datetime
    members: list[str]
    labels: list[str]


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_cards(path: Path, list_name: str) -> list[Card]:
    raw = json.loads(path.read_text())
    cards: list[Card] = []
    for item in raw:
        cards.append(
            Card(
                id=item["id"],
                id_short=item.get("idShort", 0),
                name=item.get("name", ""),
                url=item.get("url") or item.get("shortUrl", ""),
                list_name=list_name,
                date_last_activity=_parse_iso(item["dateLastActivity"]),
                members=list(item.get("idMembers", [])),
                labels=[label.get("name", "") for label in item.get("labels", [])],
            )
        )
    return cards


def filter_window(cards: Iterable[Card], since: datetime, until: datetime) -> list[Card]:
    return [c for c in cards if since <= c.date_last_activity <= until]


def group_by_developer(cards: Iterable[Card]) -> dict[str, list[Card]]:
    groups: dict[str, list[Card]] = {name: [] for name in DEVELOPERS.values()}
    groups["(no developer assigned)"] = []
    for card in cards:
        assigned = [DEVELOPERS[m] for m in card.members if m in DEVELOPERS]
        if not assigned:
            groups["(no developer assigned)"].append(card)
            continue
        for name in assigned:
            groups[name].append(card)
    return groups


LIST_ORDER = [
    "Ready for Dev",
    "In Progress",
    "Blocked",
    "Staging",
    "Fixes needed",
    "Ready for Deployment",
    "QA",
    "QA Tracking 👀",
    "Done",
]


def format_report(
    groups: dict[str, list[Card]],
    since: datetime,
    until: datetime,
) -> str:
    lines: list[str] = []
    lines.append(
        f"# Grooming progress — {since.date().isoformat()} → {until.date().isoformat()}"
    )
    lines.append("")
    lines.append(
        "Cards whose last activity falls inside the window, grouped by developer."
    )
    lines.append("")

    list_rank = {name: idx for idx, name in enumerate(LIST_ORDER)}

    for name in list(DEVELOPERS.values()) + ["(no developer assigned)"]:
        cards = groups.get(name, [])
        if not cards:
            continue
        cards.sort(
            key=lambda c: (list_rank.get(c.list_name, 99), -c.date_last_activity.timestamp())
        )
        lines.append(f"## {name} ({len(cards)})")
        lines.append("")
        current_list = None
        for card in cards:
            if card.list_name != current_list:
                lines.append(f"### {card.list_name}")
                current_list = card.list_name
            label_tag = f" _[{', '.join(card.labels)}]_" if card.labels else ""
            lines.append(
                f"- #{card.id_short} [{card.name}]({card.url}) — "
                f"last activity {card.date_last_activity.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"
                f"{label_tag}"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", required=True, help="Inclusive start date, YYYY-MM-DD")
    parser.add_argument("--until", required=True, help="Inclusive end date, YYYY-MM-DD")
    parser.add_argument(
        "--list",
        dest="lists",
        action="append",
        required=True,
        help="'List Name:/abs/path/to/dump.json' — repeat per list",
    )
    parser.add_argument("--out", default=None, help="Optional output file")
    args = parser.parse_args()

    since = datetime.fromisoformat(args.since).replace(tzinfo=timezone.utc)
    until = datetime.fromisoformat(args.until).replace(
        hour=23, minute=59, second=59, tzinfo=timezone.utc
    )

    all_cards: list[Card] = []
    for entry in args.lists:
        name, _, path = entry.partition(":")
        all_cards.extend(load_cards(Path(path), name))

    windowed = filter_window(all_cards, since, until)
    groups = group_by_developer(windowed)
    report = format_report(groups, since, until)

    if args.out:
        Path(args.out).write_text(report)
    print(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
