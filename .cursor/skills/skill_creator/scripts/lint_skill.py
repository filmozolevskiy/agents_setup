#!/usr/bin/env python3
"""Lint a project-local skill against the conventions in skill_creator.

Checks performed for skill <name>:

1. `.cursor/skills/<name>/SKILL.md` exists, parses YAML frontmatter, has a
   `name:` (kebab-case) and a `description:` that starts with "Use when".
2. `.claude/commands/<name>.md` exists and points at the SKILL.md.
3. `CLAUDE.md` § Skill routing contains a row for the skill.
4. `.cursor/rules/global_setup.md` § Skill routing contains a row for the
   skill.

Usage::

    python3 .cursor/skills/skill_creator/scripts/lint_skill.py <name>

Exit code is the number of failed checks (0 = clean).

The script is intentionally dependency-free (stdlib only) so it runs in
any environment that already has Python 3.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def _read(path: Path) -> str | None:
    try:
        return path.read_text()
    except FileNotFoundError:
        return None


def _parse_frontmatter(text: str) -> dict[str, str] | None:
    """Minimal YAML frontmatter parser — handles the keys this lint cares
    about (`name`, `description`) including folded scalars (`>-`)."""
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    body = text[3:end].strip("\n")
    fields: dict[str, str] = {}
    current_key: str | None = None
    current_lines: list[str] = []
    for line in body.splitlines():
        match = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if match and not line.startswith(" "):
            if current_key is not None:
                fields[current_key] = " ".join(
                    s.strip() for s in current_lines if s.strip()
                )
            current_key = match.group(1)
            value = match.group(2).strip()
            if value in (">-", ">", "|", "|-"):
                current_lines = []
            else:
                fields[current_key] = value
                current_key = None
                current_lines = []
        elif current_key is not None:
            current_lines.append(line)
    if current_key is not None:
        fields[current_key] = " ".join(
            s.strip() for s in current_lines if s.strip()
        )
    return fields


def lint(name: str) -> list[str]:
    failures: list[str] = []

    skill_path = REPO_ROOT / ".cursor" / "skills" / name / "SKILL.md"
    skill_text = _read(skill_path)
    if skill_text is None:
        return [f"missing: {skill_path.relative_to(REPO_ROOT)}"]

    fm = _parse_frontmatter(skill_text)
    if fm is None:
        failures.append(f"{skill_path.relative_to(REPO_ROOT)}: no YAML frontmatter")
    else:
        fm_name = fm.get("name", "")
        if not fm_name:
            failures.append(
                f"{skill_path.relative_to(REPO_ROOT)}: frontmatter `name:` missing"
            )
        elif not re.fullmatch(r"[a-z0-9-]+", fm_name):
            failures.append(
                f"{skill_path.relative_to(REPO_ROOT)}: frontmatter `name:` "
                f"must be lowercase / hyphen / digits only (got {fm_name!r})"
            )
        elif len(fm_name) > 64:
            failures.append(
                f"{skill_path.relative_to(REPO_ROOT)}: frontmatter `name:` "
                f"exceeds 64 chars"
            )

        description = fm.get("description", "")
        if not description:
            failures.append(
                f"{skill_path.relative_to(REPO_ROOT)}: frontmatter "
                f"`description:` missing"
            )
        elif not description.lower().startswith("use when"):
            failures.append(
                f"{skill_path.relative_to(REPO_ROOT)}: `description:` must "
                f"start with 'Use when' (got {description[:40]!r}…)"
            )

    wrapper_path = REPO_ROOT / ".claude" / "commands" / f"{name}.md"
    wrapper_text = _read(wrapper_path)
    if wrapper_text is None:
        failures.append(f"missing: {wrapper_path.relative_to(REPO_ROOT)}")
    else:
        target = f".cursor/skills/{name}/SKILL.md"
        if target not in wrapper_text:
            failures.append(
                f"{wrapper_path.relative_to(REPO_ROOT)}: does not reference "
                f"`{target}`"
            )

    claude_md = _read(REPO_ROOT / "CLAUDE.md") or ""
    if name not in claude_md:
        failures.append(
            f"CLAUDE.md: no routing row mentioning `{name}` "
            f"(add to § Skill routing)"
        )

    rules_md = _read(REPO_ROOT / ".cursor" / "rules" / "global_setup.md") or ""
    if name not in rules_md:
        failures.append(
            f".cursor/rules/global_setup.md: no routing row mentioning "
            f"`{name}` (add to § Skill routing)"
        )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "name",
        help="Skill folder name (snake_case), e.g. `bookability_analysis`",
    )
    args = parser.parse_args()

    failures = lint(args.name)
    if not failures:
        print(f"OK: {args.name} passes all checks")
        return 0
    print(f"FAIL: {args.name} ({len(failures)} issue(s))")
    for line in failures:
        print(f"  - {line}")
    return len(failures)


if __name__ == "__main__":
    sys.exit(main())
