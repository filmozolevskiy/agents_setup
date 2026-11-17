#!/usr/bin/env python3
"""Fetch the review status of one GitHub pull request in one GraphQL call.

Usage:
    python3 pr_status.py <pr_url | owner/repo#N | N> [--repo owner/repo] [--json]

Reads through the `gh` CLI (`gh auth status` must be green). Read-only.
Prints a Markdown report by default; `--json` prints the normalised data
the report is built from.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone

DEFAULT_REPO = "mventures/genesis"

QUERY = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      number title url state isDraft createdAt updatedAt mergedAt closedAt
      author { __typename login }
      baseRefName headRefName
      additions deletions changedFiles
      mergeable reviewDecision
      mergedBy { login }
      commits(last:1) {
        totalCount
        nodes { commit { committedDate oid statusCheckRollup { state
          contexts(first:100) { nodes {
            __typename
            ... on CheckRun { name conclusion status detailsUrl }
            ... on StatusContext { context state targetUrl }
          } }
        } } }
      }
      reviewRequests(first:50) { nodes { requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { name slug }
      } } }
      reviews(first:100) { pageInfo { hasNextPage } nodes {
        author { __typename login } state submittedAt url body
        comments { totalCount }
      } }
      reviewThreads(first:100) { pageInfo { hasNextPage } nodes {
        isResolved isOutdated path line
        resolvedBy { login }
        comments(first:50) { totalCount nodes {
          author { __typename login } createdAt url body
        } }
      } }
      comments(first:100) { pageInfo { hasNextPage } nodes {
        author { __typename login } createdAt url body
      } }
      timelineItems(first:100, itemTypes:[READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT,
          REVIEW_REQUESTED_EVENT, REVIEW_REQUEST_REMOVED_EVENT, MERGED_EVENT,
          CLOSED_EVENT, REOPENED_EVENT]) {
        pageInfo { hasNextPage }
        nodes {
          __typename
          ... on ReadyForReviewEvent { createdAt actor { login } }
          ... on ConvertToDraftEvent { createdAt actor { login } }
          ... on ReviewRequestedEvent { createdAt actor { login }
            requestedReviewer { __typename ... on User { login } ... on Team { slug } } }
          ... on ReviewRequestRemovedEvent { createdAt actor { login }
            requestedReviewer { __typename ... on User { login } ... on Team { slug } } }
          ... on MergedEvent { createdAt actor { login } }
          ... on ClosedEvent { createdAt actor { login } }
          ... on ReopenedEvent { createdAt actor { login } }
        }
      }
    }
  }
}
"""

BOT_SUFFIXES = ("[bot]",)
BOT_LOGINS = {"github-actions", "dependabot", "codecov", "sonarcloud", "linear"}


def parse_ref(ref: str, repo: str) -> tuple[str, str, int]:
    m = re.search(r"github\.com/([^/]+)/([^/]+)/pull/(\d+)", ref)
    if m:
        return m.group(1), m.group(2), int(m.group(3))
    m = re.fullmatch(r"([^/\s]+)/([^#\s]+)#(\d+)", ref.strip())
    if m:
        return m.group(1), m.group(2), int(m.group(3))
    if ref.strip().lstrip("#").isdigit():
        owner, name = repo.split("/", 1)
        return owner, name, int(ref.strip().lstrip("#"))
    sys.exit(f"pr_status: cannot parse PR reference: {ref!r}")


def gh_graphql(owner: str, name: str, number: int) -> dict:
    cmd = [
        "gh", "api", "graphql",
        "-f", f"query={QUERY}",
        "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"number={number}",
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"pr_status: gh api failed: {res.stderr.strip()}")
    data = json.loads(res.stdout)
    if data.get("errors"):
        sys.exit(f"pr_status: GraphQL errors: {data['errors']}")
    pr = data["data"]["repository"]["pullRequest"]
    if pr is None:
        sys.exit(f"pr_status: PR {owner}/{name}#{number} not found")
    return pr


BOTS: set[str] = set()


