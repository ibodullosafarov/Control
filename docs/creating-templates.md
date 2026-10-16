# Day Planner Templates — Reusable Schedule Generators

Templates are reusable `.md` blueprints that live in your Obsidian vault. In Control they do **two** things:

1. **Generate timed calendar events** — turn a routine (e.g. "Daily SAT") into real Day Planner sessions with start/end times, durations, timer and Control Mode preferences. Generated sessions behave exactly like hand-created events: editable, startable, synced to Google Calendar.
2. **Generate Markdown day notes** (classic flow) — fill `Days/YYYY-MM-DD.md` with a checklist for the day.

Templates are blueprints, never execution records: completing sessions never writes back into the template file.

## 1. Where template files live

Inside your configured Obsidian vault (Settings → Obsidian):

```
<vault>/Control/
├── Templates/          ← your templates (*.md)
├── Days/               ← generated day files (YYYY-MM-DD.md)
└── Tasks/              ← task notes (two-way synced checkboxes)
```

Control watches the `Templates/` folder: saving a `.md` file there (from Obsidian or any editor) makes it appear in Control automatically — use the refresh button in the Templates manager if it doesn't.

Template features require the desktop app with a vault selected. In browser mode the template UI explains that Electron is required.

## 2. Creating a template

Three ways, all equivalent:

- **Templates manager → New Template box** — type a name, Create. Writes `Control/Templates/<name>.md` with this skeleton:
  ```md
  ---
  type: control-day-template
  name: <name>
  ---

  # <name>

  ## Morning

  - [ ] First task
    - Duration: 25m
  ```
- **Save a day as a template** — from any open day, "Save … as Template". Copies the structure, resets all checkboxes.
- **Hand-write a file** — create `<vault>/Control/Templates/Anything.md` in Obsidian. Names are sanitized (max 80 chars, no duplicates).
- **Edit in Control** — the pencil button on any template opens the built-in Markdown editor with live preview and validation (see §13). Creating via the name box jumps straight into the editor.

Open any template in Obsidian with the folder icon; duplicate/copy and delete (with confirm) are inline in the manager.

## 3. The schedule-template Markdown format (v2)

Each `##` section is **one schedulable session**, in document order. Checklist lines (`- [ ]`) are notes, not sessions. Unknown `Key:` lines are preserved into the session notes — never silently dropped. Files are treated as data: nothing in a template is ever executed.

```md
---
type: control-day-template
name: Daily SAT
description: Daily SAT preparation routine
version: 2
default-start: 09:00
---

# Daily SAT

## SAT Math
- Questions: 50
- Duration: 60m
- Timer: true
- Control Mode: true
- Mode: Deep Work

## Break
- Duration: 15m

## SAT English
- Questions: 50
- Duration: 60m
- Timer: true
- Control Mode: true

## Break
- Duration: 15m
- Timer: false
- Control Mode: false

## Vocabulary
- Items: 30
- Duration: 30m
- Timer: true
- Control Mode: true
```

### Frontmatter keys

| Key | Required | Meaning |
|---|---|---|
| `type` | No | `control-day-template` for schedule templates (legacy checklist files keep working). |
| `name` | No | Display title override. Default: first `# H1`, else file name. |
| `description` | No | Short description (shown wherever the UI lists templates in future; stored, not displayed in the manager today). |
| `version` | No | `1` (legacy checklist) or `2` (schedule). Unknown versions parse best-effort with a warning. |
| `default-start` | No | Pre-fills the start-time picker (`HH:mm`). Overridable every run. |
| `default-duration` | No | Fallback minutes for sections without their own `Duration`. |

### Session keys (under each `##` heading)

