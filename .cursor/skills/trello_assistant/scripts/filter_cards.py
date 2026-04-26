#!/usr/bin/env python3
"""Filter Trello cards from `get_cards_by_list_id` MCP output.

The Trello MCP returns each list's cards as a JSON array. This script:
  - loads one or more JSON files (or stdin) containing those arrays
  - keeps cards whose `name` matches any `--terms` substring (case-insensitive)
  - optionally drops cards whose `idList` is in `--exclude`
  - prints one deduplicated `name | url` line per card

Usage:
    # Explicit files (recommended; the agent passes the Trello dumps it just wrote):
    python3 filter_cards.py --terms DTT "NDC-1348" -- cards_backlog.json cards_ready.json

    # Piped JSON (single combined array or single list's array):
    python3 filter_cards.py --terms DTT < cards.json

    # With excluded lists:
    python3 filter_cards.py --terms DTT --exclude 6509c593087340dfdd332b0a -- cards.json

The script is portable (no hardcoded paths) and tolerant of minor shape differences
(the MCP sometimes wraps the array in `{ "cards": [...] }` or similar).
"""

import argparse
import json
import sys
from pathlib import Path


def load_cards(source):
    """Return a list of card dicts from an open file or text blob.

    Accepts:
      - top-level JSON array of cards
      - object with a single list value that is the card array (e.g. {"cards": [...]})
    """
    data = json.load(source) if hasattr(source, "read") else json.loads(source)

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                return value
    return []


def card_matches(card, terms_lower):
    name = card.get("name") or ""
    name_lower = name.lower()
    return any(term in name_lower for term in terms_lower)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--terms", nargs="+", required=True, help="Substrings to match against card names (case-insensitive; any-match).")
    parser.add_argument("--exclude", nargs="*", default=[], help="List IDs (`idList`) to drop.")
    parser.add_argument("files", nargs="*", help="JSON files with Trello cards. Use `-` for stdin. If omitted, stdin is read.")
    args = parser.parse_args()

    terms_lower = [t.lower() for t in args.terms]
    excluded = set(args.exclude)

    sources = []
    if not args.files or args.files == ["-"]:
        sources.append(sys.stdin)
    else:
        for path_str in args.files:
            if path_str == "-":
                sources.append(sys.stdin)
                continue
            path = Path(path_str)
            if not path.is_file():
                print(f"warning: skipping missing file {path}", file=sys.stderr)
                continue
            sources.append(path)

    results = {}
    for source in sources:
        try:
            if isinstance(source, Path):
                with source.open() as fh:
                    cards = load_cards(fh)
            else:
                cards = load_cards(source)
        except json.JSONDecodeError as exc:
            label = source if isinstance(source, Path) else "<stdin>"
            print(f"warning: skipping {label} (not valid JSON: {exc})", file=sys.stderr)
            continue

        for card in cards:
            if not isinstance(card, dict):
                continue
            if not card_matches(card, terms_lower):
                continue
            if excluded and card.get("idList") in excluded:
                continue
            url = card.get("url") or card.get("shortUrl")
            if not url:
                continue
            results.setdefault(url, card.get("name") or "")

    for url, name in sorted(results.items(), key=lambda x: x[1]):
        print(f"{name} | {url}")


if __name__ == "__main__":
    main()
