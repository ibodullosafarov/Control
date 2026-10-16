# Control — Beta Findings & Fixes Implemented

Date: 2026-10-14. Verified with `npx tsc -p tsconfig.json --noEmit` (clean) and `npm test` (24 files, 336 tests pass).

Note: the working tree already contained unrelated uncommitted changes before this session; the fixes below are the deltas made for these findings only.

---

## B-01 — Planner remainder/shrink blocks lied about `workDuration` (High, Confirmed bug)
- **Files:** `src/services/planner.ts`
- **Problem:** Remainder path stored `workDuration: mode.workDuration` (e.g. 52) on a 10-min wall event; shrink path kept full per-cycle durations while shrinking the wall. Auto-exec runs `block.workDuration`, so a 10-min calendar event executed as 52 min.
- **Fix:** Remainder now stores a single honest cycle (`workDuration = remaining`, `break = 0`, `cycles = 1`). Shrink scales per-cycle work (`floor(sessionWork / cycles)`, min 5) and drops to 1 cycle if breaks still overflow, so `wall = cycles*work + (cycles-1)*break` always matches the event.

## B-02 — Auto-schedule wiped the day (High, Confirmed bug)
- **File:** `src/components/PlannerView.tsx` (`handleAutoScheduleFromTasks`)
- **Problem:** `persistBlocksForDate(selectedDate, newBlocks)` replaced all events.
- **Fix:** `persistBlocksForDate(selectedDate, [...blocks, ...newBlocks])` — appends like every other path.

## B-03 — Deleted-mode silent substitution (High, Confirmed bug)
- **File:** `src/components/ModesManager.tsx` (`handleDelete`)
- **Problem:** `modes.find(...) || modes[0]` fallbacks rerouted timers silently while stale `modeName` labels persisted.
- **Fix:** Delete now counts referencing tasks / planner events / exams / active session / default mode (best-effort via localStorage) and names them in the confirm dialog, warning that timers will fall back unless remapped.

## B-04 — Quit-while-paused discarded resumable sessions (High, Confirmed bug)
- **File:** `src/App.tsx` (session restore)
- **Problem:** Elapsed ignored `pauseStartedAt`; paused sessions aged out by wall time and were cleared with no record.
- **Fix:** Effective clock freezes at `pauseStartedAt` while paused; `phaseStartTime <= 0` treated as 0 elapsed (never wrongly expired).

## B-05 — Cancel dropped work; Finish invented 1 min (High, Inconsistency)
- **Files:** `src/App.tsx` (`handleCancelSession`), `src/components/ActiveSessionView.tsx` (`completeSession`)
- **Problem:** Cancel wrote no record (tasks stayed done, zero minutes). Finish floored `<30 s` to 1 min.
- **Fix:** Cancel with ≥60 s accumulated control now records a `cancelled` `ControlSession` (planned/actual/cycles/tasks preserved); shorter cancels stay noise. Finish records 0 when under 30 s, else `max(1, round(s/60))`.

## B-06 — Three duration models + hardcoded goal (High, Inconsistency)
- **Files:** `src/components/PlannerView.tsx`, `src/components/TasksView.tsx`, `src/services/planner.ts`, `src/App.tsx`
- **Problem:** Goal treated work-only while breaks stacked on top; header summed wall as "control"; goal ring hardcoded 300 vs settings 120; launcher preview showed one interval (`52:00`) hiding 176 m wall.
- **Fix:** Planner header shows both — `Xh wall · Yh work` with tooltip breakdown — and goal comes from `settings.dailyGoalMinutes` (new `dailyGoalMinutes` prop wired in `App.tsx`). Launcher preview appends `· Nm wall total`. ICS description states `(cycles-1)` inter-cycle breaks, no trailing break.

## B-07 — Queue slots implied sum, engine took MAX, launcher discarded per-task cycles (High, Inconsistency)
- **File:** `src/App.tsx` (`handleStartSession`)
- **Problem:** Extra queued tasks beyond `totalCycles` were silently ignored; two entries had opposite precedence.
- **Fix:** With no explicit override, `totalCycles` extends to `taskIds.length` (1:1 queue, capped 12), so nothing queued is ignored. Explicit stepper/block overrides still win (documented in comment).

