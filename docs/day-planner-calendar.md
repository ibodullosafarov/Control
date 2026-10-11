# Day Planner Calendar — Interactions

The Day and Week views are a directly manipulable calendar. Everything below works with the mouse; touch keeps native scrolling. All visual states follow the active theme — no interaction adds its own colors except the accent-tinted drop preview.

## Move an event

Press on an event card, move more than a few pixels, release:

- The card dims and a dashed preview follows the cursor with a live `9:00 AM – 10:00 AM` label.
- Release snaps the start to **15-minute** increments, preserving the event's duration.
- In **Week view** you can drag across day columns to move an event to another date.
- A plain click (no movement) still opens the editor — drags never trigger it, guarded by a short click-suppression window.

## Resize an event

Hover an event card and drag either edge (grip bar, `ns-resize` cursor): the
**bottom** grip changes the end time and the **top** grip changes the start time.
Both snap to 15 minutes with a 15-minute minimum duration. Overlaps are allowed,
same as manual editing.

## Create by dragging

Press on empty grid space and drag: a preview spans the dragged range. Releasing opens the event editor **pre-filled** with that date and range — nothing is created until you confirm. A plain click keeps the old behavior (1-hour event at the clicked hour).

## Duplicate with Alt-drag

Hold **Alt/Option** while moving: the preview label gains a `· copy` tag and releasing creates a duplicate at the target (new id, no Google linkage — it syncs as a new event) while the original stays put. Works within a day and across week columns.

## Cancel

Press **Escape** mid-drag to cancel with no changes.

## What happens on drop

Drops commit through the normal save pipeline (`persistBlocksForDate` → day plan → debounced sync):

- Moved/resized events get fresh `updatedAt` timestamps, so Google Calendar picks them up automatically.
- Moves keep the block id (including cross-day moves), so existing Google event mappings survive.
- Copies get fresh ids and no sync metadata, so they can never collide with or overwrite the original remotely.
- Edits, deletes, timer start and the event inspector are unchanged.

## Overlapping events

Overlapping events are laid out Apple-Calendar-style — they never cover each
other:

- Events that overlap (directly or transitively) share one group. The group is
  split into the fewest side-by-side columns that keep every event visible, and
  each event then takes the **widest span it can** without ever covering a
  neighbour.
- A short block beside a long one keeps its own column; once a neighbour has
  ended, the following block expands back across the freed column instead of
  staying narrow. This is what keeps a tight schedule readable.
- Back-to-back events (one ends exactly when the next starts) get full width and
  form a fresh group. All-day events live in their own strip above the grid and
  never join the columns; overnight events cluster with the evening instead of
  blanketing the day.
- Short events (under ~45 minutes) collapse to a compact single line — start
  time plus title — so the time stays visible instead of being clipped; hover
  actions remain available. The drop-preview ghost always spans the full width
  since it marks a time range, not the final width.
- Card height follows the real duration. Isolated short events keep a readable
  minimum, but that floor is capped at the next event sharing the same column,
  so a short block never grows into the one below it.

## Zoom the timeline

Hold **Cmd** (macOS) / **Ctrl** and scroll over the grid — or pinch on a
trackpad — to make the calendar taller or shorter. The hourly ruler on the left
and every event card scale together, and the time under the pointer stays
anchored while the ruler grows or shrinks. Zoom ranges from 36 to 220 px per
hour; plain scrolling still moves the grid as usual.

## Current limitations

- No auto-scroll while dragging; the grid is ~06:00–23:00 and mostly visible.
- Touch dragging is disabled to preserve scrolling — use a mouse or trackpad.
- Snap grid is fixed at 15 minutes; finer times remain available via the editor.
