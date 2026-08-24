# Local LifeOS data

On first use, Mizan creates `lifeos.json`, `log/TEMPLATE.md`, and an empty
`tracker.csv` in the data folder selected in Settings. An empty folder setting
uses `Documents/lifeos` under your home directory (or `MIZAN_DISC` when set).
Existing files and records are never replaced by initialization.

`lifeos.json` stores `start_date` as `YYYY-MM-DD`. A new installation starts
today; change the date in Settings whenever needed. Days and weeks continue
indefinitely, without cycles or a finish date. Before the start, day numbers
are zero or negative and the displayed week remains 1. Changing the start
date changes calculated day numbers, not existing logs or tracker rows.

Customize the local `log/TEMPLATE.md` rather than this repository to keep
personal routines private. Available placeholders: `DATE`, `DAY`, `DAY1`,
`DOW`, `WEEK`, `FASTING`, `FAJR`, `DHUHR`, `ASR`, `MAGHRIB`, and `ISHA`, enclosed
in double braces. A missing log is generated entirely by the app; no shell
scripts are needed.

Prayer times default to `check`; verify times with your local source. Optional
local `monthly_prayers` configuration maps month numbers (`"1"` … `"12"`) to
objects containing `fajr`, `dhuhr`, `asr`, `maghrib`, and `isha` strings.
Other configuration fields are preserved when updating the start date.

The tracker header retains legacy column names for compatibility with existing
data and scoring. It contains no sample records. Keep configuration, logs,
trackers, databases, and personal scripts out of version control.
