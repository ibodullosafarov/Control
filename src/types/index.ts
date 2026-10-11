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

export interface StudyMode {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  workDuration: number; // in minutes
  breakDuration: number; // in minutes
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
  /** Origin of this task: mirrored from calendar or manual user task. */
  source?: 'calendar' | 'manual';
  /** If mirrored from a schedule block, the block.id. */
  sourceId?: string;
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

  // Tasks linked to this session:
  taskIds: string[]; // IDs of tasks in this session
  activeTaskId: string | null;
  completedTaskIds: string[];

  // Restriction & session metadata:
  blocklist: string[];
  blockedApps: string[];
  blockingStrategy: BlockingStrategy;
  /**
   * Per-session Focus override (e.g. from a schedule template block).
   * True forces enforcement, false suppresses it for the whole session,
   * undefined follows the mode's own rules.
   */
  blockingOverride?: boolean;
  countTowardStats: boolean;
  startedAt: string; // ISO string
}

export interface TraySessionInfo {
  isActive: boolean;
  timeRemainingStr: string;
  currentTaskTitle?: string;
  remainingTasksCount?: number;
  isPaused: boolean;
  modeName?: string;
}

export interface FocusSession {
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
}

export interface ScheduleBlock {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
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
  /** Focus Mode preference for this session. Undefined = follow the mode's rules. */
  focusMode?: boolean;
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
  /** False when running outside Electron (no focusAPI bridge). */
  available: boolean;
  /** OAuth client credentials resolvable (env / ~/.focus-app/google-oauth.json). */
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
  googleCalendar: GoogleCalendarConfig;
  obsidian?: ObsidianConfig;
  minimalModeOnFocus: boolean;
  reducedMotion?: boolean;
  /** Legibility-optimized typography for readers with dyslexia. */
  dyslexicFont?: boolean;
  /** Automatic study-day execution (notifications + scheduled focus sessions). */
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

export interface FocusAppData {
  modes: StudyMode[];
  sessions: FocusSession[];
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
    focusAPI?: {
      getData: () => Promise<FocusAppData>;
      saveData: (data: FocusAppData) => Promise<boolean>;
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
