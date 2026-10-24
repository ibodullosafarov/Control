export type ThemeId =
  | 'moder'
  | 'soft_paper'
  | 'lavender'
  | 'matcha'
  | 'sunset'
  | 'abyss'
  | 'paper'
  | 'serika'
  | 'carbon'
  | 'nord'
  | 'emerald'
  | 'dracula'
  | 'mocha';

export type BlockingStrategy = 'dynamic_hosts' | 'selfcontrol' | 'none';

/** A user-created group for organizing study modes. */
export interface ModeFolder {
  id: string;
  name: string;
  createdAt: string;
  color?: string;
  icon?: string;
}

/** A quick-captured note. Origin is tracked so notes stay attributable. */
export interface Note {
  id: string;
  /** Markdown body (without frontmatter — added on Obsidian export). */
  content: string;
  /** Task being worked on when captured (snapshot — tasks can be deleted). */
  taskId?: string;
  taskTitle?: string;
  modeId?: string;
  modeName?: string;
  folderId?: string;
  createdAt: string;
  updatedAt: string;
}

/** A user-created folder for organizing notes. Linked to a mode optionally. */
export interface NoteFolder {
  id: string;
  name: string;
  /** When set, quick notes captured in this mode file here automatically. */
  modeId?: string;
  createdAt: string;
  color?: string;
  icon?: string;
}

export interface StudyMode {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  workDuration: number; // in minutes
  breakDuration: number; // in minutes
  /**
   * @deprecated Cycle counts are chosen per task at creation time
   * (`TaskItem.cycles`) instead. Kept as a silent fallback for sessions
   * started without tasks and for data created before per-task cycles.
   */
  cycles: number;
  longBreakDuration: number; // in minutes
  longBreakInterval: number; // every N cycles
  blocklist: string[];
  blockedApps: string[];
  allowlist: string[];
  allowBreakWebsites: boolean; // default true
  countTowardStats: boolean;
  isChillMode: boolean; // relax/free time mode
  blockingStrategy: BlockingStrategy;
  isDefault?: boolean;
  order: number;
  createdAt: string;
  /** Optional folder this mode is organized under. Undefined = ungrouped. */
  folderId?: string;
}

export type SessionPhase = 'work' | 'short_break' | 'long_break' | 'chill' | 'idle' | 'completed';

export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  order: number;
  modeId?: string;
  sessionId?: string;
  createdAt: string;
  completedAt?: string;
  /**
   * Control blocks planned for this task, chosen when the task is written.
   * Absent (older tasks) = follow the session/mode default at start time.
   */
  cycles?: number;
  /**
   * How many of `cycles` are already DONE (credited when each cycle
   * finishes, not when the whole session ends). Starting the task again
   * resumes at the next unfinished cycle and the planner/timer display
   * "cycle x of z" against this number.
   */
  cyclesCompleted?: number;
  /** Planned effort in minutes, set by the user. */
  estimateMinutes?: number;
  /** Accumulated controlled minutes attributed from finished sessions. */
  controlMinutes?: number;
  /** Optional question/item target (e.g. 50 questions). Metadata + progress. */
  targetCount?: number;
  /** Label for targetCount (questions/problems/words/items/cards/pages). */
  targetCountLabel?: string;
  /** How many of targetCount are done (student-updated). */
  doneCount?: number;
  /** Spaced-repetition state. Absent = not a review task. */
  review?: TaskReviewState;
  /** Origin of this task: mirrored from calendar or manual user task. */
  source?: 'calendar' | 'manual';
  /** If mirrored from a schedule block, the block.id. */
  sourceId?: string;
}

/** Spaced-repetition scheduling state for a review task. */
export interface TaskReviewState {
  /** Current interval in days. */
  intervalDays: number;
  /** Local YYYY-MM-DD day the next review is due. */
  dueDay: string;
  /** Consecutive successful repetitions. */
  reps: number;
}

/** One frontmost-app sample captured by the optional activity tracker. */
export interface ActivitySample {
  /** Epoch ms, floored to the minute. */
  t: number;
  /** Frontmost application name, e.g. "Xcode". */
  app: string;
}

/** A distraction blocked (or attempted) during protected control time. */
export interface DistractionEvent {
  /** Epoch ms. */
  t: number;
  kind: 'app' | 'site';
  /** App name or domain. */
  name: string;
  /** Active session mode at the time, if any. */
  modeId?: string;
  modeName?: string;
}

