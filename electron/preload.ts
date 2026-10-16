import { contextBridge, ipcRenderer } from 'electron';
import {
  ControlAppData, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, BlockerStatus,
  AppBlockerStatus, InstalledAppInfo, TraySessionInfo, PurposeSessionRequest, TaskItem,
  StudyMode, ObsidianConfig, ObsidianSyncResult, TasksMdReadResult, PlannerMdStatus, PlannerTemplate,
  DayMarkdownPlan, ApplyTemplateResult, PlannerMdOpResult, PlannerMdTaskOpResult,
  PlannerFileChangeEvent, ActivitySample, DistractionEvent, Note, NoteFolder, RoomTimerState, RoomsStatus, RoomsEvent,
  GoogleSyncStatus, GoogleApplyMutations, GoogleApplyResult, GoogleConnectResult,
  GoogleDisconnectResult, GoogleListCalendarsResult, GoogleSyncNowResult,
  AutoExecStatus, AutoExecStartRequest, AutoExecStartResult, AutoExecEndRequest, AutoExecEndResult,
} from '../src/types';

contextBridge.exposeInMainWorld('controlAPI', {
  getData: (): Promise<ControlAppData> => ipcRenderer.invoke('control:getData'),
  saveData: (data: ControlAppData): Promise<boolean> => ipcRenderer.invoke('control:saveData', data),
  startBlocking: (domains: string[], strategy: BlockingStrategy): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:startBlocking', domains, strategy),
  stopBlocking: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('control:stopBlocking'),
  getBlockerStatus: (): Promise<BlockerStatus> => ipcRenderer.invoke('control:getBlockerStatus'),
  startAppBlocking: (apps: string[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:startAppBlocking', apps),
  stopAppBlocking: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:stopAppBlocking'),
  getAppBlockerStatus: (): Promise<AppBlockerStatus> =>
    ipcRenderer.invoke('control:getAppBlockerStatus'),
  searchInstalledApps: (query: string): Promise<InstalledAppInfo[]> =>
    ipcRenderer.invoke('control:searchInstalledApps', query),
  updateTraySession: (info: TraySessionInfo): Promise<void> =>
    ipcRenderer.invoke('control:updateTraySession', info),
  updateTray: (text: string, title?: string, tooltip?: string): Promise<void> =>
    ipcRenderer.invoke('control:updateTray', text, title, tooltip),
  sendNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('control:sendNotification', title, body),
  setMinimalWindow: (isMinimal: boolean): Promise<void> =>
    ipcRenderer.invoke('control:setMinimalWindow', isMinimal),
  syncToGoogleCalendar: (blocks: ScheduleBlock[], config: GoogleCalendarConfig): Promise<{ success: boolean; syncedCount: number; error?: string }> =>
    ipcRenderer.invoke('control:syncToGoogleCalendar', blocks, config),
  exportToIcs: (blocks: ScheduleBlock[]): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('control:exportToIcs', blocks),
  selectDirectory: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('control:selectDirectory'),
  syncTasksToObsidian: (tasks: TaskItem[], modes: StudyMode[], config: ObsidianConfig): Promise<ObsidianSyncResult> =>
    ipcRenderer.invoke('control:syncToObsidian', tasks, modes, config),
  readTasksFromObsidian: (config: ObsidianConfig): Promise<TasksMdReadResult> =>
    ipcRenderer.invoke('control:tasksMdRead', config),
  onTasksFileChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('control:tasksFileChanged', handler);
    return () => {
      ipcRenderer.removeListener('control:tasksFileChanged', handler);
    };
  },
  openPath: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:openPath', targetPath),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('control:setLaunchAtLogin', enabled),
  openSelfControl: (blocklist: string[], minutes: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:openSelfControl', blocklist, minutes),
  confirmQuit: (): Promise<void> => ipcRenderer.invoke('control:confirmQuit'),
  requestQuit: (): Promise<void> => ipcRenderer.invoke('control:requestQuit'),
  minimizeToTray: (): Promise<void> => ipcRenderer.invoke('control:minimizeToTray'),
  // ── Optional frontmost-app activity tracking (off by default) ──────────
  setActivityTrackingEnabled: (enabled: boolean): Promise<{ success: boolean; running?: boolean; error?: string }> =>
    ipcRenderer.invoke('control:activitySetEnabled', enabled),
  onActivitySample: (callback: (sample: ActivitySample) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sample: ActivitySample) => callback(sample);
    ipcRenderer.on('control:activitySample', handler);
    return () => {
      ipcRenderer.removeListener('control:activitySample', handler);
    };
  },
  // ── Distraction autopsy: apps terminated while blocking was active ─────
  onDistractionBlocked: (callback: (event: DistractionEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, event: DistractionEvent) => callback(event);
    ipcRenderer.on('control:distractionBlocked', handler);
    return () => {
      ipcRenderer.removeListener('control:distractionBlocked', handler);
    };
  },
  // ── Quick notes (global shortcut + tray popup) ─────────────────────────
  openQuickNote: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('control:openQuickNote'),
  saveQuickNote: (content: string): Promise<{ success: boolean; note?: Note; error?: string }> =>
    ipcRenderer.invoke('control:saveQuickNote', content),
  onNotesChanged: (callback: (notes: Note[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, notes: Note[]) => callback(notes);
    ipcRenderer.on('control:notesChanged', handler);
    return () => {
      ipcRenderer.removeListener('control:notesChanged', handler);
    };
  },
  syncNotesToObsidian: (notes: Note[], folders: NoteFolder[], config: ObsidianConfig): Promise<ObsidianSyncResult> =>
    ipcRenderer.invoke('control:syncNotesToObsidian', notes, folders, config),
  // ── LAN control rooms (no accounts, no cloud) ────────────────────────────
  rooms: {
    getStatus: (): Promise<RoomsStatus> => ipcRenderer.invoke('control:roomsGetStatus'),
    hostStart: (room: string, name: string): Promise<{ success: boolean; port?: number; error?: string }> =>
      ipcRenderer.invoke('control:roomsHostStart', room, name),
    hostStop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('control:roomsHostStop'),
    publish: (state: RoomTimerState | null): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('control:roomsPublish', state),
    join: (host: string, port: number, name: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('control:roomsJoin', host, port, name),
    leave: (): Promise<{ success: boolean }> => ipcRenderer.invoke('control:roomsLeave'),
    onEvent: (callback: (event: RoomsEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, event: RoomsEvent) => callback(event);
      ipcRenderer.on('control:roomsEvent', handler);
      return () => {
        ipcRenderer.removeListener('control:roomsEvent', handler);
      };
    },
  },
  getPurposeSessionRequest: (): Promise<PurposeSessionRequest | null> =>
    ipcRenderer.invoke('control:getPurposeSessionRequest'),
  acknowledgePurposeSessionRequest: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('control:acknowledgePurposeSessionRequest', id),
  onPurposeSessionRequested: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('control:purposeSessionRequested', handler);
    return () => {
      ipcRenderer.removeListener('control:purposeSessionRequested', handler);
    };
  },
  onTriggerLeaveModal: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('control:triggerLeaveModal', handler);
    return () => {
      ipcRenderer.removeListener('control:triggerLeaveModal', handler);
    };
  },
  onTrayAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('control:trayAction', handler);
    return () => {
      ipcRenderer.removeListener('control:trayAction', handler);
    };
  },
  plannerMdStatus: (vaultPath: string): Promise<PlannerMdStatus> =>
    ipcRenderer.invoke('control:plannerMdStatus', vaultPath),
  plannerMdListTemplates: (vaultPath: string): Promise<PlannerTemplate[]> =>
    ipcRenderer.invoke('control:plannerMdListTemplates', vaultPath),
  plannerMdReadDay: (vaultPath: string, date: string): Promise<DayMarkdownPlan | null> =>
    ipcRenderer.invoke('control:plannerMdReadDay', vaultPath, date),
  plannerMdApplyTemplate: (
    vaultPath: string,
    templateName: string,
    date: string,
    variables: Record<string, string>
  ): Promise<ApplyTemplateResult> =>
    ipcRenderer.invoke('control:plannerMdApplyTemplate', vaultPath, templateName, date, variables),
  plannerMdCreateTemplate: (
    vaultPath: string,
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('control:plannerMdCreateTemplate', vaultPath, name, content),
  plannerMdSaveDayAsTemplate: (
    vaultPath: string,
    date: string,
    name: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('control:plannerMdSaveDayAsTemplate', vaultPath, date, name),
  plannerMdDuplicateTemplate: (
    vaultPath: string,
    name: string,
    newName: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('control:plannerMdDuplicateTemplate', vaultPath, name, newName),
  plannerMdDeleteTemplate: (vaultPath: string, name: string): Promise<PlannerMdOpResult> =>
    ipcRenderer.invoke('control:plannerMdDeleteTemplate', vaultPath, name),
  plannerMdWriteTemplate: (
    vaultPath: string,
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('control:plannerMdWriteTemplate', vaultPath, name, content),
  plannerMdToggleTask: (
    vaultPath: string,
    date: string,
    taskIndex: number,
    completed: boolean
  ): Promise<PlannerMdTaskOpResult> =>
    ipcRenderer.invoke('control:plannerMdToggleTask', vaultPath, date, taskIndex, completed),
  plannerMdUpdateTaskTitle: (
    vaultPath: string,
    date: string,
    taskIndex: number,
    title: string
  ): Promise<PlannerMdTaskOpResult> =>
    ipcRenderer.invoke('control:plannerMdUpdateTaskTitle', vaultPath, date, taskIndex, title),
  plannerMdOpenFile: (filePath: string): Promise<PlannerMdOpResult> =>
    ipcRenderer.invoke('control:plannerMdOpenFile', filePath),
  plannerMdReadTemplate: (
    vaultPath: string,
    templateName: string
  ): Promise<PlannerMdOpResult & { content?: string }> =>
    ipcRenderer.invoke('control:plannerMdReadTemplate', vaultPath, templateName),
  plannerMdUpdateDaySchedule: (
    vaultPath: string,
    date: string,
    sectionBody: string
  ): Promise<PlannerMdOpResult & { path?: string }> =>
    ipcRenderer.invoke('control:plannerMdUpdateDaySchedule', vaultPath, date, sectionBody),
  onPlannerFileChanged: (callback: (payload: PlannerFileChangeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PlannerFileChangeEvent) =>
      callback(payload);
    ipcRenderer.on('control:plannerFileChanged', handler);
    return () => {
      ipcRenderer.removeListener('control:plannerFileChanged', handler);
    };
  },
  // ── Automatic study-day execution (main scheduler → renderer session) ──
  autoExecGetStatus: (date?: string): Promise<AutoExecStatus> =>
    ipcRenderer.invoke('control:autoExec:getStatus', date),
  autoExecNotifyStatus: (): Promise<{ supported: boolean }> =>
    ipcRenderer.invoke('control:autoExec:notifyStatus'),
  onAutoExecStart: (
    callback: (req: AutoExecStartRequest) => Promise<AutoExecStartResult>
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, req: AutoExecStartRequest) => {
      Promise.resolve(callback(req))
        .then((result) => ipcRenderer.invoke('control:autoExec:startResult', result, req.requestId))
        .catch((err: unknown) =>
          ipcRenderer.invoke('control:autoExec:startResult', {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }, req.requestId)
        );
    };
    ipcRenderer.on('control:autoExec:start', handler);
    return () => {
      ipcRenderer.removeListener('control:autoExec:start', handler);
    };
  },
  onAutoExecEnd: (
    callback: (req: AutoExecEndRequest) => Promise<AutoExecEndResult>
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, req: AutoExecEndRequest) => {
      Promise.resolve(callback(req))
        .then((result) => ipcRenderer.invoke('control:autoExec:endResult', result, req.requestId))
        .catch((err: unknown) =>
          ipcRenderer.invoke('control:autoExec:endResult', {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }, req.requestId)
        );
    };
    ipcRenderer.on('control:autoExec:end', handler);
    return () => {
      ipcRenderer.removeListener('control:autoExec:end', handler);
    };
  },
  // ── Google Calendar two-way sync (tokens never reach the renderer) ───────
  googleCalendar: {
    getStatus: (): Promise<GoogleSyncStatus> => ipcRenderer.invoke('control:google:getStatus'),
    getClientState: (): Promise<{ configured: boolean; source?: string; hasSecret?: boolean }> =>
      ipcRenderer.invoke('control:google:getClientState'),
    setClientId: (clientId: string, clientSecret?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('control:google:setClientId', clientId, clientSecret),
    clearClientId: (): Promise<{ success: boolean; error?: string; removed?: boolean }> =>
      ipcRenderer.invoke('control:google:clearClientId'),
    connect: (): Promise<GoogleConnectResult> => ipcRenderer.invoke('control:google:connect'),
    disconnect: (options?: { removeSyncedEvents?: boolean }): Promise<GoogleDisconnectResult> =>
      ipcRenderer.invoke('control:google:disconnect', options),
    listCalendars: (): Promise<GoogleListCalendarsResult> =>
      ipcRenderer.invoke('control:google:listCalendars'),
    selectCalendar: (calendarId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('control:google:selectCalendar', calendarId),
    syncNow: (options?: { full?: boolean }): Promise<GoogleSyncNowResult> =>
      ipcRenderer.invoke('control:google:syncNow', options),
    applyChanges: (result: GoogleApplyResult, requestId: string): Promise<void> =>
      ipcRenderer.invoke('control:google:applyChanges', result, requestId).then(() => undefined),
    notifyOnline: (): Promise<void> =>
      ipcRenderer.invoke('control:google:notifyOnline').then(() => undefined),
    getDiagnostics: (): Promise<{
      generatedAt: string;
      client: { configured: boolean; source?: string; hasSecret?: boolean };
      status: GoogleSyncStatus;
      log: string;
    }> => ipcRenderer.invoke('control:google:getDiagnostics'),
    onStatus: (callback: (status: GoogleSyncStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: GoogleSyncStatus) =>
        callback(status);
      ipcRenderer.on('control:google:status', handler);
      return () => {
        ipcRenderer.removeListener('control:google:status', handler);
      };
    },
    onApplyChanges: (
      callback: (mutations: GoogleApplyMutations) => Promise<GoogleApplyResult>
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, mutations: GoogleApplyMutations) => {
        Promise.resolve(callback(mutations))
          .then((result) => ipcRenderer.invoke('control:google:applyChanges', result, mutations.requestId))
          .catch((err: unknown) =>
            ipcRenderer.invoke('control:google:applyChanges', {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }, mutations.requestId)
          );
      };
      ipcRenderer.on('control:google:apply', handler);
      return () => {
        ipcRenderer.removeListener('control:google:apply', handler);
      };
    },
  },
});
