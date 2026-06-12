#!/usr/bin/env python3
"""Mine JP's PR review comments from mventures/genesis into a JSONL corpus.

Reads GITHUB_PERSONAL_ACCESS_TOKEN from .env (repo root). Streams one
JSON line per captured comment to --out. Re-runnable; --append skips
PRs already represented in the existing JSONL.

Usage:
    python3 .cursor/skills/code_review/scripts/mine_jp_comments.py \\
        --since 2026-03-09 \\
        --out reports/code_review/jp_comments.jsonl

Refresh mode (incremental):
    python3 .cursor/skills/code_review/scripts/mine_jp_comments.py \\
        --since 2026-06-01 \\
        --out reports/code_review/jp_comments.jsonl \\
        --append

Field shape (locked in CONTEXT.md, term `Corpus`):
    pr_number, pr_title, pr_merged_at, pr_author,
    comment_id, comment_permalink, comment_body,
    in_reply_to_id, file_path, line, diff_hunk, is_review_summary
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Iterable, Iterator

REPO = "mventures/genesis"
TARGET_USER = "jpleveille-mv"
BASE_BRANCH = "develop"
API = "https://api.github.com"
USER_AGENT = "agents_setup-code_review-miner/1.0"


def load_env(repo_root: Path) -> dict[str, str]:
    env_path = repo_root / ".env"
    if not env_path.exists():
        sys.exit(f"ERROR: {env_path} not found")
    out: dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        v = v.strip().strip('"').strip("'")
        out[k.strip()] = v
    return out


def gh_request(url: str, token: str) -> tuple[dict | list, dict[str, str]]:
    """GET against GitHub REST. Returns (parsed_json, response_headers).

    Sleeps and retries once on rate-limit; raises on other non-2xx.
    """
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": USER_AGENT,
        },
    )
    for attempt in (1, 2):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                headers = dict(resp.headers)
                body = json.loads(resp.read().decode("utf-8"))
                _maybe_throttle(headers)
                return body, headers
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and attempt == 1:
                reset = int(e.headers.get("X-RateLimit-Reset", "0") or "0")
                wait = max(reset - int(time.time()), 30) + 5
                print(
                    f"  rate-limited ({e.code}); sleeping {wait}s",
                    file=sys.stderr,
                )
                time.sleep(wait)
                continue
            body = e.read().decode("utf-8", errors="replace")
            sys.exit(f"ERROR: GET {url} -> HTTP {e.code}: {body[:300]}")
        except urllib.error.URLError as e:
            sys.exit(f"ERROR: GET {url} -> URLError: {e}")
    sys.exit(f"ERROR: GET {url} -> exhausted retries")


def _maybe_throttle(headers: dict[str, str]) -> None:
    remaining = headers.get("X-RateLimit-Remaining")
    if remaining is None:
        return
    try:
        n = int(remaining)
    except ValueError:
        return
    if n < 100:
        reset = int(headers.get("X-RateLimit-Reset", "0") or "0")
        wait = max(reset - int(time.time()), 5) + 2
        print(
            f"  rate-limit low ({n} left); sleeping {wait}s",
            file=sys.stderr,
        )
        time.sleep(wait)


def search_jp_prs(since: str, token: str, until: str | None = None) -> Iterator[dict]:
    """Yield search-issues records for merged PRs JP commented on in window."""
    merged_clause = f"merged:{since}..{until}" if until else f"merged:>={since}"
    q = (
        f"repo:{REPO} is:pr is:merged base:{BASE_BRANCH} "
        f"{merged_clause} commenter:{TARGET_USER}"
    )
    per_page = 100
    page = 1
    total_seen = 0
    while True:
        url = (
            f"{API}/search/issues?q={urllib.parse.quote(q)}"
            f"&per_page={per_page}&page={page}&sort=created&order=desc"
        )
        body, _ = gh_request(url, token)
        items = body.get("items", []) if isinstance(body, dict) else []
        total_count = body.get("total_count", 0) if isinstance(body, dict) else 0
        if page == 1:
            print(
                f"search: total_count={total_count} for q='{q}'",
                file=sys.stderr,
            )
            if total_count > 1000:
                print(
                    "  WARN: GitHub search caps at 1000 results; "
                    "narrow --since if you need full coverage.",
                    file=sys.stderr,
                )
        if not items:
            return
        for it in items:
            total_seen += 1
            yield it
        if len(items) < per_page:
            return
        page += 1


def fetch_pr_comments(pr_number: int, token: str) -> list[dict]:
    """All inline review comments on the PR (paginated)."""
    out: list[dict] = []
    page = 1
    while True:
        url = (
            f"{API}/repos/{REPO}/pulls/{pr_number}/comments"
            f"?per_page=100&page={page}"
        )
        body, _ = gh_request(url, token)
        if not isinstance(body, list) or not body:
            return out
        out.extend(body)
        if len(body) < 100:
            return out
        page += 1


def fetch_pr_reviews(pr_number: int, token: str) -> list[dict]:
    """All review-summary records on the PR (paginated)."""
    out: list[dict] = []
    page = 1
    while True:
        url = (
            f"{API}/repos/{REPO}/pulls/{pr_number}/reviews"
            f"?per_page=100&page={page}"
        )
        body, _ = gh_request(url, token)
        if not isinstance(body, list) or not body:
            return out
        out.extend(body)
        if len(body) < 100:
            return out
        page += 1


def existing_keys(out_path: Path) -> tuple[set[tuple[int, str]], set[int]]:
    """Return (set of (pr_number, comment_id), set of pr_numbers seen)."""
    keys: set[tuple[int, str]] = set()
    prs: set[int] = set()
    if not out_path.exists():
        return keys, prs
    with out_path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            pr = rec.get("pr_number")
            cid = rec.get("comment_id")
            if pr is not None:
                prs.add(int(pr))
            if pr is not None and cid:
                keys.add((int(pr), str(cid)))
    return keys, prs


def to_record(
    *,
    pr_item: dict,
    raw: dict,
    is_review_summary: bool,
) -> dict | None:
    """Build a corpus record. Skip empty-body review summaries."""
    body = (raw.get("body") or "").strip()
    if is_review_summary and not body:
        return None
    if not body:
        return None
    pr_number = pr_item["number"]
    if is_review_summary:
        permalink = (
            f"https://github.com/{REPO}/pull/{pr_number}"
            f"#pullrequestreview-{raw['id']}"
        )
        file_path = None
        line = None
        diff_hunk = None
        in_reply_to = None
    else:
        permalink = raw.get("html_url") or (
            f"https://github.com/{REPO}/pull/{pr_number}"
            f"#discussion_r{raw['id']}"
        )
        file_path = raw.get("path")
        line = raw.get("line") or raw.get("original_line")
        diff_hunk = raw.get("diff_hunk")
        in_reply_to = raw.get("in_reply_to_id")
    pr_meta = pr_item.get("pull_request") or {}
    return {
        "pr_number": pr_number,
        "pr_title": pr_item.get("title"),
        "pr_merged_at": pr_meta.get("merged_at") or pr_item.get("closed_at"),
        "pr_author": (pr_item.get("user") or {}).get("login"),
        "comment_id": str(raw["id"]),
        "comment_permalink": permalink,
        "comment_body": body,
        "in_reply_to_id": str(in_reply_to) if in_reply_to else None,
        "file_path": file_path,
        "line": line,
        "diff_hunk": diff_hunk,
        "is_review_summary": is_review_summary,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--since",
        required=True,
        help="ISO date (YYYY-MM-DD) — fetch PRs merged on or after this date.",
    )
    parser.add_argument(
        "--until",
        default=None,
        help="ISO date (YYYY-MM-DD) — fetch PRs merged on or before this date. Used to slice around GitHub's 1000-result search cap.",
    )
    parser.add_argument(
        "--out",
        default="reports/code_review/jp_comments.jsonl",
        help="Output JSONL path (default: reports/code_review/jp_comments.jsonl).",
    )
    parser.add_argument(
        "--append",
        action="store_true",
        help="Refresh mode: skip PRs already present in --out; append new lines.",
    )
    parser.add_argument(
        "--pr-limit",
        type=int,
        default=None,
        help="Cap on PRs to walk (dry-run / sanity check).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[4]
    env = load_env(repo_root)
    token = env.get("GITHUB_PERSONAL_ACCESS_TOKEN")
    if not token:
        sys.exit("ERROR: GITHUB_PERSONAL_ACCESS_TOKEN not set in .env")

    out_path = (repo_root / args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    seen_keys, seen_prs = existing_keys(out_path) if args.append else (set(), set())
    if args.append:
        print(
            f"append mode: {len(seen_prs)} PRs / {len(seen_keys)} comments already in {out_path.name}",
            file=sys.stderr,
        )

    mode = "a" if args.append else "w"
    prs_walked = 0
    prs_skipped = 0
    inline_captured = 0
    summary_captured = 0
    dropped_other_user_inline = 0
    dropped_other_user_summary = 0

    with out_path.open(mode) as out_fh:
        for pr_item in search_jp_prs(args.since, token, args.until):
            if args.pr_limit is not None and prs_walked >= args.pr_limit:
                print(
                    f"  pr-limit reached ({args.pr_limit}); stopping",
                    file=sys.stderr,
                )
                break
            pr_number = pr_item["number"]
            if args.append and pr_number in seen_prs:
                prs_skipped += 1
                continue
            prs_walked += 1
            print(
                f"[{prs_walked}] PR #{pr_number}: {pr_item.get('title', '')[:70]}",
                file=sys.stderr,
            )

            for c in fetch_pr_comments(pr_number, token):
                if (c.get("user") or {}).get("login") != TARGET_USER:
                    dropped_other_user_inline += 1
                    continue
                if args.append and (pr_number, str(c["id"])) in seen_keys:
                    continue
                rec = to_record(pr_item=pr_item, raw=c, is_review_summary=False)
                if rec is None:
                    continue
                out_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                inline_captured += 1

            for r in fetch_pr_reviews(pr_number, token):
                if (r.get("user") or {}).get("login") != TARGET_USER:
                    dropped_other_user_summary += 1
                    continue
                if args.append and (pr_number, str(r["id"])) in seen_keys:
                    continue
                rec = to_record(pr_item=pr_item, raw=r, is_review_summary=True)
                if rec is None:
                    continue
                out_fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
                summary_captured += 1

            out_fh.flush()

    print("", file=sys.stderr)
    print("=== Done ===", file=sys.stderr)
    print(f"PRs walked:                {prs_walked}", file=sys.stderr)
    print(f"PRs skipped (append mode): {prs_skipped}", file=sys.stderr)
    print(f"Inline comments captured:  {inline_captured}", file=sys.stderr)
    print(f"Summary comments captured: {summary_captured}", file=sys.stderr)
    print(
        f"Dropped (non-JP inline):   {dropped_other_user_inline}",
        file=sys.stderr,
    )
    print(
        f"Dropped (non-JP summary):  {dropped_other_user_summary}",
        file=sys.stderr,
    )
    print(f"Output: {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
