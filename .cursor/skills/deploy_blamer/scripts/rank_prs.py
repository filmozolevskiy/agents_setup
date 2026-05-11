#!/usr/bin/env python3
"""Rank merged genesis PRs in a regression window by symptom-keyword overlap.

Input is a JSON file (a list of PR objects, each with at least the keys
`number`, `title`, `user.login` or `author`, `merged_at`, `body`,
`html_url`, `files`, and optionally `labels`). The expected shape mirrors
what the agent dumps after combining `list_pull_requests` with
`get_pull_request_files` from the `user-GitHub` MCP — see
`.cursor/skills/deployment_review/SKILL.md` § Workflow.

Output is a markdown table sorted by score (descending), ties broken by
`merged_at` (descending). Stdlib only — runs anywhere Python 3 does.

Usage::

    python3 .cursor/skills/deployment_review/scripts/rank_prs.py \\
        --prs-file reports/prs_<from>_<to>.json \\
        --symptom "PayHub Sale failures" \\
        --top 10
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

# Light English stopwords — the symptom phrase is short and we want
# every content word to count, but "the failures in" should not.
_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for",
    "from", "has", "have", "in", "is", "it", "its", "of", "on", "or",
    "that", "the", "this", "to", "was", "were", "with", "we", "our",
    "us", "around", "after", "before", "started", "showing", "showed",
    "appearing", "appears", "issue", "issues", "problem", "problems",
    "error", "errors", "failure", "failures", "failing", "fail",
    "fails", "down", "up", "spike", "spikes", "dropped", "drop",
}

# Per-area aliases. Keep keys lowercase. When the symptom phrase
# contains any of the keys (or one of its aliases), the alias list is
# unioned into the keyword set used for scoring.
_AREA_ALIASES: dict[str, list[str]] = {
    "payhub": ["payhub", "sale_pgwy", "sale", "payment", "gateway", "cybersource"],
    "optimizer": ["optimizer", "optimization", "contestant", "reprice", "candidate"],
    "bookability": ["bookability", "bookable", "availability", "verifyprice", "verify_price"],
    "amadeus": ["amadeus", "omnix", "amadeus_ws"],
    "flx": ["flx", "flxndc", "ndc"],
    "ndc": ["ndc", "flxndc"],
    "respro": ["respro", "downtowntravel", "dtt"],
    "dtt": ["dtt", "downtowntravel", "respro"],
    "wordspan": ["wordspan", "worldspan", "1g"],
    "dida": ["dida"],
    "travelfusion": ["travelfusion", "tf"],
    "sabre": ["sabre"],
    "galileo": ["galileo", "1g"],
    "multi": ["multi_ticket", "multi-ticket", "master", "slave"],
    "ticket": ["ticket", "ticketing"],
    "qa": ["qa", "test"],
    "checkout": ["checkout", "purchase", "book_flight", "bookflight"],
    "search": ["search", "shop"],
    "loyalty": ["loyalty", "rewards", "points"],
    "fraud": ["fraud", "decline", "kount"],
}


def _tokenize(symptom: str) -> set[str]:
    """Lowercase, drop short words / stopwords, expand area aliases."""
    raw = re.findall(r"[A-Za-z][A-Za-z_\-]+", symptom.lower())
    base = {tok for tok in raw if len(tok) > 2 and tok not in _STOPWORDS}
    expanded: set[str] = set(base)
    for tok in list(base):
        if tok in _AREA_ALIASES:
            expanded.update(_AREA_ALIASES[tok])
    return expanded


_TRELLO_LINK = re.compile(r"trello\.com/c/([A-Za-z0-9]+)")


def _trello_card(body: str | None) -> str | None:
    if not body:
        return None
    m = _TRELLO_LINK.search(body)
    if not m:
        return None
    return f"https://trello.com/c/{m.group(1)}"


def _author(pr: dict[str, Any]) -> str:
    if "author" in pr and pr["author"]:
        return str(pr["author"])
    user = pr.get("user")
    if isinstance(user, dict):
        return str(user.get("login", "?"))
    if isinstance(user, str):
        return user
    return "?"


def _labels(pr: dict[str, Any]) -> list[str]:
    raw = pr.get("labels") or []
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, dict):
            name = entry.get("name")
            if isinstance(name, str):
                out.append(name)
        elif isinstance(entry, str):
            out.append(entry)
    return out


def _score(pr: dict[str, Any], keywords: set[str]) -> tuple[int, list[str]]:
    """Return (score, matched_files) for one PR against the keyword set.

    Weights are deliberately coarse — the helper is a ranker, not a
    classifier. See SKILL.md § Workflow step 4 for the contract.
    """
    title = (pr.get("title") or "").lower()
    body = (pr.get("body") or "").lower()
    files = [str(f).lower() for f in (pr.get("files") or [])]
    labels = [lbl.lower() for lbl in _labels(pr)]

    score = 0
    matched_files: list[str] = []

    for kw in keywords:
        if kw in title:
            score += 3
        if kw in body:
            score += 1
        for lbl in labels:
            if kw in lbl:
                score += 5
                break

    for fname in files:
        for kw in keywords:
            if kw in fname:
                matched_files.append(fname)
                score += 2
                break

    return score, sorted(set(matched_files))[:3]


def _rationale(pr: dict[str, Any], matched_files: list[str],
               keywords: set[str]) -> str:
    """Human-readable rationale string for the table cell."""
    title = (pr.get("title") or "").lower()
    body = (pr.get("body") or "").lower()
    labels = [lbl.lower() for lbl in _labels(pr)]
    title_hits = sorted({kw for kw in keywords if kw in title})
    body_hits = sorted({kw for kw in keywords if kw in body})
    label_hits = sorted({
        kw for kw in keywords for lbl in labels if kw in lbl
    })
    parts: list[str] = []
    if title_hits:
        parts.append(f"title hits `{'`+`'.join(title_hits)}`")
    if matched_files:
        parts.append(f"files hit `{'`, `'.join(matched_files)}`")
    if label_hits:
        parts.append(f"label hits `{'`+`'.join(label_hits)}`")
    if body_hits and not (title_hits or matched_files or label_hits):
        parts.append(f"body mentions `{'`+`'.join(body_hits)}`")
    return "; ".join(parts) if parts else "(no keyword overlap)"


def _row(pr: dict[str, Any], rank: int, score: int,
         matched_files: list[str], keywords: set[str]) -> str:
    number = pr.get("number", "?")
    title = (pr.get("title") or "").replace("|", "\\|")
    url = pr.get("html_url") or f"https://github.com/mventures/genesis/pull/{number}"
    pr_cell = f"[#{number} {title}]({url})"
    author = _author(pr)
    merged_at = pr.get("merged_at") or "?"
    files_cell = ", ".join(f"`{f}`" for f in matched_files) or "—"
    trello_url = _trello_card(pr.get("body"))
    if trello_url:
        short = trello_url.rsplit("/", 1)[-1]
        trello_cell = f"[{short}]({trello_url})"
    else:
        trello_cell = "—"
    rationale = _rationale(pr, matched_files, keywords)
    return (
        f"| {rank} | {pr_cell} | {author} | {merged_at} | {score} | "
        f"{files_cell} | {trello_cell} | {rationale} |"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--prs-file", required=True, type=Path,
                        help="JSON file of merged PRs (list of objects)")
    parser.add_argument("--symptom", required=True,
                        help="Free-text symptom — e.g. 'PayHub Sale failures'")
    parser.add_argument("--top", type=int, default=10,
                        help="How many rows to print (default: 10)")
    args = parser.parse_args()

    if not args.prs_file.exists():
        print(f"error: {args.prs_file} not found", file=sys.stderr)
        return 2

    payload = json.loads(args.prs_file.read_text())
    if isinstance(payload, dict):
        # Tolerate {"items": [...]} or {"pull_requests": [...]} wrappers.
        for key in ("items", "pull_requests", "prs", "data"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
    if not isinstance(payload, list):
        print("error: prs-file must be a JSON list of PR objects",
              file=sys.stderr)
        return 2

    keywords = _tokenize(args.symptom)
    if not keywords:
        print(f"error: symptom '{args.symptom}' produced no keywords "
              f"after tokenization", file=sys.stderr)
        return 2

    scored: list[tuple[int, str, dict[str, Any], list[str]]] = []
    for pr in payload:
        if not isinstance(pr, dict) or pr.get("merged_at") is None:
            continue
        score, matched_files = _score(pr, keywords)
        scored.append((score, str(pr.get("merged_at") or ""), pr, matched_files))

    # Sort by score desc, then merged_at desc.
    scored.sort(key=lambda row: (-row[0], _neg_iso(row[1])))

    if not scored:
        print(f"No merged PRs in `{args.prs_file}` to rank.")
        return 0

    top = scored[: args.top]
    print(f"Symptom: `{args.symptom}` — keywords: "
          f"`{'`, `'.join(sorted(keywords))}`")
    print(f"Ranked {len(scored)} merged PR(s); showing top {len(top)}.")
    print()
    print("| # | PR | Author | Merged (UTC) | Score | Files matched | "
          "Trello | Rationale |")
    print("|---|-----|--------|--------------|-------|----------------|"
          "--------|-----------|")
    for rank, (score, _merged, pr, matched_files) in enumerate(top, start=1):
        print(_row(pr, rank, score, matched_files, keywords))
    return 0


def _neg_iso(iso: str) -> str:
    """Trick to sort merged_at desc inside an asc-sorted tuple key.

    GitHub returns ISO-8601 strings; we want newer first when scores
    tie. Inverting char codes gives the same order without parsing.
    """
    return "".join(chr(255 - ord(c)) for c in iso) if iso else ""


if __name__ == "__main__":
    sys.exit(main())