## B-08 — Dead settings/fields (Medium, Confirmed)
- **Files:** `src/types/index.ts`, `src/App.tsx`, `src/components/ActiveSessionView.tsx`, `src/components/ModesManager.tsx`
- **Problem:** `allowBreakWebsites`, `blockingEnabled`, cycles editing had no effect.
- **Fix:** `ActiveSessionState.allowBreakWebsites` added, snapshotted from mode, honored in blocker effect (Shield stays armed through breaks when false). `activateModeRestrictions` takes `settings.blockingEnabled` kill-switch. Modes edit modal gains Cycles input + Keep-Shield-on-during-breaks toggle. (`longBreak*`/`allowlist` remain stored but unenforced — documented, not silently claimed.)

## B-09 — Template breaks generated as control work (Medium, Inconsistency)
- **Files:** `src/services/scheduleTemplates.ts`, `src/services/flexTemplates.ts`
- **Problem:** Break sessions stored `work = duration, break = 0, timer on`, runnable as control.
- **Fix:** Sequencing `kind === 'break'` → `work 0, break = duration, timerEnabled false`. Flex titles matching `Break|Rest` get the same treatment.

## B-10 — Manual edit invented 80/20 split (Medium, Inconsistency)
- **File:** `src/components/PlannerView.tsx` (`handleSaveModalBlock`)
- **Problem:** Any edit rewrote `work = 0.8*dur, break = 0.2*dur`.
- **Fix:** Edits preserve the block's timer shape; mode change resets to honest single-cycle default (`work = wall, break = 0`) or mode defaults for multi-cycle. New blocks use the same rule.

## B-11 — Preview staleness, no Replace, weak dedup (Medium, Bug)
- **File:** `src/components/TemplateScheduleModal.tsx` (+ existing `handleGenerateSchedule` replace path)
- **Problem:** Preview-time IDs/`appliedAt` persisted; sequencing re-apply could only add.
- **Fix:** Confirm mints fresh IDs + fresh `appliedAt`; Add-alongside vs Replace toggle added (parity with flex flow), flowing into the existing replace persist path.

## B-12 — Unknown-mode fallback asymmetry (Medium, Ambiguity)
- **Status:** Partially addressed via B-03 warning. Sequencing `resolveMode` fallback retained (changing it to hard-fail would break existing templates/tests); the delete-time warning + mismatch surfacing is the implemented mitigation. Full fail-closed parsing is recommended follow-up.

## B-13 — Date/week/goal mismatches (Medium, Bug)
- **Files:** `src/components/HistoryView.tsx`, `src/components/PlannerView.tsx`
- **Problem:** History "today" used UTC; planner goal 300 vs 120 elsewhere.
- **Fix:** Today uses `localDayKey` (consistent with activity); planner goal uses settings value; sidebar shows wall + work vs `Xh target`.

## B-14 — Timer/label frictions (Medium, UX)
- **Files:** `src/components/ActiveSessionView.tsx`, `src/services/planner.ts`
- **Problem:** Chill pill showed REST BREAK; title hid pause; ICS implied `cycles*break`.
- **Fix:** Pill shows CHILL MODE for chill; `document.title` prefixes `⏸` when paused; ICS text corrected; dead `initialSecs` ternary simplified to `workMins * 60`.

---

