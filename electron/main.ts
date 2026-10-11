import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { localStore } from './store';
import { blocker, appBlocker } from './blocker';
import { calendarManager } from './calendar';
import { obsidianManager } from './obsidian';
import { plannerMarkdown } from './plannerMarkdown';
import { GoogleSyncService } from './google/service';
import { AutoExecService } from './autoexec';
import { FocusAppData, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, PurposeSessionRequest, TaskItem, StudyMode, ObsidianConfig } from '../src/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let purposeRequestPoller: ReturnType<typeof setInterval> | null = null;

// Google Calendar two-way sync — main process owns OAuth, tokens and the engine.
const googleSync = new GoogleSyncService({
  getWindow: () => mainWindow,
  getData: () => localStore.get(),
});
const autoExec = new AutoExecService({
  getWindow: () => mainWindow,
  getData: () => localStore.get(),
  showWindow: () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  },
});

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const PURPOSE_REQUEST_FILE = path.join(os.homedir(), '.focus-app', 'purpose-session-request.json');

function getPurposeSessionRequest(): PurposeSessionRequest | null {
  try {
    if (!fs.existsSync(PURPOSE_REQUEST_FILE)) return null;
    const request = JSON.parse(fs.readFileSync(PURPOSE_REQUEST_FILE, 'utf-8')) as PurposeSessionRequest;
    if (
      request.version !== 2 ||
      typeof request.id !== 'string' ||
      typeof request.modeId !== 'string' ||
      typeof request.purpose !== 'string'
    ) {
      return null;
    }
    return request;
  } catch (error) {
    console.warn('Unable to read Purpose session request:', error);
    return null;
  }
}

function acknowledgePurposeSessionRequest(id: string): boolean {
  const request = getPurposeSessionRequest();
  if (!request || request.id !== id) return false;
  try {
    fs.unlinkSync(PURPOSE_REQUEST_FILE);
    return true;
  } catch (error) {
    console.warn('Unable to acknowledge Purpose session request:', error);
    return false;
  }
}

function notifyPurposeSessionIfPresent() {
  if (getPurposeSessionRequest() && mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.webContents.send('focus:purposeSessionRequested');
  }
}

function startPurposeRequestWatcher() {
  if (purposeRequestPoller) return;
  // Polling is intentional here. It works whether Purpose launches a fresh
  // Control process or hands off to one that is already running.
  purposeRequestPoller = setInterval(notifyPurposeSessionIfPresent, 700);
}

function getAppLogoPath(): string | undefined {
  const appPath = app.getAppPath();
  const iconCandidates = [
    path.join(appPath, 'icon.png'),
    path.join(appPath, 'logo.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, 'logo.png'),
    path.join(__dirname, '../../icon.png'),
    path.join(__dirname, '../icon.png'),
    path.join(__dirname, 'icon.png'),
    path.join(appPath, 'assets', 'logo.png'),
    path.join(process.resourcesPath, 'assets', 'logo.png'),
    path.join(appPath, 'icons', 'icon.png'),
    path.join(appPath, 'icons', 'icon-1024.png'),
  ];
  return iconCandidates.find((p) => fs.existsSync(p));
}

function applyAppDockIcon() {
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = getAppLogoPath();
    if (iconPath) {
      try {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          app.dock.setIcon(icon);
        }
      } catch (err) {
        console.warn('Unable to set dock icon:', err);
      }
    }
  }
}