| Key | Required | Meaning & defaults |
|---|---|---|
| `Duration` | Yes (or `default-duration`) | Session length: `60m`, `90`, `1h`, `1h30m`, `1:30`. |
| `Type` | No | `session` (default) or `break`. A heading exactly matching `break`, `rest`, `pause`, `breather`, `coffee` or `lunch` is a break without needing `Type`. |
| `Timer` | No | `true`/`false` (`yes`/`no`, `1`/`0`, `on`/`off` work too). Default: on for sessions, off for breaks. Off dims the session's Start button. |
| `Control Mode` (or `Control`) | No | `true`/`false`. Default: follow the mode's own rules. `false` suppresses website/app blocking for that session; `true` enforces it when the mode has blocklists. |
| `Mode` | No | Control mode by name (matched case-insensitively). Default: your default mode. Breaks prefer a mode literally named `Break`/`Rest` when one exists. |
| `Questions` / `Problems` / `Words` / `Items` / `Cards` / `Pages` / `Sets` / `Reps` | No | Positive whole number, recorded as e.g. `50 questions` in the event description and daily note. |
| `Count` | No | `Count: 50 questions` — number plus free-form label. |
| `Description` / `Notes` | No | Extra text kept in the event description and daily note. Plain prose lines and unknown `Key:` lines are kept too. |

`{{variables}}` work in titles, notes and mode names; you'll be asked for values at apply time (empty keeps the placeholder). Frontmatter is never substituted.

## 4. Generating a schedule (browse → configure → preview → confirm)

1. Open the Day Planner's **Plan** view → Templates manager. Each template shows its title, task/section counts and `{{var}}` badges.
2. Click the green **Schedule** button on a template. The file is re-read fresh, so Obsidian edits apply immediately.
3. The **Generate schedule** dialog opens:
   - **Target date** (defaults to the selected day) and **start time** (defaults to `default-start`, else `09:00`).
   - Template `{{variables}}`, if any.
   - Every session with its computed `HH:mm–HH:mm`, editable title, minutes, counts, Timer checkbox and Control selector (`Follow mode`/`On`/`Off`). Overrides apply to this run only — the `.md` file is never modified.
4. The preview shows total minutes and end time. Problems are explicit:
   - **Template problems** (red) — e.g. a section without `Duration`. Fix the file in Obsidian; generation stays disabled until then.
   - **Overlaps** (amber) — existing events are listed with times. They are never moved or deleted; choose **Add … sessions anyway** or Cancel.
   - **Already applied** (amber) — the date already holds sessions from this template; confirm again only if you mean it.
   - Schedules that would pass midnight are rejected with an error.
5. Confirm creates ordinary calendar events on the target date and records them in the daily note. The button locks while saving, so double-clicks can't duplicate sessions.

## 5. What generated sessions are

Real `ScheduleBlock` events: visible in Day/Week views, movable, editable, deletable, with `originTemplate` (template name) and `originTemplateAppliedAt` recorded on each block. Editing a generated event never touches the template; editing the template never rewrites generated events (re-apply explicitly if you want the new version).

## 6. Timers and Control Mode

- Press the play button on any generated session to start it through the normal timer flow (durations come from the block). Sessions with `Timer: false` show a dimmed, disabled Start button.
- `Control Mode: false` suppresses website/app blocking for that session; `true` enforces it when the mode has blocklists; unset follows the mode. Break phases always unblock, as usual.
- Generating a schedule never starts timers, never touches blocking, and never interrupts an active session — even for tomorrow's date. Switching sessions mid-run follows the app's existing single-session guard.

## 7. Daily notes and progress

Generating a schedule writes a section to `Control/Days/YYYY-MM-DD.md`:

```md
## Generated Schedule — Daily SAT (2026-10-12)
- 09:00–10:00 · SAT Math (50 questions)
- 10:00–10:15 · Break
```

- Only that section is touched: prose, checklists, frontmatter and other sections are preserved verbatim. Re-applying **replaces** the old generated section instead of stacking duplicates. A missing day file is created with minimal `type: control-day` frontmatter.
- Lines are plain bullets on purpose — completion lives on the calendar events, so the note can't disagree with the planner about "done".
- If no vault is configured, or the note write fails, the schedule is still safe: events are persisted first, the note second, and you'll get a notice explaining what happened.
- Progress survives restarts because it lives on the calendar events (persisted in `~/.control-app/data.json`), exactly like hand-created events.

## 8. Google Calendar sync

Generated sessions sync exactly like hand-created Day Planner events — no separate path:

