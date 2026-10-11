import { contextBridge, ipcRenderer } from 'electron';
import {
  FocusAppData, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, BlockerStatus,
  AppBlockerStatus, InstalledAppInfo, TraySessionInfo, PurposeSessionRequest, TaskItem,
  StudyMode, ObsidianConfig, ObsidianSyncResult, TasksMdReadResult, PlannerMdStatus, PlannerTemplate,
  DayMarkdownPlan, ApplyTemplateResult, PlannerMdOpResult, PlannerMdTaskOpResult,
  PlannerFileChangeEvent,
  GoogleSyncStatus, GoogleApplyMutations, GoogleApplyResult, GoogleConnectResult,
  GoogleDisconnectResult, GoogleListCalendarsResult, GoogleSyncNowResult,
  AutoExecStatus, AutoExecStartRequest, AutoExecStartResult, AutoExecEndRequest, AutoExecEndResult,
} from '../src/types';

contextBridge.exposeInMainWorld('focusAPI', {
  getData: (): Promise<FocusAppData> => ipcRenderer.invoke('focus:getData'),
  saveData: (data: FocusAppData): Promise<boolean> => ipcRenderer.invoke('focus:saveData', data),
  startBlocking: (domains: string[], strategy: BlockingStrategy): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('focus:startBlocking', domains, strategy),
  stopBlocking: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('focus:stopBlocking'),
  getBlockerStatus: (): Promise<BlockerStatus> => ipcRenderer.invoke('focus:getBlockerStatus'),
  startAppBlocking: (apps: string[]): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('focus:startAppBlocking', apps),
  stopAppBlocking: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('focus:stopAppBlocking'),
  getAppBlockerStatus: (): Promise<AppBlockerStatus> =>
    ipcRenderer.invoke('focus:getAppBlockerStatus'),
  searchInstalledApps: (query: string): Promise<InstalledAppInfo[]> =>
    ipcRenderer.invoke('focus:searchInstalledApps', query),
  updateTraySession: (info: TraySessionInfo): Promise<void> =>
    ipcRenderer.invoke('focus:updateTraySession', info),
  updateTray: (text: string, title?: string, tooltip?: string): Promise<void> =>
    ipcRenderer.invoke('focus:updateTray', text, title, tooltip),
  sendNotification: (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('focus:sendNotification', title, body),
  setMinimalWindow: (isMinimal: boolean): Promise<void> =>
    ipcRenderer.invoke('focus:setMinimalWindow', isMinimal),
  syncToGoogleCalendar: (blocks: ScheduleBlock[], config: GoogleCalendarConfig): Promise<{ success: boolean; syncedCount: number; error?: string }> =>
    ipcRenderer.invoke('focus:syncToGoogleCalendar', blocks, config),
  exportToIcs: (blocks: ScheduleBlock[]): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('focus:exportToIcs', blocks),
  selectDirectory: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('focus:selectDirectory'),
  syncTasksToObsidian: (tasks: TaskItem[], modes: StudyMode[], config: ObsidianConfig): Promise<ObsidianSyncResult> =>
    ipcRenderer.invoke('focus:syncToObsidian', tasks, modes, config),
  readTasksFromObsidian: (config: ObsidianConfig): Promise<TasksMdReadResult> =>
    ipcRenderer.invoke('focus:tasksMdRead', config),
  onTasksFileChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('focus:tasksFileChanged', handler);
    return () => {
      ipcRenderer.removeListener('focus:tasksFileChanged', handler);
    };
  },
  openPath: (targetPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('focus:openPath', targetPath),
  setLaunchAtLogin: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke('focus:setLaunchAtLogin', enabled),
  openSelfControl: (blocklist: string[], minutes: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('focus:openSelfControl', blocklist, minutes),
  confirmQuit: (): Promise<void> => ipcRenderer.invoke('focus:confirmQuit'),
  requestQuit: (): Promise<void> => ipcRenderer.invoke('focus:requestQuit'),
  minimizeToTray: (): Promise<void> => ipcRenderer.invoke('focus:minimizeToTray'),
  getPurposeSessionRequest: (): Promise<PurposeSessionRequest | null> =>
    ipcRenderer.invoke('focus:getPurposeSessionRequest'),
  acknowledgePurposeSessionRequest: (id: string): Promise<boolean> =>
    ipcRenderer.invoke('focus:acknowledgePurposeSessionRequest', id),
  onPurposeSessionRequested: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('focus:purposeSessionRequested', handler);
    return () => {
      ipcRenderer.removeListener('focus:purposeSessionRequested', handler);
    };
  },
  onTriggerLeaveModal: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('focus:triggerLeaveModal', handler);
    return () => {
      ipcRenderer.removeListener('focus:triggerLeaveModal', handler);
    };
  },
  onTrayAction: (callback: (action: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('focus:trayAction', handler);
    return () => {
      ipcRenderer.removeListener('focus:trayAction', handler);
    };
  },
  plannerMdStatus: (vaultPath: string): Promise<PlannerMdStatus> =>
    ipcRenderer.invoke('focus:plannerMdStatus', vaultPath),
  plannerMdListTemplates: (vaultPath: string): Promise<PlannerTemplate[]> =>
    ipcRenderer.invoke('focus:plannerMdListTemplates', vaultPath),
  plannerMdReadDay: (vaultPath: string, date: string): Promise<DayMarkdownPlan | null> =>
    ipcRenderer.invoke('focus:plannerMdReadDay', vaultPath, date),
  plannerMdApplyTemplate: (
    vaultPath: string,
    templateName: string,
    date: string,
    variables: Record<string, string>
  ): Promise<ApplyTemplateResult> =>
    ipcRenderer.invoke('focus:plannerMdApplyTemplate', vaultPath, templateName, date, variables),
  plannerMdCreateTemplate: (
    vaultPath: string,
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('focus:plannerMdCreateTemplate', vaultPath, name, content),
  plannerMdSaveDayAsTemplate: (
    vaultPath: string,
    date: string,
    name: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('focus:plannerMdSaveDayAsTemplate', vaultPath, date, name),
  plannerMdDuplicateTemplate: (
    vaultPath: string,
    name: string,
    newName: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('focus:plannerMdDuplicateTemplate', vaultPath, name, newName),
  plannerMdDeleteTemplate: (vaultPath: string, name: string): Promise<PlannerMdOpResult> =>
    ipcRenderer.invoke('focus:plannerMdDeleteTemplate', vaultPath, name),
  plannerMdWriteTemplate: (
    vaultPath: string,
    name: string,
    content: string
  ): Promise<PlannerMdOpResult & { template?: PlannerTemplate }> =>
    ipcRenderer.invoke('focus:plannerMdWriteTemplate', vaultPath, name, content),
  plannerMdToggleTask: (
    vaultPath: string,
    date: string,
    taskIndex: number,
    completed: boolean
  ): Promise<PlannerMdTaskOpResult> =>
    ipcRenderer.invoke('focus:plannerMdToggleTask', vaultPath, date, taskIndex, completed),
  plannerMdUpdateTaskTitle: (
    vaultPath: string,
    date: string,
    taskIndex: number,
    title: string
  ): Promise<PlannerMdTaskOpResult> =>
    ipcRenderer.invoke('focus:plannerMdUpdateTaskTitle', vaultPath, date, taskIndex, title),
  plannerMdOpenFile: (filePath: string): Promise<PlannerMdOpResult> =>
    ipcRenderer.invoke('focus:plannerMdOpenFile', filePath),
  plannerMdReadTemplate: (
    vaultPath: string,
    templateName: string
  ): Promise<PlannerMdOpResult & { content?: string }> =>
    ipcRenderer.invoke('focus:plannerMdReadTemplate', vaultPath, templateName),
  plannerMdUpdateDaySchedule: (
    vaultPath: string,
    date: string,
    sectionBody: string
  ): Promise<PlannerMdOpResult & { path?: string }> =>
    ipcRenderer.invoke('focus:plannerMdUpdateDaySchedule', vaultPath, date, sectionBody),
  onPlannerFileChanged: (callback: (payload: PlannerFileChangeEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PlannerFileChangeEvent) =>
      callback(payload);
    ipcRenderer.on('focus:plannerFileChanged', handler);
    return () => {
      ipcRenderer.removeListener('focus:plannerFileChanged', handler);
    };
  },
  // ── Automatic study-day execution (main scheduler → renderer session) ──
  autoExecGetStatus: (date?: string): Promise<AutoExecStatus> =>
    ipcRenderer.invoke('focus:autoExec:getStatus', date),
  autoExecNotifyStatus: (): Promise<{ supported: boolean }> =>
    ipcRenderer.invoke('focus:autoExec:notifyStatus'),
  onAutoExecStart: (
    callback: (req: AutoExecStartRequest) => Promise<AutoExecStartResult>
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, req: AutoExecStartRequest) => {
      Promise.resolve(callback(req))
        .then((result) => ipcRenderer.invoke('focus:autoExec:startResult', result, req.requestId))
        .catch((err: unknown) =>
          ipcRenderer.invoke('focus:autoExec:startResult', {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }, req.requestId)
        );
    };
    ipcRenderer.on('focus:autoExec:start', handler);
    return () => {
      ipcRenderer.removeListener('focus:autoExec:start', handler);
    };
  },
  onAutoExecEnd: (
    callback: (req: AutoExecEndRequest) => Promise<AutoExecEndResult>
  ) => {
    const handler = (_event: Electron.IpcRendererEvent, req: AutoExecEndRequest) => {
      Promise.resolve(callback(req))
        .then((result) => ipcRenderer.invoke('focus:autoExec:endResult', result, req.requestId))
        .catch((err: unknown) =>
          ipcRenderer.invoke('focus:autoExec:endResult', {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          }, req.requestId)
        );
    };
    ipcRenderer.on('focus:autoExec:end', handler);
    return () => {
      ipcRenderer.removeListener('focus:autoExec:end', handler);
    };
  },
  // ── Google Calendar two-way sync (tokens never reach the renderer) ───────
  googleCalendar: {
    getStatus: (): Promise<GoogleSyncStatus> => ipcRenderer.invoke('focus:google:getStatus'),
    getClientState: (): Promise<{ configured: boolean; source?: string; hasSecret?: boolean }> =>
      ipcRenderer.invoke('focus:google:getClientState'),
    setClientId: (clientId: string, clientSecret?: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('focus:google:setClientId', clientId, clientSecret),
    clearClientId: (): Promise<{ success: boolean; error?: string; removed?: boolean }> =>
      ipcRenderer.invoke('focus:google:clearClientId'),
    connect: (): Promise<GoogleConnectResult> => ipcRenderer.invoke('focus:google:connect'),
    disconnect: (options?: { removeSyncedEvents?: boolean }): Promise<GoogleDisconnectResult> =>
      ipcRenderer.invoke('focus:google:disconnect', options),
    listCalendars: (): Promise<GoogleListCalendarsResult> =>
      ipcRenderer.invoke('focus:google:listCalendars'),
    selectCalendar: (calendarId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('focus:google:selectCalendar', calendarId),
    syncNow: (options?: { full?: boolean }): Promise<GoogleSyncNowResult> =>
      ipcRenderer.invoke('focus:google:syncNow', options),
    applyChanges: (result: GoogleApplyResult, requestId: string): Promise<void> =>
      ipcRenderer.invoke('focus:google:applyChanges', result, requestId).then(() => undefined),
    notifyOnline: (): Promise<void> =>
      ipcRenderer.invoke('focus:google:notifyOnline').then(() => undefined),
    getDiagnostics: (): Promise<{
      generatedAt: string;
      client: { configured: boolean; source?: string; hasSecret?: boolean };
      status: GoogleSyncStatus;
      log: string;
    }> => ipcRenderer.invoke('focus:google:getDiagnostics'),
    onStatus: (callback: (status: GoogleSyncStatus) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: GoogleSyncStatus) =>
        callback(status);
      ipcRenderer.on('focus:google:status', handler);
      return () => {
        ipcRenderer.removeListener('focus:google:status', handler);
      };
    },
    onApplyChanges: (
      callback: (mutations: GoogleApplyMutations) => Promise<GoogleApplyResult>
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, mutations: GoogleApplyMutations) => {
        Promise.resolve(callback(mutations))
          .then((result) => ipcRenderer.invoke('focus:google:applyChanges', result, mutations.requestId))
          .catch((err: unknown) =>
            ipcRenderer.invoke('focus:google:applyChanges', {
              success: false,
              error: err instanceof Error ? err.message : String(err),
            }, mutations.requestId)
          );
      };
      ipcRenderer.on('focus:google:apply', handler);
      return () => {
        ipcRenderer.removeListener('focus:google:apply', handler);
      };
    },
  },
});