function createMainWindow() {
  applyAppDockIcon();
  const appLogo = getAppLogoPath();
  const appIcon = appLogo ? nativeImage.createFromPath(appLogo) : undefined;

  const appPath = app.getAppPath();
  const preloadCandidates = [
    path.join(appPath, 'dist-electron/electron/preload.js'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '../preload.js'),
  ];
  const preloadPath = preloadCandidates.find((p) => fs.existsSync(p)) || preloadCandidates[0];

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 820,
    minHeight: 620,
    title: 'Control',
    icon: appIcon,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 16 },
    backgroundColor: '#090a0f',
    show: false,
    fullscreen: false,
    fullscreenable: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error('Focus renderer failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Focus renderer loaded successfully.');
    notifyPurposeSessionIfPresent();
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexCandidates = [
      path.join(appPath, 'dist/index.html'),
      path.join(__dirname, '../../dist/index.html'),
      path.join(__dirname, '../dist/index.html'),
    ];
    const indexPath = indexCandidates.find((p) => fs.existsSync(p)) || indexCandidates[0];
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (e) => {
    if (isQuitting) {
      return;
    }

    const isActive = currentTrayInfo && currentTrayInfo.isActive;
    if (isActive) {
      // If a focus session is actively running, show the confirmation modal without time restriction
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('focus:triggerLeaveModal');
      }
    } else {
      // No active session: gracefully hide window to macOS tray if tray is active, or allow close
      if (process.platform === 'darwin') {
        e.preventDefault();
        mainWindow?.hide();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    googleSync.onWindowFocus();
  });
}

import { TraySessionInfo } from '../src/types';

let currentTrayInfo: TraySessionInfo | null = null;
let lastMenuKey = '';
let lastTitle = '';
let lastTooltip = '';

function updateTrayMenu(info?: TraySessionInfo | null) {
  if (!tray) return;
  if (info !== undefined) {
    currentTrayInfo = info;
  }

  const active = !!(currentTrayInfo && currentTrayInfo.isActive);

  if (active && currentTrayInfo) {
    const timeStr = currentTrayInfo.timeRemainingStr || '';
    const taskTitle = currentTrayInfo.currentTaskTitle ? `Task: ${currentTrayInfo.currentTaskTitle}` : 'No active task';
    const remainingCount = currentTrayInfo.remainingTasksCount !== undefined ? `${currentTrayInfo.remainingTasksCount} tasks remaining` : '';
    const modeName = currentTrayInfo.modeName || 'Control';
    const titleToSet = timeStr ? ` ${timeStr}` : '';
    const tooltipToSet = `Control — ${timeStr} (${modeName})`;

    if (titleToSet !== lastTitle) {
      lastTitle = titleToSet;
      try {
        if (process.platform === 'darwin') {
          tray.setTitle(titleToSet, { fontType: 'monospacedDigit' });
        } else {
          tray.setTitle(titleToSet);
        }
      } catch {}
    }

    if (tooltipToSet !== lastTooltip) {
      lastTooltip = tooltipToSet;
      try {
        tray.setToolTip(tooltipToSet);
      } catch {}
    }

    // Only rebuild the context menu when the actionable/descriptive items change.
    // Rebuilding every second causes macOS status item flickering!
    const menuKey = `active_${currentTrayInfo.isPaused}_${taskTitle}_${remainingCount}_${modeName}`;
    if (menuKey !== lastMenuKey) {
      lastMenuKey = menuKey;

      const menuTemplate: Electron.MenuItemConstructorOptions[] = [
        {
          label: `${modeName} Session`,
          enabled: false,
        },
        {
          label: taskTitle,
          enabled: false,
        },
      ];

      if (remainingCount) {
        menuTemplate.push({
          label: remainingCount,
          enabled: false,
        });
      }

      menuTemplate.push(
        { type: 'separator' },
        {
          label: currentTrayInfo.isPaused ? 'Resume Session' : 'Pause Session',
          click: () => {
            mainWindow?.webContents.send('focus:trayAction', 'togglePause');
          },
        },
        {
          label: 'Next Task',
          click: () => {
            mainWindow?.webContents.send('focus:trayAction', 'nextTask');
          },
        },
        {
          label: 'End Session',
          click: () => {
            mainWindow?.webContents.send('focus:trayAction', 'endSession');
          },
        },
        { type: 'separator' },
        {
          label: 'Open Control',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              createMainWindow();
            }
          },
        },
        {
          label: 'Emergency Unblock Distractions',
          click: async () => {
            await appBlocker.stopBlocking();
            await blocker.stopBlocking();
            new Notification({ title: 'Control', body: 'All distraction blocks disabled.' }).show();
          },
        },
        { type: 'separator' },
        {
          label: 'Quit Control',
          click: async () => {
            await appBlocker.stopBlocking();
            await blocker.stopBlocking();
            app.exit(0);
          },
        }
      );

      const contextMenu = Menu.buildFromTemplate(menuTemplate);
      tray.setContextMenu(contextMenu);
    }
  } else {
    if (lastTitle !== '') {
      lastTitle = '';
      try {
        tray.setTitle('');
      } catch {}
    }
    const tooltipToSet = 'Control — Personal Study System';
    if (tooltipToSet !== lastTooltip) {
      lastTooltip = tooltipToSet;
      try {
        tray.setToolTip(tooltipToSet);
      } catch {}
    }

    const menuKey = 'ready';
    if (menuKey !== lastMenuKey) {
      lastMenuKey = menuKey;
      const contextMenu = Menu.buildFromTemplate([
        {
          label: 'Control — Ready',
          enabled: false,
        },
        { type: 'separator' },
        {
          label: 'Open Control',
          click: () => {
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            } else {
              createMainWindow();
            }
          },
        },
        {
          label: 'Emergency Unblock Distractions',
          click: async () => {
            await appBlocker.stopBlocking();
            await blocker.stopBlocking();
            new Notification({ title: 'Control', body: 'All distraction blocks disabled.' }).show();
          },
        },
        { type: 'separator' },
        {
          label: 'Quit Control',
          click: async () => {
            await appBlocker.stopBlocking();
            await blocker.stopBlocking();
            app.exit(0);
          },
        },
      ]);
      tray.setContextMenu(contextMenu);
    }
  }
}