export interface ActiveSessionState {
  id: string;
  modeId: string;
  modeName: string;
  modeIcon: string;
  modeColor: string;
  isChillMode: boolean;
  workDurationMins: number;
  breakDurationMins: number;
  totalCycles: number;
  currentCycle: number;
  phase: SessionPhase; // 'work' | 'short_break' | 'long_break' | 'chill'

  // Timestamp-based tracking for zero drift:
  phaseStartTime: number; // Date.now() timestamp when current phase started
  phaseDurationSeconds: number; // Total seconds for this phase
  accumulatedWorkSeconds: number;
  completedCyclesCount: number;

  isPaused: boolean;
  pauseStartedAt: number | null; // Date.now() timestamp when paused
  totalPauseSecondsThisPhase: number;
  /** Cumulative pause across all phases (never reset mid-session). */
  totalPauseSecondsAllPhases?: number;
  /** Guard against double phase transitions from rapid Next/skip. */
  transitioning?: boolean;

  // Tasks linked to this session:
  taskIds: string[]; // IDs of tasks in this session
  activeTaskId: string | null;
  completedTaskIds: string[];

  // Restriction & session metadata:
  blocklist: string[];
  blockedApps: string[];
  blockingStrategy: BlockingStrategy;
  /**
   * Per-session Control override (e.g. from a schedule template block).
   * True forces enforcement, false suppresses it for the whole session,
   * undefined follows the mode's own rules.
   */
  blockingOverride?: boolean;
  countTowardStats: boolean;
  /** When false, Shield stays armed through breaks (mode default). */
  allowBreakWebsites?: boolean;
  startedAt: string; // ISO string
  /** Long-break length for this session (resolved from mode at start). */
  longBreakDurationMins?: number;
  /** Every N cycles use the long break. */
  longBreakInterval?: number;
  /** Per-task dwell seconds (taskId -> seconds in work phase). */
  taskDwellSeconds?: Record<string, number>;
  /**
   * Cycles of each task that were already completed BEFORE this session
   * (snapshot of task.cyclesCompleted at start). Lets the timer display
   * overall "cycle x of z" progress for a task resumed across sittings.
   */
  taskCycleOffsets?: Record<string, number>;
  /**
   * Planner block that launched this session (auto-run or manual Play).
   * When the session's cycle finishes, the block is marked completed.
   */
  sourceBlockId?: string;
  /** Day (YYYY-MM-DD) the sourceBlockId lives on. */
  sourceBlockDate?: string;
}

export interface TraySessionInfo {
  isActive: boolean;
  timeRemainingStr: string;
  currentTaskTitle?: string;
  remainingTasksCount?: number;
  isPaused: boolean;
  modeName?: string;
}

export interface ControlSession {
  id: string;
  modeId: string;
  modeName: string;
  modeIcon: string;
  isChillMode: boolean;
  startTime: string;
  endTime: string;
  plannedWorkMinutes: number;
  actualWorkMinutes: number;
  plannedCycles: number;
  completedCycles: number;
  status: 'completed' | 'cancelled' | 'paused';
  notes?: string;
  countTowardStats: boolean;
  tasksTotal?: number;
  tasksCompleted?: number;
  taskTitles?: string[];
  completedTaskTitles?: string[];
  /**
   * B-19: ids of the tasks attached to the session. Lets minute
   * attribution credit session tasks completed outside the timer UI
   * (queue view), not just tasks stamped with this session id.
   */
  taskIds?: string[];
  /** Honest wall-clock minutes (control + breaks actually elapsed). */
  wallMinutes?: number;
  /** Minutes spent paused (not counted toward control). */
  pauseMinutes?: number;
  /** Work phases skipped via Next (phase-skips are logged, not silent). */
  skippedPhases?: number;
  /** True when finished before all cycles completed. */
  finishedEarly?: boolean;
  /** Visible auto-exec skip reason (overlap / missed / session-active). */
  skipReason?: string;
}