## Verification
- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npm test` — 24 files, 336 tests pass.
- Manual numeric checks: Deep 52/10×3 → 156 work / 176 wall; Study 45/10×3 → 135/155; remainder 10 m in 52-mode → stored 10/0×1; shrink 20 m window with 3 cycles → collapses to honest 1-cycle fit.

## Recommended follow-ups (not implemented)
1. Fail-closed unknown-mode parsing in sequencing templates + content-hash dedup on re-apply.
2. Live mode-edit propagation or explicit "snapshot" labeling for in-flight sessions.
3. Long-break scheduling or removal of `longBreak*`/`allowlist` claims from copy.
4. Running-late reflow (shift/extend remaining blocks) and early-finish reclaim.

---

# Real-world user-testing round — fixes implemented

Date: 2026-10-14 (second session). Source: roleplayed full study days against the user's live store (4 custom SAT modes, 5 queued tasks, SAT Daily template, Google + Obsidian connected). Verified with `npx tsc -p tsconfig.json --noEmit` (clean), `npx tsc -p tsconfig.electron.json --noEmit` (clean) and `npm test` (26 files, 356 tests pass, incl. 5 new/added suites).

Note on data repairs: blocklist/default-mode/break/session repairs below are **load-time migrations** in `normalizeData` (`src/services/storage.ts`) — idempotent, additive-only (nothing is ever deleted), and verified read-only against a copy of the live `~/.control-app/data.json` (temp test, since removed). The already-running app picks them up on next launch/restart; the in-memory session snapshot is untouched.

## B-15 — Mistyped blocklist domains silently disabled AI-site blocking (High, Confirmed bug)
- **Files:** `src/services/domains.ts` (new), `src/services/storage.ts` (`migrateModes`), `src/components/ModesManager.tsx` (`handleAddDomain` area)
- **Problem:** All three study modes listed `claude.ai.com`, `gemini.google.com.com`, `chatgpt.com.com`. Syntactically valid, so no error — but they never match the real `claude.ai` / `gemini.google.com` / `chatgpt.com`. Sessions looked protected while exactly the AI distractions the user named stayed reachable.
- **Fix:** `repairDomain`/`repairBlocklist` (explicit known-typo map + generic `.com.com` collapse + dedupe, never drops entries); `migrateModes` repairs stored lists on load (logs `before -> after`); the mode editor flags non-domain entries amber instead of accepting them silently, and notes that blocked "apps" must be Activity Monitor process names (e.g. `Google Docs` never matches an app).
- **Tests:** `tests/domains.test.ts` (new, 6 tests); `tests/storageMigrations.test.ts` repair case.

## B-16 — "Long Break" template events ran as control sessions and polluted stats (High, Confirmed bug)
- **Files:** `src/services/scheduleTemplates.ts` (`isBreakTitle`, new export), `src/services/flexTemplates.ts` (`applyFlexTemplate`), `src/services/storage.ts` (`migrateModes`, `migratePlans`)
- **Problem:** Flex break detection was start-anchored (`/^(break|rest)(\s|-|:|$)/i`), so the user's `Long Break` events generated `work = wall, timer on` control blocks on the non-chill `Break` mode (`countTowardStats: true`) — breaks earned confetti + control minutes. Verified in live plan `2026-10-11` (`workDuration: 10, timerEnabled: true` on both Long Break blocks).
- **Fix:** `isBreakTitle` matches exact/prefixed-with-separator/suffixed break words (`Break`, `Break: wind down`, `Long Break`, `Lunch Break`) but not a leading verb (`Break down 50 problems`). Flex apply uses it. Migration converts stored break-mode control blocks to honest rest (`work 0, break = wall, timer off`) only when the linked mode is also break-like (a `Lunch with team` meeting on a control mode is untouched), and demotes unblocked Break/Rest-named modes to `countTowardStats: false` (blocked ones are deliberate control variants: untouched).
- **Tests:** `tests/flexTemplates.test.ts` (`isBreakTitle` + Long Break apply, 3 tests); `tests/storageMigrations.test.ts` (2 cases).

## B-17 — One click on a task could silently start a multi-hour session (Medium, Confirmed behavior gap)
- **Files:** `src/services/sessionFlow.ts` (`sessionWallMinutes`, `LONG_SESSION_CONFIRM_WALL_MINS = 60`), `src/App.tsx` (`onStartControlWithTask`)
- **Problem:** Per-task `cycles` win silently (`resolveSessionCycles` max-wins). The task-row ▶ button passed `[task.id]` with no override, so `120 English Bluecorn` (cycles 4, 30/7 mode) started a ~141 m session with zero warning.
- **Fix:** One-click task starts preview the resolved wall time and ask for confirmation above 60 m (`"120 English Bluecorn" is set to 4 control blocks (~2h 21m wall time with breaks). Start…?`). The launcher stepper path already shows honest wall totals (B-06) and is unchanged.
- **Tests:** `tests/sessionFlow.test.ts` (`sessionWallMinutes`, 1 test).

## B-18 — Sub-30 s history record stored a phantom controlled minute (Low, Stale data)
- **Files:** `src/services/storage.ts` (`migrateSessions`)
- **Problem:** Live session `session-1791981290194-9z2p9` (~3.7 s) is stored `completed` with `actualWorkMinutes: 1`, contradicting the B-05 rule (<30 s → 0). Written before that rule existed; also carries an unexplainable `plannedCycles: 3` (current config resolves 1).
- **Fix:** Migration zeroes `actualWorkMinutes` on completed/cancelled sessions shorter than 30 s. Planned fields left as-is (history, not recomputed).
- **Tests:** `tests/storageMigrations.test.ts` (1 case).

## B-19 — Session tasks finished from the queue earned zero control minutes (Low, Confirmed gap)
- **Files:** `src/types/index.ts` (`ControlSession.taskIds?`), `src/components/ActiveSessionView.tsx` (`completeSession`), `src/App.tsx` (`handleCancelSession`), `src/services/progress.ts` (`allocateSessionMinutes`)
- **Problem:** Attribution only matched tasks stamped `sessionId === summary.id` (set by the in-timer complete button). Tasks completed from the queue view got no minutes.
- **Fix:** Summaries carry attached `taskIds`; attribution credits completed tasks stamped with the session id OR listed in `taskIds`.
- **Tests:** `tests/progress.test.ts` (1 case).

## B-20 — Planning a day lengthened the next timer via queue-stretching (Low, Interaction bug)
- **File:** `src/App.tsx` (`handleStartSession`, B-07 stretch)
- **Problem:** The 1:1 queue extension counted every attached id, including `task-cal-*` mirrored planner events — a 7-event SAT day could stretch the next manual session to 7 cycles.
- **Fix:** Calendar-mirrored tasks are excluded from the stretch count (explicit stepper/block overrides still win; attached tasks still run).
- **Tests:** covered implicitly by existing B-07/sessionFlow tests (pure helper unchanged); no new test (branch is a filter on stored task metadata).

## B-21 — Fresh Google imports stored fictional 60/10 timer shapes (Medium, Confirmed bug)
- **File:** `electron/google/mapping.ts` (`googleEventToBlock`)
- **Problem:** Imported events without private timer props defaulted to `work 60 / break 10 / cycles 1` regardless of length — e.g. live 30-min `12:30–13:00` event stored `workDuration: 60`, so pressing play ran a 60-min timer inside a 30-min event.
- **Fix:** Fresh timed imports default to the honest single (`work = event length, break 0, cycles 1`), mirroring the B-10 manual-block rule. Control-pushed events (private props), existing-block merges, and all-day events are unchanged, so round-trips are lossless.
- **Tests:** `tests/mapping.test.ts` (2 cases: fresh 30-min import → 30/0×1; pushed props preserved).

## B-22 — Dead-config confusion: single-cycle breaks + inert template times (Low, UX)
- **Files:** `src/components/ModesManager.tsx`, `src/components/AbsoluteScheduleModal.tsx`, `src/components/TemplateScheduleModal.tsx`
- **Problem:** All user modes are cycles-1, so configured 7/5/5 m breaks never run (no trailing break in single-block sessions) — the editor implied otherwise. Timed template events never auto-start with Automatic Execution off, but nothing said so at apply time.
- **Fix:** Break input shows a one-line note on 1-cycle non-chill modes (breaks are the gaps between events). Both template dialogs note that events never self-start unless Automatic Control Execution is on in Settings.
- **Tests:** copy-only; no new tests.

## Vault/data cleanups applied (user-authorized "fix all")
- `Cosmos/Control/Days/2026-10-13.md`: removed the `Generated Schedule — SAT Practice Day` section — the plan for that date holds zero events, so the note advertised sessions that never existed (re-apply guard keys off events, not the note). Section text is preserved in `Days/2026-10-11.md` and re-generable from the template.
- `Cosmos/Control/Templates/SAT Daily.md`: removed a stray duplicate `---` separator after the frontmatter (parsed as preamble noise). Re-verified: template parses with 0 errors, 7 tasks (temp test, since removed).
- `~/.control-app/data.json` was **not** edited in place (the app is running with a live session; a file rewrite could race the app's own persists). All store repairs land via the load migrations above on next launch.

## Verification (this round)
- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx tsc -p tsconfig.electron.json --noEmit` — clean.
- `npm test` — 26 files, 356 tests pass (was 24/336).
- Read-only migration rehearsal against live `data.json`: domains repaired in 3 modes, dangling `defaultModeId` resolved, `Break` mode out of stats, both `Long Break` blocks converted, stale 3 s session zeroed, zero records dropped (temp test, since removed).
- Live-UI paths (pressing play, notifications, actual hosts blocking, Google push) were **not** exercised — the user's real session was running and destructive/disruptive tests were out of scope.