const FALLBACK_TRAY_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAABGdBTUEAALGPC/xhBQAAACBjSFJNAAB6JgAAgIQAAPoAAACA6AAAdTAAAOpgAAA6mAAAF3CculE8AAAAeGVYSWZNTQAqAAAACAAEARoABQAAAAEAAAA+ARsABQAAAAEAAABGASgAAwAAAAEAAgAAh2kABAAAAAEAAABOAAAAAAAAAJAAAAABAAAAkAAAAAEAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAEqADAAQAAAABAAAAEgAAAABIJAr0AAAACXBIWXMAABYlAAAWJQFJUiTwAAACmmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyIKICAgICAgICAgICAgeG1sbnM6ZXhpZj0iaHR0cDovL25zLmFkb2JlLmNvbS9leGlmLzEuMC8iPgogICAgICAgICA8dGlmZjpYUmVzb2x1dGlvbj4xNDQ8L3RpZmY6WFJlc29sdXRpb24+CiAgICAgICAgIDx0aWZmOllSZXNvbHV0aW9uPjE0NDwvdGlmZjpZUmVzb2x1dGlvbj4KICAgICAgICAgPHRpZmY6UmVzb2x1dGlvblVuaXQ+MjwvdGlmZjpSZXNvbHV0aW9uVW5pdD4KICAgICAgICAgPGV4aWY6UGl4ZWxZRGltZW5zaW9uPjM2PC9leGlmOlBpeGVsWURpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6UGl4ZWxYRGltZW5zaW9uPjM2PC9leGlmOlBpeGVsWERpbWVuc2lvbj4KICAgICAgICAgPGV4aWY6Q29sb3JTcGFjZT4xPC9leGlmOkNvbG9yU3BhY2U+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoK3TUEAAABAklEQVQ4EWNgGGyAEYeD9IDi9kCsBsT/gfgaEB8A4htATBQQBaqaCcSfgBhkADJ+B+R3AzEfEOMFIkDZw0AM0/wcyN4DxPuA+A2S+EYgmx+IsQKQF+cBMciQP0DcCcRSQAwSZwZiRSCeAcQwS8KAbKzACCj6DYhBCtuwqoAI1gGp9UAsi0tNBVARZMhDIAaFEz6gCpS0BWImbIoWAAVBBm3BJokkBgrHu0D8F4ijkcThpoIMAQFQmFAEyoG6qeI15MBux+OkWqAc3sAGeWku1FW/gTQo+qWBGCROUvQD1TMQmyA3ANXiTJAgg0CAUBbpAqrhBatEI3DFEsWZFs2eAeACACSJR86fJ6hvAAAAAElFTkSuQmCC';

