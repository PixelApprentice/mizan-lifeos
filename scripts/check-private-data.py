#!/usr/bin/env python3
"""Check the exact staged snapshot, or all non-ignored source candidates."""

import argparse
import pathlib
import re
import subprocess
import sys


ROOT = pathlib.Path(__file__).resolve().parent.parent
RUNTIME_NAMES = {"lifeos.json", "focus.json", "sessions.jsonl", "tracker.csv"}
PRIVATE_DIRS = {"log", "logs", "private", "data", "exports", "backups", "screenshots", "recordings", "__pycache__"}
HOME_PATH = re.compile(rb"/(?:home|Users)/[A-Za-z0-9_.-]+/")
SECRET = re.compile(
    rb"(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|"
    rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[A-Z0-9]{16})"
)
DATED_NOTE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")
DATABASE = re.compile(r"\.(?:db|sqlite3?)(?:-(?:wal|shm|journal))?$")
SOURCE_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".rs", ".toml", ".json", ".yaml", ".yml", ".md", ".py", ".sh", ".policy", ".lock", ".svg"}
EXTENSIONLESS = {".gitignore", ".githooks/pre-commit", "src-tauri/.gitignore", "helper/mizan-hosts", "helper/mizan-hosts-perm", "LICENSE"}


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def issues(path, content):
    name = path.name
    is_icon = path.parts[:2] == ("src-tauri", "icons") and path.suffix in {".png", ".ico", ".icns"}
    if path.suffix not in SOURCE_SUFFIXES and path.as_posix() not in EXTENSIONLESS and not is_icon and path.as_posix() != "templates/tracker.csv":
        yield "not an approved source/template file type"
    if path.as_posix() == "templates/tracker.csv":
        if len(content.decode("utf-8").splitlines()) != 1 or not content.startswith(b"date,day,"):
            yield "tracker template must contain its header only"
    elif name in RUNTIME_NAMES:
        yield "personal runtime filename"
    if any(part in PRIVATE_DIRS or part.startswith("backup-") for part in path.parts):
        yield "private/generated directory"
    if DATABASE.search(name) or name.endswith((".jsonl", ".pyc", ".pem", ".key", ".p12", ".pfx")):
        yield "runtime data, cache, or credential file"
    if DATED_NOTE.match(name) or (name.startswith(".env") and name != ".env.example"):
        yield "dated personal note or local environment"
    if HOME_PATH.search(content):
        yield "absolute user home path"
    if SECRET.search(content):
        yield "possible credential"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Check working-tree candidates before staging")
    args = parser.parse_args()
    raw = git("ls-files", "--cached", "--others", "--exclude-standard", "-z") if args.all else git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    names = sorted(set(name.decode("utf-8") for name in raw.split(b"\0") if name))
    errors = []
    for name in names:
        path = pathlib.PurePosixPath(name)
        local = ROOT / path
        if args.all:
            if local.is_symlink():
                errors.append((name, "symlink may point outside the source tree"))
                continue
            if not local.exists():
                continue
            content = local.read_bytes()
        else:
            mode = git("ls-files", "--stage", "--", name).split(b" ", 1)[0]
            if mode == b"120000":
                errors.append((name, "symlink may point outside the source tree"))
                continue
            content = git("show", f":{name}")
        errors.extend((name, message) for message in issues(path, content))
    for name, message in errors:
        print(f"BLOCKED {name}: {message}", file=sys.stderr)
    if errors:
        print("Nothing was uploaded. Remove private material from the proposed snapshot.", file=sys.stderr)
        return 1
    print(f"Privacy check passed for {len(names)} {'candidate' if args.all else 'staged'} files. Review personal prose manually.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
