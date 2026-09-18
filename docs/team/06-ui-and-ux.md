# 6. UI and UX

Team workspaces must feel like the same app, but you should never be unsure which
space you are in.

## Space switcher

At the top of the sidebar, above the current navigation:

```text
┌──────────────────────────┐
│ ● Personal          ⌄    │  ← click or Ctrl+Shift+S
├──────────────────────────┤
│ ✓ ● Personal       Alt+0 │
│   ■ Acme Eng       Alt+9 │  (accent: workspace colour)
│   ■ Side project         │
│   + Join or create…      │
└──────────────────────────┘
```

- **Personal** keeps Mizan's green accent. Each workspace picks its own accent, and the
  whole UI accent (focus rings, active nav item, buttons) switches with the space.
  A thin coloured top border and the workspace name in the title bar
  (`Mizan — Acme Eng`) make the active space obvious, for example while screen-sharing.
- Unread notification counts show as dots next to each workspace.
- The last view per space is remembered, so switching back returns to where you were.
- Switching is instant because replicas are local.

## Navigation per space

| Personal (unchanged) | Team workspace |
|---|---|
| plan: Today, Log, Planner, Projects, Tasks | **Inbox**, **My issues** |
| do: Focus | **Projects** (list of projects → Board / Backlog / List / Timeline tabs) |
| review: Stats | **Views** (saved boards and filters) |
| system: Settings | **Reports**, **Members**, **Settings** |

`Alt+1…8` switches views within the current space, as today. Global items stay
reachable from both spaces: the **Focus timer** (the sidebar mini-timer keeps running
across spaces), **Quick capture** and **Exit**.

## Project page

```text
ENG · Engineering            [Board] Backlog  List  Timeline   ⚙
Sprint 14 · 6 days left · 21/34 pts   ▁▂▃▅▆  [Complete sprint]
──────────────────────────────────────────────────────────────────
Filter: [Assignee ▾] [Type ▾] [Label ▾] [Only mine]     Group: Assignee ▾
┌ To do (5) ─────┐ ┌ In progress 3/4 ┐ ┌ In review ─────┐ ┌ Done ──────────┐
│ ENG-51  Bug  ● │ │ ENG-44 Story ◐  │ │ ENG-39         │ │ ENG-30 ✓       │
│ Login loops    │ │ Export CSV      │ │ Rate limiter   │ │ ...            │
│ ▲ High · 3pt AB│ │ 5pt · 2/4 ☑ CD │ │ 2pt  EF        │ │                │
└────────────────┘ └─────────────────┘ └────────────────┘ └────────────────┘
```

- The board is the shared `Board<T>` from the personal Projects view: same drag feel,
  same column scroll cap, same keyboard alternative (the ↑/↓ buttons and status select on each card).
- Clicking a card opens the **issue panel** on the right (the board stays visible).
  `Esc` closes it, and `Shift+Enter` or the expand icon opens the full page.
- Empty states teach: an empty board shows "Press **C** to create your first issue, or paste a list."

## Issue panel

```text
ENG-44  Story                                   ⤢  🔗  👁 3  ⋯
Export CSV from reports
────────────────────────────────────────────────────────────
Status   [In progress ▾]      Assignee  [Chris D ▾]
Priority [High ▾]             Sprint    [Sprint 14 ▾]
Estimate [5]                  Due       [Oct 18]
Labels   [reports] [+]        Parent    ENG-12 Reporting epic
────────────────────────────────────────────────────────────
Description (Markdown, click to edit)
☑ Checklist 2/4      ▸ Subtasks (1)      ▸ Links (blocks ENG-50)
────────────────────────────────────────────────────────────
[Comments] History  Worklog
  Ana · 2h   Can we include the timezone column?
  > Write a comment… (@ to mention)
────────────────────────────────────────────────────────────
[▶ Focus on this]  [📅 Schedule in my planner]   ← the bridge, personal only
```

The two bridge buttons say what they do and never post to the team by
themselves: **Focus on this** starts a personal focus session, and at the end asks
whether to log time. **Schedule** opens the existing `ScheduleDialog` and writes
to the personal calendar.

## Keyboard (team spaces)

Linear-style single keys while no input is focused:

| Key | Action |
|---|---|
| `C` | Create issue |
| `/` | Focus the filter bar |
| `J` / `K` | Next / previous issue |
| `Enter` / `Esc` | Open / close the issue panel |
| `S` | Set status |
| `A` | Assign (`I` assigns to me) |
| `P` | Set priority |
| `L` | Labels |
| `E` | Estimate |
| `X` | Select for bulk edit |
| `Ctrl+K` | Command palette (scoped to the current space, plus "Switch to…") |
| `Ctrl+Shift+S` | Space switcher |
| `G` then `I` / `M` / `B` / `L` | Go to Inbox, My issues, Board, Backlog |

## Personal space additions

Small and opt-in, all through the bridge:

- **Today:** a collapsible "Team" card with issues assigned to you that are due soon
  or in the active sprint, grouped by workspace (with workspace colour dots). Hidden
  when you have no workspaces.
- **Planner:** a toggle in the auto-plan box, **include team issues**, and team issues
  in the unscheduled list marked with their key (`ENG-44`).
- **Focus:** the task picker can search team issues assigned to you. After the
  session, a confirm dialog offers to log the time (you can turn this prompt off per workspace).
- **Stats:** unchanged. It never shows team data.

## Onboarding

1. **Create a workspace:** name, colour, then "Host on this computer" or "Use a
   server" (URL), then first project name and method (Kanban/Scrum). That's all.
2. **Invite:** a QR or link with a role picker. The same QR pattern as the phone companion, so it feels familiar.
3. **Join:** paste or scan the link, confirm the workspace name and host fingerprint,
   choose a display name, and the first sync runs with a progress bar.
4. A first-run tour of three tips: the space switcher, `C` to create, and the bridge buttons.

## Visual language

- Same tokens as personal: dark surfaces, monospace text, pixel icons and compact density.
- Team-specific elements: avatars (initials on the member colour), status pills
  coloured by category (grey todo, blue doing, green done, red canceled), priority icons
  (pixel bars), and issue type icons (pixel glyphs: epic ⚡, story ▣, task ☐, bug ✱, subtask ↳).
- Responsive: the same compact-window behaviour as personal (navigation becomes a menu).
  The board scrolls horizontally on narrow widths.

## Decisions locked in

1. One app, a space switcher, a per-space accent colour and the space name always visible.
2. Personal navigation and shortcuts are unchanged. Team spaces get Linear-style single-key shortcuts.
3. Issue detail opens as a side panel by default.
4. Bridge actions are visible buttons that never post to the team without a confirmation.