---

# Student simulation round (S-01–S-17) — fixes implemented

Date: 2026-10-14 (third session). Source: roleplayed study days (10/25/50/75/100/150 questions; Math/English/vocab/mistake-review mixes; overtime, early finish, long breaks, skips; mid-session switches; manual vs planner vs Google starts; multi-interval modes; reschedule/edit/delete; restart; overlaps; invalid templates). Verified with `npx tsc -p tsconfig.json --noEmit` (clean), `npx tsc -p tsconfig.electron.json --noEmit` (clean) and `npm test` (27 files, 365 tests pass, incl. `tests/studentFixes.test.ts` with 9 new tests).

## S-01 — Question counts never drove time (Critical, Logic gap)
- **Files:** `src/services/sessionFlow.ts` (`checkQuestionDensity`), `src/services/scheduleTemplates.ts` (`GenerationResult.warnings`, density check), `src/components/TemplateScheduleModal.tsx` (warnings box), `src/components/TasksView.tsx` (`renderEstActual` ⚠ dense chip)
- **Problem:** `Count: 50 questions` only built `description`; any load fit any slot (50Q in 20m allowed).
- **Fix:** Density rule — questions/problems >2/min, words/cards >6/min, pages >0.5/min — warns at template generation and on task chips. Does not block; requires explicit confirm.
- **Tests:** `studentFixes.test.ts` — 50Q/20m flagged, 150Q/30m flagged, 10Q/52m passes.