function getTrayIcon(): Electron.NativeImage {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, 'assets', 'trayTemplate.png'),
    path.join(process.resourcesPath, 'assets', 'trayTemplate.png'),
    path.join(__dirname, '../../assets', 'trayTemplate.png'),
    path.join(__dirname, '../assets', 'trayTemplate.png'),
    path.join(__dirname, 'assets', 'trayTemplate.png'),
    path.join(appPath, 'icons', 'icon-32.png'),
    path.join(process.resourcesPath, 'icons', 'icon-32.png'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  let img: Electron.NativeImage | null = null;
  if (found) {
    img = nativeImage.createFromPath(found);
  }
  if (!img || img.isEmpty()) {
    img = nativeImage.createFromBuffer(Buffer.from(FALLBACK_TRAY_BASE64, 'base64'));
  }
  if (img && !img.isEmpty()) {
    // macOS menu bar expects 18x18 point images
    img = img.resize({ width: 18, height: 18 });
    if (process.platform === 'darwin') {
      img.setTemplateImage(true);
    }
  }
  return img;
}

function createTray() {
  const icon = getTrayIcon();

  try {
    tray = new Tray(icon);
    updateTrayMenu(null);

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
        }
      } else {
        createMainWindow();
      }
    });
  } catch (err) {
    console.warn('Tray creation failed:', err);
  }
}