- They are created through the normal save pipeline with fresh timestamps, so the sync engine picks them up on its next debounced run and pushes eligible ones to Google.
- Never forge Google IDs/ETags: the engine assigns mappings via its `controlBlockId` property. Moving or editing a generated event preserves its mapping.
- Event titles show the clean display name (see §16): a trailing `DD.MM.YYYY` date suffix is
  stripped for the Google title, while the full title is stashed privately on the event so pulls
  restore it without sync churn. Titles you edit directly in Google Calendar are respected, not reverted.
- Sync failures never lose the local schedule — events stay in the Day Planner and retry with backoff. Check status/errors in Settings → Google Calendar (Copy diagnostics helps troubleshoot).

## 9. The classic checklist flow (unchanged)

**Apply** (blue button) still fills `Days/YYYY-MM-DD.md` from a template: checkboxes reset, `# H1` becomes the date heading, frontmatter records `template:` and `date:`. It replaces the day file after a warning. Use it for Markdown-first days; use **Schedule** when you want timed, startable, synced sessions.

## 10. Troubleshooting

| Symptom | Cause & fix |
|---|---|
| Template missing from the list | File must be directly in `<vault>/Control/Templates/` ending `.md`; check the vault path in Settings → Obsidian; use the manager refresh. |
| "Section X has no usable Duration" | Add `- Duration: 60m` (or `default-duration` in frontmatter). Checklist-only legacy templates need durations to generate times. |
| "Invalid Duration/Timer/…" | See the format table above; values like `soon` or `perhaps` are rejected with the section and field named. |
| Schedule button does nothing / Electron required | Template scheduling needs the desktop app with a vault selected (browser mode can't read files). |
| Overlaps flagged | Informational — add alongside or Cancel. Overlapping creation is allowed; nothing is auto-moved. |
| "Would end after midnight" | Shorten a duration or start earlier; same-date schedules only. Absolute-time tasks ending before they start are rejected the same way. |
| "names no mode" / unknown mode | Add `Mode: {Exact Mode Name}` (built-ins and custom modes both work) or pick one in the apply dialog — nothing is auto-substituted. |
| Sessions didn't sync to Google | They sync as ordinary events on the next run; check Settings → Google Calendar status, sync errors, and the 45-day/import rules there. |
| Note not updated | Events are still safe; reconnect the vault or check write permissions, then re-apply (section replacement keeps it duplicate-free). |
| Scheduled session never started | Check Settings → Automatic Control Execution is enabled, the event has a valid mode and timer enabled, and no manual session was running (it always wins). States and skip reasons are listed there. |
| No reminder notification | The section reports when notifications are unavailable; on macOS check System Settings → Notifications → Control. |
| Event length flagged vs control length | Single-block mode events should match the mode's Work minutes — use Snap, fix the time, or pick another mode. Multi-cycle modes are exempt by design. |

## 11. Current limitations

- One schedule per generation run, same-date only (no cross-midnight schedules).
- Checklist (`- [ ]`) lines are notes, not sessions — each `##` section is exactly one session.
- Overlap detection compares same-date `HH:mm` ranges; overnight events spanning midnight may not be flagged.
- `Control Mode: true` still needs blocklists on the resolved mode to enforce anything.
- Per-run overrides never write back to the template file.
- The Templates manager lists name/counts/dates; `description` is stored but not yet displayed there.
- Automatic execution needs the app running (open, hidden, or menu-bar); fully quitting stops it, and missed starts older than 10 minutes are skipped, never launched late.

## 12. Absolute-time templates (flex format)

For routines with fixed clock times, write one `#` task per session with `## Time` and `## Blocking` subsections.
The green **Schedule** button detects this format automatically and opens the timed apply dialog;
duration-style templates (§3) open the sequencing dialog instead.

Each task becomes its own calendar event: one heading, one event, no hidden splitting or merging.

```md
{{date}} Day Plan

# English 50

## Time
13:30-15:45

## Blocking
Mode: {Quick}

# SAT Math 50

## Time
16:00-17:30

## Blocking
Mode: {Deep Study}

# Vocabulary 30

## Time
17:45-18:15
```

Rules:

- Each `#` heading is one task (title verbatim). Everything before the first task is preamble.
- `## Time` (any capitalization) holds one range: `13:30-15:45` (`-`, `–` and `—` all work, spaces allowed),
  or `Start: HH:mm` / `End: HH:mm` lines. Missing or malformed times block application with the task named.
- `## Blocking` holds `Mode: {Mode Name}` (braces optional). The name must match a real Control mode —
  built-in or custom, case-insensitively — and resolves to its live configuration (durations, cycles,
  colors, blocklists) at apply time, so later mode edits apply automatically. Unknown or missing modes
  block application until you pick a valid mode in the dialog; nothing is silently substituted and no
  fake modes are created.
- End must be after start: cross-midnight ranges (e.g. `23:00-01:00`) are rejected — split them into two tasks.
- `{{date}}` resolves to the target date wherever it appears (titles, notes). Other `{{variables}}`
  are asked for at apply time. Frontmatter (`name:`, `description:`) is honored when present.
- Any other `##` sections, paragraphs, lists and formatting are kept as task notes and saved into the
  event description. Templates are data: nothing in them is ever executed.

Applying: pick the target date → review fixed times and resolved modes (override any mode per task,
adjust any task's start/end times inline without editing the file) → see overlap, re-apply and
duration-match warnings → choose **add alongside** or **replace** (§14) → confirm.
Validation failures create zero events (atomic).

### Single-block modes and matching durations

A study mode with **Cycles = 1** represents exactly one control block: create one in the Modes manager
(e.g. `25 English` with 30 minutes of Work), and it runs a single control cycle with no trailing break
timer. Multi-cycle modes are unchanged — mid-run work phases still take breaks.

When a single-block (non-chill, one-cycle) mode is resolved, each scheduled event should last exactly
its control duration — a 30-minute `25 English` belongs in a 30-minute event. The apply dialogs check
this and warn per event (“SAT English is scheduled 45m, but single-block mode 25 English controls
30m”), with a one-click **Snap to 30m** fix. Mismatches never block and nothing is stretched or shifted
automatically; multi-cycle modes are never flagged. In the timed dialog, adjust any start/end time
directly; in the sequencing dialog, adjust Minutes.

Scheduled breaks live *between* events — as gaps in the timetable or explicit break events — never as
a trailing timer inside a single-block session. A finished one-cycle session completes immediately, so
back-to-back template events (e.g. ending 14:25, next starting 14:30) hand off cleanly, including under
automatic execution, which starts exactly one cycle per event and finishes it at the event's end.

Example — single-block modes `25 English` (30 min control), `25 Math` (20 min) and `30 Vocab` (15 min),
each event matching its control length:

```md
# {{date}} Day Plan

# SAT — English (25 questions)

## Time
13:30 - 14:00

## Blocking
Mode: {25 English}

# SAT — Math (25 questions)

## Time
14:05 - 14:25

## Blocking
Mode: {25 Math}

# SAT — English (25 questions)

## Time
14:30 - 15:00

## Blocking
Mode: {25 English}

# SAT — Math (25 questions)

## Time
15:05 - 15:25

## Blocking
Mode: {25 Math}

# SAT — Vocabulary (30 words)

## Time
15:30 - 15:45

## Blocking
Mode: {30 Vocab}
```

There is no `Cycles` field in any template format, and there never was: generators always create
one-cycle blocks, and older checklist templates need no changes.

## 13. Template editor

The pencil button on any template (or right after Create) opens the in-app editor:

- Free-form Markdown textarea — headings, paragraphs, lists, metadata, anything.
- Live preview parses as you type: detected tasks with times and modes, plus every validation error
  with task/field context. Duration-style (§3) files show a hint instead of tasks.
- `+ Example task` appends a starter snippet. Saving writes the file **verbatim** — formatting is
  never rewritten. Creating with an already-taken name is refused (edit that file instead).
- Obsidian stays fully usable: external edits appear via the file watcher, and the folder icon opens
  the file there.

## 14. Merge or replace on apply

Timed application offers an explicit strategy when the target date already has events:

- **Add alongside** (default): existing events are never moved, edited or deleted; overlaps are shown
  before you confirm.
- **Replace all events on the date**: removes every existing event on that date, then adds the generated
  ones — in a single save, so a validation failure can never leave a partial schedule. Requires an
  explicit acknowledgment checkbox. Events synced with Google Calendar are flagged in the dialog: their
  remote copies are deleted on the next sync. Generated events are ordinary blocks afterwards, and
  re-applying is duplicate-safe via the already-applied warning.

## 15. Automatic study-day execution

Settings → **Automatic Control Execution** turns the Day Planner into an executor:

- **Enable** the toggle and set the reminder lead time (default **5 minutes**, 1–120).
- 5 (or N) minutes before each eligible session, Control sends a native macOS notification —
  e.g. “Time to lock in. English 50 starts in 5 minutes.” — at most once per occurrence, never as a stale backlog.
- At the start time, Control launches the session through the normal control engine with the event's
  mode (durations, cycles, blocklists) and timer, visible in the timer tab and menu bar. Single-block
  modes run exactly one control cycle — no extra cycles, no automatic break spilling into the next event.
- At the scheduled end, the auto-started session finishes through the normal completion path
  (blockers cleaned up, history recorded) and its planner block is marked completed. Because one-cycle
  sessions already end right after their work phase, back-to-back events hand off with the app ready
  for the next block.
- The section lists today's sessions with live states: Scheduled, Reminder sent, Starting…, In session,
  Done, Skipped (with reason) and Failed.

Eligible sessions need a start/end time, a valid mode, an enabled timer and a pending status
(`proposed`/`approved`/`synced`); completed, timer-disabled, all-day and mode-less events are skipped
with a recorded reason. A manually started session always wins — scheduled starts back off and are
recorded as skipped. Overlapping or back-to-back contention never launches two sessions at once.

Missed-event rules (conservative by design): starts happen at most ~10 minutes after the scheduled
time (documented grace period); several missed at once are all skipped, never launched in sequence;
waking after the window skips stale notifications; quitting the app stops execution and the next
launch reconciles safely without firing old events.

Background requirements (honest limits): execution runs while Control is open, hidden, or minimized
to the menu bar — the scheduler lives in the main process with per-minute reconciliation plus
sleep/wake handling. Fully quitting stops everything; enable macOS login startup (Settings) to cover
restarts. If macOS blocks notifications, the section says so — enable them in System Settings →
Notifications → Control. Execution state persists across restarts, so notifications and sessions are
never duplicated.

Blocking is verified, not assumed: when a session starts, Control checks whether any website/app
list was actually engaged. If enforcement was requested but failed (e.g. a cancelled admin prompt),
you get an immediate notification saying the timer runs without blocking — a running timer never
silently pretends to block. Auto-started sessions record the outcome, shown per occurrence as
“no blocking” or “blocking failed” in the status list.

## 16. Recurring tasks and clean display titles

Daily routines reuse one clean name (“25 Math questions 1”) while each Obsidian note stays unique via
a trailing `DD.MM.YYYY` date suffix (“25 Math questions 1 11.10.2026”):

- Control's Tasks tab, Planner tab, daily-note schedule lines and Google Calendar titles all show the
  **clean** title — the suffix is stripped for display only.
- The full title (with suffix) stays stored on the task, the planner event and the note file. Notes
  are identified by their frontmatter id (never by cleaned title), so identical clean titles remain
  separate tasks linked to their own notes across imports, edits, deletions and syncs.
- Editing a task title edits the clean name; the note's original suffix is re-attached automatically,
  so the same Obsidian note is updated — never renamed, overwritten, or cross-linked. Typing a new
  valid suffix replaces it deliberately.
- When two tasks genuinely share a title, new notes are disambiguated with the task's own creation
  date (“Name 12.10.2026”) instead of an opaque id fragment. Only a valid trailing `DD.MM.YYYY`
  counts — mid-title dates and unrelated numbers are never stripped or doubled.