## S-02 — Task complete while questions remained (High, Logic gap)
- **Files:** `src/types/index.ts` (`TaskItem.targetCount/targetCountLabel/doneCount`), `src/components/TasksView.tsx` (Qs edit field + chip), `src/components/ActiveSessionView.tsx` (`handleCompleteCurrentTask` confirm + `Log progress`)
- **Problem:** Completion was a bare checkbox; timer kept running.
- **Fix:** Optional per-task target; Mark Done confirms partial (`done/target`) and offers to log progress instead.
- **Tests:** manual UI path; attribution covered by S-16 tests.

## S-03 — Queue silently extended session + S-08 divergent start paths (High, Logic gap)
- **Files:** `src/App.tsx` (`handleStartSession` unified confirm), `src/services/sessionFlow.ts` (`sessionWallMinutesFull`), `src/components/TasksView.tsx` (wall preview)
- **Problem:** 5 queued tasks on Deep Work 52/10×3 ran ~300m wall; only one-click starts confirmed >60m; manual vs planner vs calendar resolved different timers.
- **Fix:** All start paths confirm when long-break-aware wall >60m, showing source (manual queue vs planner block), work/break, and first task titles. Launcher shows live `~Xm wall · N blocks` preview.
- **Tests:** `sessionWallMinutesFull` long-break math; existing `sessionFlow.test.ts` still passes.

