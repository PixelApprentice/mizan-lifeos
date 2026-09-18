#!/usr/bin/env python3
"""Set one version everywhere it is declared, so desktop, phone and package metadata never drift.

    python3 scripts/bump-version.py 0.3.0        # set an explicit version
    python3 scripts/bump-version.py minor        # 0.2.0 -> 0.3.0 (also: major, patch)
    python3 scripts/bump-version.py --check      # exit 1 if the files disagree (CI)

Android versionCode is derived (MAJOR*10000 + MINOR*100 + PATCH) so it always increases.
The browser extension and the data formats have their own version tracks: see docs/release/versioning.md.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$")
FILES = {
    "package.json": (r'("version":\s*")([^"]+)(")', 1),
    "src-tauri/tauri.conf.json": (r'("version":\s*")([^"]+)(")', 1),
    "src-tauri/Cargo.toml": (r'(\[package\]\nname = "mizan"\nversion = ")([^"]+)(")', 1),
    "src-tauri/Cargo.lock": (r'(name = "mizan"\nversion = ")([^"]+)(")', 1),
    "android/app/build.gradle.kts": (r'(versionName = ")([^"]+)(")', 1),
}
GRADLE_CODE = re.compile(r"(versionCode = )(\d+)")


def current():
    found = {}
    for rel, (pattern, _) in FILES.items():
        m = re.search(pattern, (ROOT / rel).read_text())
        if not m:
            sys.exit(f"{rel}: version field not found")
        found[rel] = m.group(2)
    return found


def code_of(version):
    major, minor, patch = (int(x) for x in SEMVER.match(version).groups()[:3])
    if minor > 99 or patch > 99:
        sys.exit("minor and patch must stay below 100 for the Android versionCode scheme")
    return major * 10000 + minor * 100 + patch


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    found = current()
    versions = set(found.values())
    if sys.argv[1] == "--check":
        gradle = (ROOT / "android/app/build.gradle.kts").read_text()
        code = int(GRADLE_CODE.search(gradle).group(2))
        ok = len(versions) == 1 and code == code_of(next(iter(versions)))
        for rel, v in found.items():
            print(f"{v:>12}  {rel}")
        print(f"{code:>12}  android versionCode")
        sys.exit(0 if ok else "versions disagree; run scripts/bump-version.py <version>")
    base = max(versions, key=lambda v: tuple(int(x) for x in SEMVER.match(v).groups()[:3]))
    major, minor, patch = (int(x) for x in SEMVER.match(base).groups()[:3])
    arg = sys.argv[1]
    new = {"major": f"{major + 1}.0.0", "minor": f"{major}.{minor + 1}.0", "patch": f"{major}.{minor}.{patch + 1}"}.get(arg, arg)
    if not SEMVER.match(new):
        sys.exit(f"not a semantic version: {new}")
    for rel, (pattern, _) in FILES.items():
        path = ROOT / rel
        path.write_text(re.sub(pattern, lambda m: m.group(1) + new + m.group(3), path.read_text(), count=1))
    gradle = ROOT / "android/app/build.gradle.kts"
    gradle.write_text(GRADLE_CODE.sub(lambda m: m.group(1) + str(code_of(new)), gradle.read_text(), count=1))
    print(f"{base} -> {new} (Android versionCode {code_of(new)})")
    print("Next: update CHANGELOG.md, commit, then tag:  git tag -s v%s -m 'Mizan %s'" % (new, new))


if __name__ == "__main__":
    main()
