# Security policy

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's *Report a vulnerability* (private security advisory) on the repository, or email **security@<your-domain>** (maintainer: set before publishing).
- We acknowledge reports within 7 days.
- We aim to fix high-severity issues within 30 days, and credit you unless you prefer otherwise.

Supported versions: the latest minor release. Before 1.0, only the newest 0.x release gets fixes.

## Threat model in brief

Mizan is local-first. Without your action, nothing leaves your computer.

| Surface | Exposure | Protection |
|---|---|---|
| Desktop app (Tauri webview) | Local only | Strict Content-Security-Policy, no remote code, SQLite in the app data folder |
| Phone companion server (port 47615) | Your LAN, **only while enabled** in Settings | Pairing code of 128+ random bits, required on every request. Unpairing invalidates it. |
| Team host (port 47616) | Your LAN, **only while hosting is on** | Single-use invites of 128 bits that expire after 7 days. Per-member bearer tokens, stored only as SHA-256 hashes. Role checks on every operation on the host. Request size and concurrency limits. |
| Focus blocking helper (`helper/mizan-hosts`) | Root, via polkit | Writes only Mizan's marked block in `/etc/hosts`. Inputs are validated as hostnames. |
| Browser extension | Your browser | Talks only to the local native host. No remote servers. |

## Known limitations (read before using team hosting on untrusted networks)

- **Plain HTTP on the LAN.** Tokens and team data travel unencrypted between devices. Anyone who can sniff the same Wi-Fi, such as an open café network, could read them. Use team hosting on networks you trust, a phone hotspot or USB, or a VPN such as WireGuard or Tailscale between teammates. TLS with pinned self-signed certificates is on the roadmap.
- **No end-to-end encryption at rest.** Workspace files (`team/*.db`) and the personal database are ordinary files protected by your OS account. Use full-disk encryption.
- **The host is trusted.** The person hosting a workspace can read and change all of its data. That is the same trust as a self-hosted Jira server.
- **Signing.** Release artifacts must be signed with the maintainer's keys (see [docs/release/deploy.md](docs/release/deploy.md)). Builds labelled "debug" are for testing only.