def login(node) -> str:
    node = node or {}
    name = node.get("login") or "ghost"
    if node.get("__typename") == "Bot":
        BOTS.add(name)
    return name


def is_bot(name: str) -> bool:
    base = name.removesuffix("[bot]")
    return (name.endswith(BOT_SUFFIXES) or base in BOTS or base in BOT_LOGINS
            or "copilot" in base or "sentinel" in base)


def reviewer_name(r: dict | None) -> str:
    if not r:
        return "?"
    if r.get("__typename") == "Team":
        return "team:" + (r.get("slug") or r.get("name") or "?")
    return r.get("login") or "?"


def parse_ts(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def age(s: str | None, now: datetime) -> str:
    t = parse_ts(s)
    if not t:
        return "-"
    d = now - t
    days, hours = d.days, d.seconds // 3600
    return f"{days}d {hours}h" if days else f"{hours}h {(d.seconds % 3600) // 60}m"


def snippet(body: str, n: int = 90) -> str:
    body = re.sub(r"<!--.*?-->", "", body or "", flags=re.S)
    one = " ".join(body.split())
    return one if len(one) <= n else one[: n - 1] + "…"


def normalise(pr: dict) -> dict:
    author = login(pr["author"])
    timeline = pr["timelineItems"]["nodes"]
    ready_events = [e for e in timeline if e["__typename"] == "ReadyForReviewEvent"]
    # "Submitted for review" = the first ReadyForReviewEvent if the PR was opened as a
    # draft; otherwise the creation time.
    first_ready = ready_events[0]["createdAt"] if ready_events else (
        None if pr["isDraft"] else pr["createdAt"])

    requested_events = [
        {"at": e["createdAt"], "by": login(e.get("actor")),
         "reviewer": reviewer_name(e.get("requestedReviewer")),
         "kind": "requested" if e["__typename"] == "ReviewRequestedEvent" else "removed"}
        for e in timeline
        if e["__typename"] in ("ReviewRequestedEvent", "ReviewRequestRemovedEvent")
    ]
    pending = [reviewer_name(n["requestedReviewer"]) for n in pr["reviewRequests"]["nodes"]]

    reviews = [
        {"reviewer": login(r["author"]), "state": r["state"], "at": r["submittedAt"],
         "url": r["url"], "inline_comments": r["comments"]["totalCount"],
         "body": snippet(r["body"])}
        for r in pr["reviews"]["nodes"]
    ]

    # Latest decisive state per reviewer (COMMENTED does not override APPROVED / CHANGES_REQUESTED).
    latest: dict[str, dict] = {}
    for r in sorted(reviews, key=lambda r: r["at"] or ""):
        if r["reviewer"] == author:
            continue
        prev = latest.get(r["reviewer"])
        if r["state"] in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED") or prev is None:
            latest[r["reviewer"]] = r
        else:
            prev.setdefault("last_activity", r["at"])
            prev["last_activity"] = r["at"]

    reviewers = sorted(set(latest) | {p for p in pending})
    reviewer_rows = []
    for name in reviewers:
        r = latest.get(name)
        reviewer_rows.append({
            "reviewer": name,
            "requested_at": next((e["at"] for e in requested_events
                                  if e["reviewer"] == name and e["kind"] == "requested"), None),
            "state": "PENDING (re-requested)" if name in pending and r else
                     (r["state"] if r else "PENDING (no review yet)"),
            "last_review_at": (r or {}).get("at"),
            "last_review_url": (r or {}).get("url"),
            "bot": is_bot(name),
        })

    threads = []
    for t in pr["reviewThreads"]["nodes"]:
        cs = t["comments"]["nodes"]
        if not cs:
            continue
        first, last = cs[0], cs[-1]
        threads.append({
            "path": t["path"], "line": t["line"],
            "resolved": t["isResolved"], "outdated": t["isOutdated"],
            "resolved_by": login(t["resolvedBy"]) if t["resolvedBy"] else None,
            "opened_by": login(first["author"]), "opened_at": first["createdAt"],
            "url": first["url"], "first_comment": snippet(first["body"]),
            "replies": t["comments"]["totalCount"] - 1,
            "last_by": login(last["author"]), "last_at": last["createdAt"],
            "author_replied": any(login(c["author"]) == author for c in cs[1:]),
            # Who owes the next move on an unresolved thread.
            "waiting_on": None if t["isResolved"] else (
                "reviewer" if login(last["author"]) == author else "author"),
        })

    conversation = [
        {"by": login(c["author"]), "at": c["createdAt"], "url": c["url"],
         "body": snippet(c["body"]), "bot": is_bot(login(c["author"]))}
        for c in pr["comments"]["nodes"]
    ]

    last_commit = (pr["commits"]["nodes"] or [{}])[0].get("commit") or {}
    rollup = last_commit.get("statusCheckRollup") or {}
    checks = []
    for c in (rollup.get("contexts") or {}).get("nodes", []):
        if c["__typename"] == "CheckRun":
            checks.append({"name": c["name"], "result": c["conclusion"] or c["status"],
                           "url": c["detailsUrl"]})
        else:
            checks.append({"name": c["context"], "result": c["state"], "url": c["targetUrl"]})

    last_commit_at = last_commit.get("committedDate")
    for r in reviewer_rows:
        r["stale_approval"] = bool(r["state"] == "APPROVED" and last_commit_at
                                   and (r["last_review_at"] or "") < last_commit_at)
    for r in reviews:
        r["bot"] = is_bot(r["reviewer"])
    for t in threads:
        t["opened_by_bot"] = is_bot(t["opened_by"])

    truncated = [k for k in ("reviews", "reviewThreads", "comments", "timelineItems")
                 if pr[k]["pageInfo"]["hasNextPage"]]

    return {
        "number": pr["number"], "title": pr["title"], "url": pr["url"],
        "author": author, "state": pr["state"], "draft": pr["isDraft"],
        "base": pr["baseRefName"], "head": pr["headRefName"],
        "created_at": pr["createdAt"], "submitted_for_review_at": first_ready,
        "updated_at": pr["updatedAt"], "merged_at": pr["mergedAt"],
        "merged_by": login(pr["mergedBy"]) if pr["mergedBy"] else None,
        "closed_at": pr["closedAt"],
        "size": {"additions": pr["additions"], "deletions": pr["deletions"],
                 "files": pr["changedFiles"], "commits": pr["commits"]["totalCount"]},
        "last_commit_at": last_commit.get("committedDate"),
        "last_commit_sha": (last_commit.get("oid") or "")[:10],
        "mergeable": pr["mergeable"], "review_decision": pr["reviewDecision"],
        "ci_state": rollup.get("state"), "checks": checks,
        "reviewers": reviewer_rows, "review_request_events": requested_events,
        "reviews": reviews, "threads": threads, "conversation": conversation,
        "truncated": truncated,
    }


def short(s: str | None) -> str:
    """'2026-11-12T14:06:25Z' -> 'Nov 12, 14:06'."""
    t = parse_ts(s)
    return t.strftime("%b %-d, %H:%M") if t else "-"


def thread_lines(t: dict, author: str, now: datetime) -> list[str]:
    loc = t["path"].rsplit("/", 1)[-1] if t["path"] else "-"
    head = (f"- `{short(t['opened_at'])}` [{loc}]({t['url']})"
            + (" _(outdated)_" if t["outdated"] else "")
            + f": {t['first_comment'].replace('|', '/')}")
    if t["waiting_on"] == "author":
        tail = f"🔴 **needs author** (no reply for {age(t['opened_at'], now)})"
    else:
        tail = f"🟡 {t['last_by']} replied `{short(t['last_at'])}`"
    return [head + "  ", f"  ↳ {tail}"]


def render(d: dict) -> str:
    now = datetime.now(timezone.utc)
    author = d["author"]
    state = "DRAFT" if d["draft"] and d["state"] == "OPEN" else d["state"]
    L: list[str] = []
    L.append(f"## [#{d['number']}]({d['url']}) {d['title']}")
    L.append("")
    line = (f"**{state}** · opened `{short(d['created_at'])}` · ready for review "
            f"`{short(d['submitted_for_review_at'])}` · author **{author}**")
    if d["merged_at"]:
        line += f" · merged `{short(d['merged_at'])}` by {d['merged_by']}"
    elif d["closed_at"]:
        line += f" · closed `{short(d['closed_at'])}`"
    L.append(line)
    L.append("")
    L.append(f"_Fetched {now.strftime('%b %-d, %H:%M')} UTC. All times UTC. "
             "Outdated = the code under the comment changed after it was written._")
    L.append("")

    # Humans: everyone with a reviewer row or a thread, minus the author and bots.
    people: list[str] = []
    for name in [r["reviewer"] for r in d["reviewers"]] + [t["opened_by"] for t in d["threads"]]:
        if name != author and not is_bot(name) and name not in people:
            people.append(name)
    for p in people:
        r = next((r for r in d["reviewers"] if r["reviewer"] == p), None)
        theirs = [t for t in d["threads"] if t["opened_by"] == p]
        opn = sorted((t for t in theirs if not t["resolved"]), key=lambda t: t["opened_at"])
        st = r["state"] if r else "no review"
        icon = {"APPROVED": "✅", "CHANGES_REQUESTED": "⛔"}.get(st, "⏳" if st.startswith("PENDING") else "💬")
        L.append(f"### {icon} {p}")
        meta = (f"Requested `{short(r['requested_at'])}`" if r and r["requested_at"] else "Not requested")
        meta += f" · latest: **{st}**"
        if r and r["last_review_at"]:
            meta += f" `{short(r['last_review_at'])}`"
        if r and r.get("stale_approval"):
            meta += " ⚠ approved before the last commit"
        meta += f" · threads: {len(theirs)} ({len(opn)} open)"
        L.append(meta)
        if opn:
            L.append("")
            for t in opn:
                L.extend(thread_lines(t, author, now))
        L.append("")

    bots = [r for r in d["reviewers"] if r["bot"]]
    bot_threads = [t for t in d["threads"] if t["opened_by_bot"]]
    if bots or bot_threads:
        L.append("### 🤖 Bots")
        names = []
        for name in [r["reviewer"] for r in bots] + [t["opened_by"] for t in bot_threads]:
            if name not in names:
                names.append(name)
        for name in names:
            r = next((r for r in bots if r["reviewer"] == name), None)
            th = [t for t in bot_threads if t["opened_by"] == name]
            L.append(f"- {name}: {r['state'] if r else 'no review'}, "
                     f"{len(th)} threads ({sum(not t['resolved'] for t in th)} open)")
        L.append("")

    humans = [c for c in d["conversation"] if not c["bot"]]
    if humans:
        L.append("### PR conversation")
        for c in humans:
            L.append(f"- `{short(c['at'])}` [{c['by']}]({c['url']}): {c['body']}")
        L.append("")

    failing = [c for c in d["checks"] if (c["result"] or "").upper() in
               ("FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED")]
    L.append(f"**CI** {d['ci_state'] or 'no checks'} ({len(d['checks']) - len(failing)}/{len(d['checks'])} passing)"
             f" · **Mergeable** {d['mergeable']} · **Decision** {d['review_decision'] or 'none'}"
             f" · **Last commit** `{short(d['last_commit_at'])}`")
    for c in failing:
        L.append(f"- ❌ [{c['name']}]({c['url']}) — {c['result']}")
    if d["truncated"]:
        L.append("")
        L.append(f"⚠ Lists cut at 100 items: {', '.join(d['truncated'])}. Open the PR for the rest.")
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pr", help="PR URL, owner/repo#N, or bare number")
    ap.add_argument("--repo", default=DEFAULT_REPO, help="repo for a bare PR number")
    ap.add_argument("--json", action="store_true", help="print normalised JSON instead of Markdown")
    a = ap.parse_args()
    owner, name, number = parse_ref(a.pr, a.repo)
    data = normalise(gh_graphql(owner, name, number))
    print(json.dumps(data, indent=2) if a.json else render(data))


if __name__ == "__main__":
    main()