function setupLaunchAtLogin(enabled: boolean) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
    });

    const launchAgentsDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const plistPath = path.join(launchAgentsDir, 'com.focus.studyapp.plist');

    if (enabled) {
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }

      const execPath = process.execPath;
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.focus.studyapp</string>
    <key>ProgramArguments</key>
    <array>
        <string>${execPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>`;
      fs.writeFileSync(plistPath, plistContent, 'utf-8');
    } else {
      if (fs.existsSync(plistPath)) {
        fs.unlinkSync(plistPath);
      }
    }
  } catch (e) {
    console.warn('Launch agent setup notice:', e);
  }
}

// Register IPC Handlers
function setupIpc() {
  // Google Calendar sync (status, OAuth, sync-now, renderer apply round-trip)
  googleSync.registerIpc();
  // Automatic study-day execution (scheduler status, session round-trips)
  autoExec.registerIpc();
  // Keep the Control/<tasks> folder watched so Obsidian edits flow back in
  const ensureTasksWatch = (config: ObsidianConfig | undefined) => {
    if (config?.enabled && config.vaultPath && config.vaultPath.trim()) {
      obsidianManager.ensureWatching(config, () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('focus:tasksFileChanged');
        }
      });
    } else {
      obsidianManager.stopWatching();
    }
  };

  ipcMain.handle('focus:getData', async () => {
    return localStore.get();
  });

  ipcMain.handle('focus:saveData', async (_, data: FocusAppData) => {
    // Follow vault path changes so Markdown two-way sync stays attached
    ensureTasksWatch(data?.settings?.obsidian);
    const vaultPath = data?.settings?.obsidian?.vaultPath;
    if (vaultPath) {
      plannerMarkdown.ensureWatching(vaultPath, (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('focus:plannerFileChanged', payload);
        }
      });
    } else {
      plannerMarkdown.stopWatching();
    }
    const saved = localStore.save(data);
    if (saved) googleSync.onLocalDataSaved();
    if (saved) autoExec.onLocalDataSaved();
    return saved;
  });

  ipcMain.handle('focus:startBlocking', async (_, domains: string[], strategy: BlockingStrategy) => {
    return await blocker.startBlocking(domains, strategy);
  });

  ipcMain.handle('focus:stopBlocking', async () => {
    return await blocker.stopBlocking();
  });

  ipcMain.handle('focus:getBlockerStatus', async () => {
    return blocker.getStatus();
  });

  ipcMain.handle('focus:startAppBlocking', async (_, apps: string[]) => {
    return await appBlocker.startBlocking(apps);
  });

  ipcMain.handle('focus:stopAppBlocking', async () => {
    return await appBlocker.stopBlocking();
  });

  ipcMain.handle('focus:getAppBlockerStatus', async () => {
    return appBlocker.getStatus();
  });

  ipcMain.handle('focus:searchInstalledApps', async (_, query: string) => {
    return await appBlocker.searchInstalledApps(query || '');
  });

  ipcMain.handle('focus:updateTraySession', async (_, info: TraySessionInfo) => {
    updateTrayMenu(info);
  });

  ipcMain.handle('focus:updateTray', async (_, text: string, title?: string, tooltip?: string) => {
    if (tray) {
      try {
        const titleToSet = text ? (text.startsWith(' ') ? text : ` ${text}`) : '';
        if (titleToSet !== lastTitle) {
          lastTitle = titleToSet;
          if (process.platform === 'darwin') {
            tray.setTitle(titleToSet, { fontType: 'monospacedDigit' });
          } else {
            tray.setTitle(titleToSet);
          }
        }
        if (tooltip && tooltip !== lastTooltip) {
          lastTooltip = tooltip;
          tray.setToolTip(tooltip);
        }
      } catch {}
    }
  });

  ipcMain.handle('focus:sendNotification', async (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show();
    }
  });

  ipcMain.handle('focus:setMinimalWindow', async (_, isMinimal: boolean) => {
    if (mainWindow) {
      if (isMinimal) {
        mainWindow.setSize(540, 480, true);
      } else {
        mainWindow.setSize(1060, 740, true);
      }
    }
  });

  ipcMain.handle('focus:syncToGoogleCalendar', async (_, blocks: ScheduleBlock[], config: GoogleCalendarConfig) => {
    return await calendarManager.syncToGoogleCalendar(blocks, config);
  });

  ipcMain.handle('focus:exportToIcs', async (_, blocks: ScheduleBlock[]) => {
    return await calendarManager.exportToIcs(blocks);
  });

  ipcMain.handle('focus:selectDirectory', async () => {
    return await obsidianManager.selectDirectory(mainWindow);
  });

  ipcMain.handle(
    'focus:syncToObsidian',
    async (_, tasks: TaskItem[], modes: StudyMode[], config: ObsidianConfig) => {
      const result = await obsidianManager.syncTasks(tasks, modes, config);
      ensureTasksWatch(config);
      return result;
    }
  );

  ipcMain.handle('focus:tasksMdRead', async (_, config: ObsidianConfig) => {
    ensureTasksWatch(config);
    return await obsidianManager.readTasks(config);
  });

  ipcMain.handle('focus:openPath', async (_, targetPath: string) => {
    return await obsidianManager.openPath(targetPath);
  });

  ipcMain.handle('focus:setLaunchAtLogin', async (_, enabled: boolean) => {
    setupLaunchAtLogin(enabled);
    return true;
  });

  ipcMain.handle('focus:openSelfControl', async (_, blocklist: string[], minutes: number) => {
    return await blocker.startSelfControl(blocklist, minutes);
  });

  // ── Markdown Day Planner (Obsidian is the source of truth) ────────────────
  const ensurePlannerWatch = (vaultPath: string) => {
    plannerMarkdown.ensureWatching(vaultPath, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus:plannerFileChanged', payload);
      }
    });
  };

  ipcMain.handle('focus:plannerMdStatus', async (_, vaultPath: string) => {
    if (vaultPath) ensurePlannerWatch(vaultPath);
    return plannerMarkdown.getStatus(vaultPath);
  });

  ipcMain.handle('focus:plannerMdListTemplates', async (_, vaultPath: string) => {
    if (!vaultPath) return [];
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.listTemplates(vaultPath);
  });

  ipcMain.handle('focus:plannerMdReadDay', async (_, vaultPath: string, date: string) => {
    if (!vaultPath) return null;
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.readDay(vaultPath, date);
  });

  ipcMain.handle(
    'focus:plannerMdApplyTemplate',
    async (_, vaultPath: string, templateName: string, date: string, variables: Record<string, string>) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.applyTemplate(vaultPath, templateName, date, variables || {});
    }
  );

  ipcMain.handle(
    'focus:plannerMdCreateTemplate',
    async (_, vaultPath: string, name: string, content: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.createTemplate(vaultPath, name, content);
    }
  );

  ipcMain.handle(
    'focus:plannerMdSaveDayAsTemplate',
    async (_, vaultPath: string, date: string, name: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.saveDayAsTemplate(vaultPath, date, name);
    }
  );

  ipcMain.handle(
    'focus:plannerMdDuplicateTemplate',
    async (_, vaultPath: string, name: string, newName: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.duplicateTemplate(vaultPath, name, newName);
    }
  );

  ipcMain.handle('focus:plannerMdDeleteTemplate', async (_, vaultPath: string, name: string) => {
    if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.deleteTemplate(vaultPath, name);
  });

  ipcMain.handle(
    'focus:plannerMdWriteTemplate',
    async (_, vaultPath: string, name: string, content: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.writeTemplate(vaultPath, name, content);
    }
  );

  ipcMain.handle(
    'focus:plannerMdToggleTask',
    async (_, vaultPath: string, date: string, taskIndex: number, completed: boolean) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      return plannerMarkdown.toggleTask(vaultPath, date, taskIndex, completed);
    }
  );

  ipcMain.handle(
    'focus:plannerMdUpdateTaskTitle',
    async (_, vaultPath: string, date: string, taskIndex: number, title: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      return plannerMarkdown.updateTaskTitle(vaultPath, date, taskIndex, title);
    }
  );

  ipcMain.handle('focus:plannerMdOpenFile', async (_, filePath: string) => {
    return await obsidianManager.openPath(filePath);
  });

  ipcMain.handle('focus:plannerMdReadTemplate', async (_, vaultPath: string, templateName: string) => {
    if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.readTemplate(vaultPath, templateName);
  });

  ipcMain.handle(
    'focus:plannerMdUpdateDaySchedule',
    async (_, vaultPath: string, date: string, sectionBody: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.updateDaySchedule(vaultPath, date, sectionBody);
    }
  );

  ipcMain.handle('focus:minimizeToTray', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  ipcMain.handle('focus:getPurposeSessionRequest', async () => {
    return getPurposeSessionRequest();
  });

  ipcMain.handle('focus:acknowledgePurposeSessionRequest', async (_, id: string) => {
    return acknowledgePurposeSessionRequest(id);
  });

  ipcMain.handle('focus:requestQuit', async () => {
    const isActive = currentTrayInfo && currentTrayInfo.isActive;
    if (isActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('focus:triggerLeaveModal');
    } else {
      isQuitting = true;
      await appBlocker.stopBlocking();
      await blocker.stopBlocking();
      app.exit(0);
    }
  });

  ipcMain.handle('focus:confirmQuit', async () => {
    isQuitting = true;
    await appBlocker.stopBlocking();
    await blocker.stopBlocking();
    app.exit(0);
  });
}

// Allow audio cues, alarms and ambient soundscapes to play without strict Chromium autoplay restrictions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// App lifecycle
app.whenReady().then(() => {
  applyAppDockIcon();
  setupIpc();
  createMainWindow();
  createTray();
  startPurposeRequestWatcher();
  googleSync.start();
  autoExec.start();

  const appData = localStore.get();
  const settings = appData.settings;
  if (settings.launchAtLogin) {
    setupLaunchAtLogin(true);
  }

  // Start watching the vault's Control folder for two-way Markdown sync
  const vaultPath = settings.obsidian?.vaultPath;
  if (vaultPath) {
    plannerMarkdown.ensureWatching(vaultPath, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus:plannerFileChanged', payload);
      }
    });
  }
  if (settings.obsidian?.enabled && vaultPath) {
    obsidianManager.ensureWatching(settings.obsidian, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('focus:tasksFileChanged');
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', async () => {
  isQuitting = true;
  googleSync.stop();
  autoExec.stop();
  plannerMarkdown.stopWatching();
  obsidianManager.stopWatching();
  await appBlocker.stopBlocking();
  await blocker.stopBlocking();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