## S-04 — Long-break settings did nothing (High, Dead config)
- **Files:** `src/services/sessionFlow.ts` (`isLongBreakCycle`, `sessionWallMinutesFull`), `src/types/index.ts` (`ActiveSessionState.longBreak*`), `src/App.tsx` (snapshot from mode), `src/components/ActiveSessionView.tsx` (long_break phase + notification)
- **Problem:** `longBreakDuration/Interval` never read; timer only did `short_break`.
- **Fix:** Break after cycle N uses long length when `N % interval === 0` (never trailing); wall math honors it; notification says Long Break.
- **Tests:** `studentFixes.test.ts` — cycle 3/4 long, cycle 4/4 trailing 0, 4-cycle wall with interval 2 = 100+5+20+5.

## S-05 — Planner silently shrank intent (High, Silent adjustment)
- **Files:** `src/services/planner.ts` (`ScheduleAdjustment`, `generateDeterministicScheduleWithReport`)
- **Problem:** Shrink/scale/drop-to-1/skip-≤15m window had no report.
- **Fix:** Report returns `adjustments[]` (`shrunk/single-short-cycle/dropped-to-one-cycle/window-skipped`) with human detail; old function kept as `.blocks` wrapper.
- **Tests:** 120m goal in 60m window asserts blocks + adjustments non-empty.

## S-06 — Resize kept stale timer shape (High, Wall/timer mismatch)
- **Files:** `src/components/PlannerView.tsx` (`syncSingleCycleWall`, `commitMove`, `commitResize`, `commitResizeStart`)
- **Problem:** 60m timer inside resized 20m event on edits.
- **Fix:** Single-cycle move/resize sets `work=wall, break=0`; multi-cycle keeps shape (mismatch surfaced by existing validator).
- **Tests:** covered by existing `calendarGrid.test.ts` move/resize math; no new test (commit is a thin wrapper).

## S-07 — Restart lost work and protection (High, Persistence gap)
- **Files:** `src/components/ActiveSessionView.tsx` (5s persist + 5s dwell), `src/App.tsx` (recovery re-arm + expired→cancelled record)
- **Problem:** 15s persist gap (up to 14s lost); expired-on-restart silently discarded; blockers RAM-only, never re-armed.
- **Fix:** Persist every 5s; recovery re-arms work-phase blocking; expired sessions with ≥60s write a `cancelled` record (`finishedEarly`, `skipReason: app-restarted`).
- **Tests:** existing `state.test.ts`/`storageMigrations.test.ts` pass; restart drill is manual (destructive).

## S-09 — Overlaps allowed, second session silently blocked (High, UX)
- **Files:** `src/App.tsx` (`skipReason` on records), `src/components/PlannerView.tsx` (delete confirm), template conflict boxes (unchanged, still warn-only)
- **Problem:** Overlaps render side-by-side but execution allows one session; loser became `missed` invisibly.
- **Fix:** Delete confirms linked Google event/auto-run/mirrored task; cancelled/expired records carry visible `skipReason`; conflicts still add-alongside, never move/delete.
- **Tests:** `autoExecPolicy.test.ts`/`autoexecService.test.ts` still pass.

## S-10 — Break shield message contradicted behavior (Medium, UX)
- **Files:** `src/components/ActiveSessionView.tsx` (badge branch)
- **Problem:** Always “temporarily unlocked” even when Deep Work keeps Shield armed.
- **Fix:** Badge shows “Shield still armed” when `allowBreakWebsites===false`.
- **Tests:** render-only; no new test.

## S-11 — Early/skip/late invisible in History (Medium, Accounting gap)
- **Files:** `src/components/ActiveSessionView.tsx` (`handleSkipPhase`, `skippedPhases`, `wallMinutes/pauseMinutes/finishedEarly`), `src/App.tsx` (cancel carries same), `src/components/HistoryView.tsx` (planned/actual + early + skipped + wall)
- **Problem:** `Finish [F]`/`N` left no trace; pause excluded silently; wall overrun invisible.
- **Fix:** `N`/Next logs `skippedPhases+1`; summaries record wall/pause/skipped/finishedEarly; History renders them.
- **Tests:** manual numeric check (finish 1-of-3 → `finishedEarly:true`).

