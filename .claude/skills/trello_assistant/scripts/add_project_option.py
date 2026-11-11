#!/usr/bin/env python3
"""Add or look up an option on the Content Integration board's Project field.

The Trello MCP can set a custom-field value on a card. It cannot add a
dropdown option. This script talks to the Trello REST API with
TRELLO_API_KEY / TRELLO_TOKEN from the repo-root .env.

Usage:
    python3 add_project_option.py --list
    python3 add_project_option.py --add "InvalidAgeForPaxType"

--add is idempotent: a case-insensitive match on an existing option
prints that option and does not create a duplicate.

Stdout is one JSON object (or a JSON array for --list).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

PROJECT_FIELD_ID = "653bf653d526a0bd397d0850"
API = "https://api.trello.com/1"


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


def option_payload(raw: dict) -> dict:
    value = raw.get("value") or {}
    text = value.get("text") if isinstance(value, dict) else None
    return {
        "id": raw.get("id") or raw.get("_id"),
        "text": text,
        "color": raw.get("color"),
        "pos": raw.get("pos"),
    }


def trello_request(method: str, path: str, key: str, token: str, body: dict | None = None) -> dict | list:
    query = urllib.parse.urlencode({"key": key, "token": token})
    url = f"{API}{path}?{query}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        sys.exit(f"ERROR: {method} {path} -> HTTP {e.code}: {err_body[:400]}")
    except urllib.error.URLError as e:
        sys.exit(f"ERROR: {method} {path} -> {e}")


def list_options(key: str, token: str, field_id: str) -> list[dict]:
    raw = trello_request("GET", f"/customFields/{field_id}/options", key, token)
    if not isinstance(raw, list):
        sys.exit(f"ERROR: expected option array, got {type(raw).__name__}")
    return [option_payload(item) for item in raw]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="Print existing Project options as JSON.")
    parser.add_argument("--add", metavar="NAME", help="Add a Project option named NAME, or return the existing match.")
    parser.add_argument(
        "--field-id",
        default=PROJECT_FIELD_ID,
        help="Custom field id (default: Content Integration Project field).",
    )
    args = parser.parse_args()
    if bool(args.list) == bool(args.add):
        sys.exit("ERROR: pass exactly one of --list or --add")

    repo_root = Path(__file__).resolve().parents[4]
    env = load_env(repo_root)
    key = env.get("TRELLO_API_KEY")
    token = env.get("TRELLO_TOKEN")
    if not key or not token:
        sys.exit("ERROR: TRELLO_API_KEY and TRELLO_TOKEN must be set in .env")

    options = list_options(key, token, args.field_id)
    if args.list:
        json.dump(options, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return

    name = args.add.strip()
    if not name:
        sys.exit("ERROR: --add name is empty")
    needle = name.casefold()
    for option in options:
        text = option.get("text") or ""
        if text.casefold() == needle:
            json.dump({"reused": True, **option}, sys.stdout, indent=2)
            sys.stdout.write("\n")
            return

    created = trello_request(
        "POST",
        f"/customFields/{args.field_id}/options",
        key,
        token,
        body={"value": {"text": name}, "color": "none", "pos": "bottom"},
    )
    if not isinstance(created, dict):
        sys.exit(f"ERROR: expected option object, got {type(created).__name__}")
    json.dump({"reused": False, **option_payload(created)}, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
