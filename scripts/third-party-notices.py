#!/usr/bin/env python3
"""Regenerate THIRD_PARTY_NOTICES.md from the lockfiles (npm prod deps, Rust normal deps, Android).

    python3 scripts/third-party-notices.py          # write THIRD_PARTY_NOTICES.md
    python3 scripts/third-party-notices.py --check  # exit 1 if a dependency has a licence we have not approved

Works offline once `cargo fetch` and `pnpm install` have run.
"""

import collections
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Licences that allow both AGPL and proprietary (commercial-licence) redistribution.
APPROVED = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "0BSD", "Unlicense", "CC0-1.0",
    "MIT-0", "BSL-1.0", "Unicode-3.0", "Unicode-DFS-2016", "OFL-1.1", "MPL-2.0", "LLVM-exception",
    "Apache-2.0 WITH LLVM-exception",
}
ANDROID = [
    ("androidx.core:core-ktx", "Apache-2.0", "all"),
    ("androidx.activity:activity-ktx", "Apache-2.0", "all"),
    ("org.jetbrains.kotlin:kotlin-stdlib", "Apache-2.0", "all"),
    ("com.google.android.gms:play-services-code-scanner", "Proprietary (Android Software Development Kit License)", "play flavour only"),
]


def npm():
    out = subprocess.check_output(["pnpm", "licenses", "list", "--prod", "--json"], cwd=ROOT, stderr=subprocess.DEVNULL)
    rows = []
    for lic, pkgs in json.loads(out).items():
        for p in pkgs:
            rows.append((p["name"], ", ".join(p.get("versions", [])) or p.get("version", ""), lic))
    return sorted(set(rows))


def cargo():
    out = subprocess.check_output(
        ["cargo", "metadata", "--format-version", "1", "--offline", "--filter-platform", "x86_64-unknown-linux-gnu"],
        cwd=ROOT / "src-tauri", stderr=subprocess.DEVNULL,
    )
    meta = json.loads(out)
    pkgs = {p["id"]: p for p in meta["packages"]}
    nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
    root = meta["resolve"]["root"]
    seen, stack = set(), [root]
    while stack:
        cur = stack.pop()
        if cur in seen:
            continue
        seen.add(cur)
        for dep in nodes[cur]["deps"]:
            if any(k["kind"] is None for k in dep["dep_kinds"]):
                stack.append(dep["pkg"])
    seen.discard(root)
    return sorted({(pkgs[i]["name"], pkgs[i]["version"], pkgs[i].get("license") or "SEE LICENSE FILE") for i in seen})


def parts(expr):
    return {t for t in re.split(r"\s+(?:OR|AND)\s+|[()/]", expr.replace(" / ", "/")) if t.strip()}


def ok(expr):
    # "A OR B": one approved alternative is enough. "A AND B": all must be approved.
    expr = expr.replace("/", " OR ")
    if " AND " in expr and " OR " not in expr:
        return all(t.strip() in APPROVED for t in parts(expr))
    alternatives = re.split(r"\s+OR\s+", expr.strip("() "))
    return any(all(t.strip(" ()") in APPROVED for t in re.split(r"\s+AND\s+", alt)) for alt in alternatives)


def main():
    js, rs = npm(), cargo()
    bad = [(n, v, l) for n, v, l in js + rs if not ok(l)]
    if "--check" in sys.argv:
        for n, v, l in bad:
            print(f"unapproved licence: {n} {v}: {l}")
        sys.exit(1 if bad else 0)
    summary = collections.Counter(l for _, _, l in js + rs)
    lines = [
        "# Third-party notices",
        "",
        "Mizan bundles the open-source components below. Each keeps its own licence; the full texts ship inside",
        "the packages (`node_modules/*/LICENSE`, `~/.cargo/registry/src/*/*/LICENSE*`). Regenerate with",
        "`python3 scripts/third-party-notices.py`; CI runs it with `--check`.",
        "",
        "Fonts (Press Start 2P, Silkscreen, VT323) are under the SIL Open Font License 1.1. System libraries",
        "(WebKitGTK, GTK, glib, libsoup) are LGPL and linked dynamically from the user's system, not bundled.",
        "",
        "## Summary",
        "",
        "| Licence | Packages |",
        "|---|---|",
        *[f"| {l} | {c} |" for l, c in summary.most_common()],
        "",
        "## Android companion",
        "",
        "| Package | Licence | Included in |",
        "|---|---|---|",
        *[f"| {n} | {l} | {w} |" for n, l, w in ANDROID],
        "",
        f"## JavaScript (production, {len(js)})",
        "",
        "| Package | Version | Licence |",
        "|---|---|---|",
        *[f"| {n} | {v} | {l} |" for n, v, l in js],
        "",
        f"## Rust (desktop app, Linux build, {len(rs)})",
        "",
        "| Crate | Version | Licence |",
        "|---|---|---|",
        *[f"| {n} | {v} | {l} |" for n, v, l in rs],
        "",
    ]
    (ROOT / "THIRD_PARTY_NOTICES.md").write_text("\n".join(lines))
    print(f"wrote THIRD_PARTY_NOTICES.md: {len(js)} npm, {len(rs)} crates, {len(bad)} unapproved")


if __name__ == "__main__":
    main()