export interface ScheduleBlock {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /**
   * Mode this block is planned under. Empty string means "no mode" — a
   * free-form plan entry that starts no timer and blocks nothing (it still
   * mirrors into a task, with no mode attached).
   */
  modeId: string;
  modeName: string;
  modeIcon: string;
  modeColor: string;
  workDuration: number;
  breakDuration: number;
  cycles: number;
  status: 'proposed' | 'approved' | 'synced' | 'completed';
  googleCalendarEventId?: string;
  googleCalendarSyncedAt?: string;
  /** True for all-day events imported from (or exported to) Google Calendar. */
  allDay?: boolean;
  /** Free-form location, mirrored to/from Google Calendar events. */
  location?: string;
  /** Long description/notes, mirrored to/from Google Calendar events. */
  description?: string;
  /** Origin of the event. Events imported from Google are still two-way editable. */
  source?: 'control' | 'google';
  /** Calendar the Google event lives in (may differ from the selected target). */
  googleCalendarId?: string;
  /** Last known Google ETag — used for conflict detection on push. */
  googleEventETag?: string;
  /** Master id when the mapped Google event is a single instance of a series. */
  googleRecurringEventId?: string;
  /** Raw RFC3339/date strings as returned by Google (lossless round-trip). */
  googleStart?: string;
  googleEnd?: string;
  /** Google event status ('confirmed' | 'tentative' | 'cancelled'). */
  googleStatus?: string;
  /** Original Google resource JSON, preserved so unsupported fields survive sync. */
  googleRaw?: string;
  /** RRULE/EXDATE lines when a Google event carries recurrence (series master). */
  recurrence?: string[];
  /** Name of the schedule template this block was generated from, if any. */
  originTemplate?: string;
  /** ISO timestamp of when the template schedule was generated. */
  originTemplateAppliedAt?: string;
  /** Whether this block offers the Start-in-timer action. Defaults to true. */
  timerEnabled?: boolean;
  /** Control Mode preference for this session. Undefined = follow the mode's rules. */
  controlMode?: boolean;
  /**
   * Task this block is one CONTROL CYCLE of (per-cycle scheduling). Blocks
   * with a taskId are NOT mirrored into extra tasks — they run and credit
   * the linked task instead.
   */
  taskId?: string;
  /** Display title of the linked task (denormalized for calendars/exports). */
  taskTitle?: string;
  /** 1-based index of the task's cycle this block runs. */
  cycleIndex?: number;
  /** Total planned cycles of the linked task (for "Cycle x of z" labels). */
  cyclesTotal?: number;
  /** Human-readable import anomaly (all-day clamp, overnight, +1h repair). */
  importWarning?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlanGoal {
  modeId: string;
  targetMinutes: number;
}

export interface TimeWindow {
  start: string; // HH:mm (e.g. "09:00")
  end: string; // HH:mm (e.g. "13:00")
}

export interface DayPlan {
  date: string; // YYYY-MM-DD
  goals: PlanGoal[];
  timeWindows: TimeWindow[];
  blocks: ScheduleBlock[];
  isApproved: boolean;
  updatedAt: string;
}

export interface GoogleCalendarConfig {
  connected: boolean;
  calendarId: string;
  /** Deprecated: OAuth client credentials live in the main process only. */
  clientId?: string;
  /** Deprecated: never supplied by the renderer; kept for data-shape compatibility. */
  clientSecret?: string;
  userEmail?: string;
  autoColorEvents: boolean;
  defaultReminderMinutes: number;
  lastSyncedAt?: string;
  /** Automatically sync after local planner changes. Default true. */
  autoSync?: boolean;
}

// ── Google Calendar two-way sync (main process is the source of truth) ─────

export type GoogleSyncPhase =
  | 'unavailable'
  | 'unconfigured'
  | 'disconnected'
  | 'connecting'
  | 'syncing'
  | 'idle'
  | 'offline'
  | 'auth_required'
  | 'error';

export interface GoogleSyncStatus {
  /** False when running outside Electron (no controlAPI bridge). */
  available: boolean;
  /** OAuth client credentials resolvable (env / ~/.control-app/google-oauth.json). */
  configured: boolean;
  /** Where the client credentials came from (for setup guidance). */
  configSource?: string;
  connected: boolean;
  /** Access or refresh token can no longer be used; user must reconnect. */
  needsReauth: boolean;
  userEmail?: string;
  /** Target calendar for new events and imports. */
  calendarId?: string;
  phase: GoogleSyncPhase;
  syncing: boolean;
  /** Persisted operations still waiting to reach Google. */
  pendingOps: number;
  lastSyncedAt?: string;
  lastFullSyncAt?: string;
  lastError?: string;
  lastErrorCode?: string;
  /** Conflicts detected (ETag mismatch / remote deletion) since connect. */
  conflictCount: number;
  /** True when token encryption fell back to an unencrypted file. */
  insecureStorage: boolean;
  /** Events imported into Control since connect. */
  importedCount: number;
  /** Local events pushed to Google since connect. */
  pushedCount: number;
}

export interface GoogleCalendarOption {
  id: string;
  summary: string;
  description?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

export interface GoogleConnectResult {
  success: boolean;
  error?: string;
  code?:
    | 'not_configured'
    | 'already_connected'
    | 'connection_in_progress'
    | 'auth_failed'
    | 'auth_denied'
    | 'auth_timeout'
    | 'unavailable';
}

export interface GoogleListCalendarsResult {
  success: boolean;
  calendars: GoogleCalendarOption[];
  error?: string;
}

export interface GoogleSyncNowResult {
  success: boolean;
  error?: string;
  code?: 'not_connected' | 'sync_in_progress' | 'offline' | 'auth_required' | 'unavailable';
  created?: number;
  updated?: number;
  deleted?: number;
  imported?: number;
}

/** Mutations the main process asks the renderer to fold into its plans. */
export interface GoogleApplyMutations {
  requestId: string;
  upserts: Array<{ localId: string; date: string; block: ScheduleBlock }>;
  removals: Array<{ localId: string; date?: string }>;
}

export interface GoogleApplyResult {
  success: boolean;
  applied?: number;
  error?: string;
}

export interface GoogleDisconnectResult {
  success: boolean;
  error?: string;
  removedRemote?: number;
}

export type ObsidianSyncFormat = 'individual' | 'consolidated' | 'both';

export interface ObsidianConfig {
  enabled: boolean;
  vaultPath: string; // Absolute path to Obsidian vault or folder
  folderName: string; // Tasks subfolder inside <vault>/Control, e.g. "Tasks"
  syncFormat: ObsidianSyncFormat; // 'individual' | 'consolidated' | 'both'
  autoSync: boolean; // Auto sync on task changes
  includeCompleted: boolean;
  lastSyncedAt?: string;
}

export interface ObsidianSyncResult {
  success: boolean;
  syncedCount: number;
  createdCount: number;
  updatedCount: number;
  folder: string;
  error?: string;
  /** Ids of tasks whose individual files are expected in the folder after this sync. */
  fileIds?: string[];
}

/** A single task note parsed from <vault>/Control/<folderName>/*.md (two-way import). */
export interface ObsidianTaskFile {
  /** Frontmatter id; undefined for hand-made notes. */
  id?: string;
  fileName: string;
  title: string;
  completed: boolean;
  order?: number;
  modeName?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface TasksMdReadResult {
  success: boolean;
  folder: string;
  tasks: ObsidianTaskFile[];
  error?: string;
}

export interface UserSettings {
  userName?: string;
  /** false on fresh installs until the first-run setup wizard completes. */
  setupCompleted?: boolean;
  theme: ThemeId;
  soundEnabled: boolean;
  soundVolume: number;
  launchAtLogin: boolean;
  autoStartBreaks: boolean;
  autoStartWork: boolean;
  defaultModeId: string;
  blockingEnabled: boolean;
  blockingStrategy: BlockingStrategy;
  /** Daily control target in minutes. Powers the goal ring and goal-based streak. */
  dailyGoalMinutes: number;
  /** Optional frontmost-app activity tracking (off by default). */
  activityTracking?: { enabled: boolean };
  googleCalendar: GoogleCalendarConfig;
  obsidian?: ObsidianConfig;
  minimalModeOnControl: boolean;
  reducedMotion?: boolean;
  /** Legibility-optimized typography for readers with dyslexia. */
  dyslexicFont?: boolean;
  /** Automatic study-day execution (notifications + scheduled control sessions). */
  autoExecute?: AutoExecuteConfig;
}

export interface AutoExecuteConfig {
  enabled: boolean;
  /** Minutes before an event to send the reminder notification. Default 5. */
  notifyLeadMinutes: number;
}

/** Execution state of one scheduled occurrence (main-process scheduler). */
export type AutoExecOccState =
  | 'pending'
  | 'notified'
  | 'starting'
  | 'running'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface AutoExecOccurrence {
  /** Stable key: `${blockId}|${date}|${startTime}` — changes invalidate pending work. */
  key: string;
  blockId: string;
  date: string;
  title: string;
  startTime: string;
  endTime: string;
  modeId: string;
  state: AutoExecOccState;
  notifiedAt?: string;
  startedAt?: string;
  endedAt?: string;
  skippedAt?: string;
  skipReason?: string;
  error?: string;
  blockingEnforced?: boolean;
  blockingError?: string;
}

export interface AutoExecStatus {
  enabled: boolean;
  notifyLeadMinutes: number;
  notificationsSupported: boolean;
  /** ISO now at status build time. */
  now: string;
  occurrences: AutoExecOccurrence[];
}

export interface AutoExecStartRequest {
  requestId: string;
  blockId: string;
  date: string;
}

export interface AutoExecStartResult {
  success: boolean;
  started?: boolean;
  reason?: string;
  error?: string;
  /** Whether any website/app list was actually engaged at start. */
  blockingEnforced?: boolean;
  /** First blocking failure, if enforcement was requested but failed. */
  blockingError?: string;
}

export interface AutoExecEndRequest {
  requestId: string;
  blockId: string;
  date: string;
}

export interface AutoExecEndResult {
  success: boolean;
  ended?: boolean;
  reason?: string;
  error?: string;
}

export interface ControlAppData {
  modes: StudyMode[];
  /** User-created folders for organizing modes. Optional for backward compatibility. */
  modeFolders?: ModeFolder[];
  /** Frontmost-app samples from the optional activity tracker (pruned to ~14 days). */
  activitySamples?: ActivitySample[];
  /** Distractions blocked during protected control time (capped). */
  distractions?: DistractionEvent[];
  /** Quick notes. */
  notes?: Note[];
  /** User-created folders for organizing notes. */
  noteFolders?: NoteFolder[];
  sessions: ControlSession[];
  tasks: TaskItem[];
  activeSession: ActiveSessionState | null;
  settings: UserSettings;
  plans: Record<string, DayPlan>; // keyed by YYYY-MM-DD
}

export interface BlockerStatus {
  isActive: boolean;
  strategy: BlockingStrategy;
  blockedCount: number;
  blockedDomains: string[];
  lastError?: string;
  selfControlAvailable: boolean;
  hostsManageable: boolean;
}

export interface AppBlockerStatus {
  isActive: boolean;
  blockedApps: string[];
  blockedCount: number;
}

// A local hand-off written by Purpose. The mode ID is deliberately the only
// configuration reference: Control resolves it from its own stored Modes data
// and remains the sole owner of the timer and restriction engines.
export interface PurposeSessionRequest {
  version: 2;
  id: string;
  createdAt: string;
  modeId: string;
  purpose: string;
}

/** External companion command queued through the control:// scheme. */
export type CompanionCommandAction = 'note.upsert' | 'note.delete';

export interface CompanionCommand {
  version: 1;
  id: string;
  createdAt: string;
  action: CompanionCommandAction;
  note?: {
    id?: string;
    content?: string;
    folderId?: string;
  };
}

export interface InstalledAppInfo {
  name: string;
  path: string;
  bundleId?: string;
  icon?: string;
}

// ── Markdown Day Planner (Obsidian is the source of truth) ──────────────────
// Control reads/writes ordinary Markdown files inside the user's vault:
//   <vault>/Control/Templates/*.md
//   <vault>/Control/Days/YYYY-MM-DD.md
//   <vault>/Control/Tasks/*.md      (task notes, two-way checkbox sync)
// No proprietary database: progress lives in the checkboxes of the files.

export interface DayMdTask {
  /** Index among all checkbox lines in the file (0-based). Used for write-back. */
  index: number;
  title: string;
  completed: boolean;
  /** Minutes parsed from an optional "Duration: 25m" sub-bullet. */
  durationMinutes?: number;
  /** Parent section heading ("## Title"). Empty string when above all headings. */
  section: string;
  /** Global order among all tasks in the file. */
  order: number;
}

export interface DayMdSection {
  title: string;
  tasks: DayMdTask[];
}

export interface DayMarkdownPlan {
  date: string;
  exists: boolean;
  path: string;
  title: string;
  templateName?: string;
  sections: DayMdSection[];
  totalTasks: number;
  completedTasks: number;
  raw: string;
}

export interface PlannerTemplate {
  /** File name without the .md extension. */
  name: string;
  path: string;
  title: string;
  /** {{variable}} placeholders found in the template body. */
  variables: string[];
  taskCount: number;
  sectionCount: number;
  updatedAt: string;
}

export interface PlannerMdStatus {
  enabled: boolean;
  rootPath: string;
  daysDir: string;
  templatesDir: string;
  error?: string;
}

export interface PlannerMdOpResult {
  success: boolean;
  error?: string;
}

export interface ApplyTemplateResult extends PlannerMdOpResult {
  plan?: DayMarkdownPlan;
  /** True when an existing day file was replaced. */
  replaced?: boolean;
}

export interface PlannerMdTaskOpResult extends PlannerMdOpResult {
  plan?: DayMarkdownPlan;
}

export interface PlannerFileChangeEvent {
  kind: 'day' | 'template';
  fileName: string;
}

declare global {
  interface Window {
    controlAPI?: {
      getData: () => Promise<ControlAppData>;
      saveData: (data: ControlAppData) => Promise<boolean>;
      startBlocking: (domains: string[], strategy: BlockingStrategy) => Promise<{ success: boolean; error?: string }>;
      stopBlocking: () => Promise<{ success: boolean; error?: string }>;
      getBlockerStatus: () => Promise<BlockerStatus>;
      startAppBlocking: (apps: string[]) => Promise<{ success: boolean; error?: string }>;
      stopAppBlocking: () => Promise<{ success: boolean; error?: string }>;
      getAppBlockerStatus: () => Promise<AppBlockerStatus>;
      searchInstalledApps: (query: string) => Promise<InstalledAppInfo[]>;
      updateTraySession: (info: TraySessionInfo) => Promise<void>;
      updateTray: (text: string, title?: string, tooltip?: string) => Promise<void>;
      sendNotification: (title: string, body: string) => Promise<void>;
      setMinimalWindow: (isMinimal: boolean) => Promise<void>;
      setDockIconAppearance: (isDark: boolean) => Promise<void>;
      syncToGoogleCalendar: (blocks: ScheduleBlock[], config: GoogleCalendarConfig) => Promise<{ success: boolean; syncedCount: number; error?: string }>;
      exportToIcs: (blocks: ScheduleBlock[]) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      selectDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
      syncTasksToObsidian: (tasks: TaskItem[], modes: StudyMode[], config: ObsidianConfig) => Promise<ObsidianSyncResult>;
      readTasksFromObsidian: (config: ObsidianConfig) => Promise<TasksMdReadResult>;
      onTasksFileChanged: (callback: () => void) => () => void;
      openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
      setLaunchAtLogin: (enabled: boolean) => Promise<boolean>;
      openSelfControl: (blocklist: string[], minutes: number) => Promise<{ success: boolean; error?: string }>;
      confirmQuit: () => Promise<void>;
      requestQuit: () => Promise<void>;
      minimizeToTray: () => Promise<void>;
      setActivityTrackingEnabled: (enabled: boolean) => Promise<{ success: boolean; running?: boolean; error?: string }>;
      onActivitySample: (callback: (sample: ActivitySample) => void) => () => void;
      onDistractionBlocked: (callback: (event: DistractionEvent) => void) => () => void;
      openQuickNote: () => Promise<{ success: boolean; error?: string }>;
      saveQuickNote: (content: string) => Promise<{ success: boolean; note?: Note; error?: string }>;
      syncNotesToObsidian: (notes: Note[], folders: NoteFolder[], config: ObsidianConfig) => Promise<ObsidianSyncResult>;
      onNotesChanged: (callback: (notes: Note[]) => void) => () => void;
      getCompanionCommand: () => Promise<CompanionCommand | null>;
      acknowledgeCompanionCommand: (id: string) => Promise<boolean>;
      onCompanionCommand: (callback: (command: CompanionCommand) => void) => () => void;
      getPurposeSessionRequest: () => Promise<PurposeSessionRequest | null>;
      acknowledgePurposeSessionRequest: (id: string) => Promise<boolean>;
      onPurposeSessionRequested: (callback: () => void) => () => void;
      onTriggerLeaveModal: (callback: () => void) => () => void;
      onTrayAction: (callback: (action: string) => void) => () => void;
      plannerMdStatus: (vaultPath: string) => Promise<PlannerMdStatus>;
      plannerMdListTemplates: (vaultPath: string) => Promise<PlannerTemplate[]>;
      plannerMdReadDay: (vaultPath: string, date: string) => Promise<DayMarkdownPlan | null>;
      plannerMdApplyTemplate: (
        vaultPath: string,
        templateName: string,
        date: string,
        variables: Record<string, string>
      ) => Promise<ApplyTemplateResult>;
      plannerMdCreateTemplate: (
        vaultPath: string,
        name: string,
        content: string
      ) => Promise<PlannerMdOpResult & { template?: PlannerTemplate }>;
      plannerMdSaveDayAsTemplate: (
        vaultPath: string,
        date: string,
        name: string
      ) => Promise<PlannerMdOpResult & { template?: PlannerTemplate }>;
      plannerMdDuplicateTemplate: (
        vaultPath: string,
        name: string,
        newName: string
      ) => Promise<PlannerMdOpResult & { template?: PlannerTemplate }>;
      plannerMdDeleteTemplate: (vaultPath: string, name: string) => Promise<PlannerMdOpResult>;
      plannerMdToggleTask: (
        vaultPath: string,
        date: string,
        taskIndex: number,
        completed: boolean
      ) => Promise<PlannerMdTaskOpResult>;
      plannerMdUpdateTaskTitle: (
        vaultPath: string,
        date: string,
        taskIndex: number,
        title: string
      ) => Promise<PlannerMdTaskOpResult>;
      plannerMdOpenFile: (filePath: string) => Promise<PlannerMdOpResult>;
      plannerMdReadTemplate: (
        vaultPath: string,
        templateName: string
      ) => Promise<PlannerMdOpResult & { content?: string }>;
      plannerMdUpdateDaySchedule: (
        vaultPath: string,
        date: string,
        sectionBody: string
      ) => Promise<PlannerMdOpResult & { path?: string }>;
      plannerMdWriteTemplate: (
        vaultPath: string,
        name: string,
        content: string
      ) => Promise<PlannerMdOpResult & { template?: PlannerTemplate }>;
      onPlannerFileChanged: (
        callback: (payload: PlannerFileChangeEvent) => void
      ) => () => void;
      autoExecGetStatus: (date?: string) => Promise<AutoExecStatus>;
      autoExecNotifyStatus: () => Promise<{ supported: boolean }>;
      onAutoExecStart: (
        callback: (req: AutoExecStartRequest) => Promise<AutoExecStartResult>
      ) => () => void;
      onAutoExecEnd: (
        callback: (req: AutoExecEndRequest) => Promise<AutoExecEndResult>
      ) => () => void;
      googleCalendar?: {
        getStatus: () => Promise<GoogleSyncStatus>;
        getClientState: () => Promise<{ configured: boolean; source?: string; hasSecret?: boolean }>;
        setClientId: (clientId: string, clientSecret?: string) => Promise<{ success: boolean; error?: string }>;
        clearClientId: () => Promise<{ success: boolean; error?: string; removed?: boolean }>;
        getDiagnostics: () => Promise<{
          generatedAt: string;
          client: { configured: boolean; source?: string; hasSecret?: boolean };
          status: GoogleSyncStatus;
          log: string;
        }>;
        connect: () => Promise<GoogleConnectResult>;
        disconnect: (options?: { removeSyncedEvents?: boolean }) => Promise<GoogleDisconnectResult>;
        listCalendars: () => Promise<GoogleListCalendarsResult>;
        selectCalendar: (calendarId: string) => Promise<{ success: boolean; error?: string }>;
        syncNow: (options?: { full?: boolean }) => Promise<GoogleSyncNowResult>;
        applyChanges: (result: GoogleApplyResult, requestId: string) => Promise<void>;
        /** Tell the sync engine the renderer regained network connectivity. */
        notifyOnline: () => Promise<void>;
        onStatus: (callback: (status: GoogleSyncStatus) => void) => () => void;
        onApplyChanges: (
          callback: (mutations: GoogleApplyMutations) => Promise<GoogleApplyResult>
        ) => () => void;
      };
    };
  }
}