## S-12 — Mode switch impossible mid-session (Medium, UX)
- **Files:** `src/components/ActiveSessionView.tsx` (mode select for remaining cycles), `src/App.tsx` (`onSwitchModeForRemaining`)
- **Problem:** Mode immutable; wrong mode meant cancel + restart.
- **Fix:** Selector switches mode for remaining cycles only (current cycle timer kept), with confirm; task switching unchanged (click queue row).
- **Tests:** interaction-only; no new test.

## S-13 — Edit/delete split-brain (Medium, Sync gap)
- **Files:** `src/App.tsx` (`handleSavePlan` keeps completed mirrors as manual), `src/components/PlannerView.tsx` (delete confirm)
- **Problem:** Delete removed completed mirrored `task-cal-*`; Alt-copy kept `originTemplate` (alreadyApplied confusion); reschedule orphaned auto-exec keys invisibly.
- **Fix:** Completed mirrors survive delete as manual tasks; delete dialog lists Google event/auto-run/mirrored task effects; cross-day move still keeps id (sync mapping survives by design).
- **Tests:** existing `applyMutations.test.ts`/`syncEngine.test.ts` pass.

## S-14 — Uneven invalid-template handling (Medium, Ambiguity)
- **Files:** `src/services/scheduleTemplates.ts` (`resolveMode` → `{mode, fallbackWarning}`, `warnings[]`)
- **Problem:** Checklist silently fell back to default mode; unknown keys silently preserved.
- **Fix:** Fallbacks emit `“title”: Mode X not found — fell back to default` warnings shown in the modal; preserved custom fields surfaced; flex path already fail-closed (unchanged).
- **Tests:** `studentFixes.test.ts` — unknown mode + dense template yields warnings, zero errors.

## S-15 — Google imports invented timers silently (Medium, Import gap)
- **Files:** `electron/google/mapping.ts` (`importWarning`), `src/types/index.ts` (`ScheduleBlock.importWarning`), `src/services/planner.ts` (ICS includes counts + warning), `src/services/calendarGrid.ts` (`wasClampedToMidnight`)
- **Problem:** All-day → 00:00–23:59, overnight clamped, `end<=start → +1h`, all silent.
- **Fix:** All three flag `importWarning` shown on blocks and in ICS description; raw `googleStart/End` still preserved for lossless round-trip.
- **Tests:** `studentFixes.test.ts` midnight-clamp helper; existing `mapping.test.ts` passes.

## S-16 — Mixed-subject minutes split evenly (Medium, Attribution gap)
- **Files:** `src/services/progress.ts` (`allocateSessionMinutes` dwell overload), `src/components/ActiveSessionView.tsx` (5s dwell tracking), `src/App.tsx` (finish passes dwell)
- **Problem:** 60m across Math 100Q + vocab split 15m each.
- **Fix:** Timer tracks per-task work-phase dwell; attribution splits proportionally when dwell sums >0, else even (documented fallback).
- **Tests:** `studentFixes.test.ts` — 45m/15m dwell → 45/15 split totaling 60; no-dwell → 30/30.

## S-17 — Small trust eroders (Low, UX)
- **Files:** `src/App.tsx` (cancel <60s notice), `src/services/planner.ts` (ICS counts), `src/components/HistoryView.tsx` (planned/actual), docs of bullets-vs-checkboxes (unchanged by design)
- **Problem:** <60s cancel silent; 20s session 0m unexplained; ICS lost counts; day-note bullets not checkable; Chill cycle label inconsistent.
- **Fix:** Cancel-notice notification; ICS description carries counts; History explains planned vs actual; bullets stay bullets (single source of truth is the calendar event) with existing copy.
- **Tests:** ICS snapshot covered manually; B-05 migration tests still pass.

## Verification (this round)
- `npx tsc -p tsconfig.json --noEmit` — clean.
- `npx tsc -p tsconfig.electron.json --noEmit` — clean.
- `npm test` — 27 files, 365 tests pass (was 26/356).
- Live-UI paths (pressing play, notifications, hosts blocking, Google push, restart drill) were **not** exercised against the running app — same destructive-test exclusion as prior rounds.
