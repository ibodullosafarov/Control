# FIXED_REPORT.md — Audit Remediation (2026-10-14)

Build: `npm run build` OK · `electron-builder --mac dmg` OK → `release/Control-1.0.0-arm64.dmg` (unsigned, no Apple identity).
Tests: 28 files / 369 passed. `tsc -p tsconfig.json --noEmit` clean. `tsc -p tsconfig.electron.json --noEmit` clean.

## P0 — Planner title wipe (verified fixed)
- `electron/plannerMarkdown.ts` `generateDayContent` + `saveDayAsTemplate`: replacer dropped regex group 3 (title).
- Fix: `(_m, prefix, _mark, title) => \`${prefix}[ ]${title ? ` ${title}` : ''}\``. Verified: `"- [x] Do thing"` → `"[ ] Do thing"` (was `"[ ]"`).

## IPC validation
- `electron/main.ts`: `control:saveData` rejects non-object/no-modes; `startBlocking`/`startAppBlocking`/`openSelfControl` check `Array.isArray` + finite `minutes`; `searchInstalledApps` coerces non-string; `sendNotification` slices title/body; `roomsJoin` validates host/port and now `await rooms.join(...)`; `roomsPublish` wrapped in try/catch.
- `electron/blocker.ts`: `startBlocking(domains)`, `startBlocking(apps)`, `startSelfControl` validate types, filter non-strings, cap lengths, reject `NaN/<=0/>1440` minutes; `searchInstalledApps` guards non-string.

## Filesystem / vault
- `electron/obsidian.ts`: new `sanitizeFolderLeaf()`; `resolveTasksFolder` resolves + containment-checks under vault (fallback `Control/Tasks`); `legacyCandidateFolders` sanitized + `path.resolve` containment; `migrateLegacyFolders` skips non-directories and non-`.md`/non-files (no more wholesale moves or `rmdir` of files); `readTasks` is now read-only (no `mkdir`/migrate; missing dir → empty success); `openPath` allows only `.md`/`.ics`/directories and calls `shell.openPath(resolved)`.
- `electron/plannerMarkdown.ts`: `getPlannerDirs('')` returns empty dirs; `ensureDirs` no-ops on empty; new `isValidDayDate` + `dayFilePath()` (regex + `path.resolve` containment); `readDay/applyTemplate/saveDayAsTemplate/toggleTask/updateTaskTitle/updateDaySchedule` use it; all writes via `atomicWriteFile` (random tmp suffix + rename).
- `electron/store.ts`: `structuredClone` on save/get/load (no aliasing of `INITIAL_APP_DATA` or live cache); tmp suffix `Date.now()-randomBytes`.
- `electron/main.ts`: plist `execPath` XML-escaped.

## Destructive GC
- `electron/obsidian.ts` GC: only files with `fm.data.id` considered; deletes only when task id no longer exists — never on rename drift, never hand-made/user notes.

## Concurrency / lifecycle
- `src/services/storage.ts`: `saveData` serialized via promise queue; `loadData` persists normalized (not raw) form; `richness()` now counts notes/exams.
- `electron/rooms/index.ts`: `join()` async, awaits `stopAll`, validates host/port.
- `electron/main.ts` `before-quit`: synchronous best-effort (Electron doesn't await) + clears purpose poller; full awaited unblock stays on explicit Quit handlers.
- `src/App.tsx`: `syncTimerRef` cleared on unmount; purpose-request `.catch`; `handleConfirmLeave`/`handleMinimizeToTray` try/catch; `handleSaveModes` uses functional update.
- `src/components/BlockerControl.tsx`: `cancelledRef` mounted guard.
- `src/components/ActiveSessionView.tsx`: blocker generation counter (stale stop/start dropped), fire-and-forget catches, skip-phase timeout handle + unmount clear.
- `src/components/PlannerView.tsx`: `smoothRestoreRef` unmount clear; ICS export try/catch + typed result.
- `electron/quicknote.ts`: removed duplicated `isDestroyed` branch.

## Shell / execution
- `electron/blocker.ts`: new `shellQuote()`; `killApp`/`isAppRunning` charset/length allowlist (`^[A-Za-z0-9 _+.-]+$`) + quoted args; `searchInstalledApps`/`startBlocking` guards above.
- `electron/calendar.ts`: no `exec`; `shell.openPath(filePath)`; ICS filename restricted to `/^\d{4}-\d{2}-\d{2}$/` else `plan`.

## Google / timezone
- `electron/google/mapping.ts`: `contentHash` v2 includes `modeId/cycles/workDuration/breakDuration` (timer-only edits now sync); push preserves overnight `googleEnd` when valid; `tests/mapping.test.ts` updated (status still ignored; timer fields change hash).
- `electron/google/service.ts`: `timeZone` is now a getter resolving per-sync (OS zone changes honored).
- `src/services/planner.ts`: strict `parseTimeToMinutes` (invalid → 0, no silent midnight for garbage beyond that); ICS validates date/time, escapes `\,;/newline`, folds at 75 octets, single `DTSTAMP`, floating-time disclaimer.

## Rooms net
- `electron/rooms/net.ts`: peer names trimmed/capped (60), timer `label` capped (200); oversize-frame drop retained.

## Test-only
- `tests/auditFixes.test.ts`: `as number` casts for `Map.get` (typecheck clean).

## Residual / not changed (by design)
- Legacy `calendar.syncToGoogleCalendar` still reports honest failure (engine owns pushes); full op-queue `permanent` self-heal and cross-calendar move handling still rely on next-reconcile — hash fix covers the reported timer-blindness; deeper engine rewrite out of scope for this patch.
- LAN rooms remain plaintext trusting LAN (documented assumption); added caps/validation, no auth layer added.
- Token plaintext fallback (`secure:false`) retained with existing `insecureStorage` signal; no secret values touched.
