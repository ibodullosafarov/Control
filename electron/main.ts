import { app, BrowserWindow, ipcMain, Tray, Menu, Notification, nativeImage, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { autoUpdater } from 'electron-updater';
import { localStore } from './store';
import { blocker, appBlocker } from './blocker';
import { calendarManager } from './calendar';
import { obsidianManager } from './obsidian';
import { plannerMarkdown } from './plannerMarkdown';
import { GoogleSyncService } from './google/service';
import { AutoExecService } from './autoexec';
import { activityTracker } from './activity';
import { writeWidgetState } from './widgetBridge';
import {
  openQuickNote,
  registerQuickNoteIpc,
  registerQuickNoteShortcut,
  unregisterQuickNoteShortcut,
} from './quicknote';
import type { CaptureTarget } from './quicknote';
import { COMPANION_REQUEST_FILE, isValidCompanionCommand, parseCompanionUrl } from './companion';
import type { CompanionCommand } from './companion';
import { ControlAppData, ScheduleBlock, GoogleCalendarConfig, BlockingStrategy, PurposeSessionRequest, TaskItem, StudyMode, ObsidianConfig, Note, NoteFolder } from '../src/types';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let purposeRequestPoller: ReturnType<typeof setInterval> | null = null;
let widgetStatePoller: ReturnType<typeof setInterval> | null = null;

/** Publish the current app state for the native macOS widgets (best-effort). */
function publishWidgetState() {
  try {
    writeWidgetState(localStore.get());
  } catch (err) {
    console.warn('Widget state publish failed:', err);
  }
}

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
const PURPOSE_REQUEST_FILE = path.join(os.homedir(), '.control-app', 'purpose-session-request.json');

function sendToRenderer(channel: string, payload?: unknown): void {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  } catch {
    // Window gone; event is dropped.
  }
}

// Quick-note capture target (popup window). Resolved once the app is ready.
let captureTarget: CaptureTarget | null = null;

function resolveCaptureTarget(): CaptureTarget {
  const appPath = app.getAppPath();
  const preloadCandidates = [
    path.join(appPath, 'dist-electron/electron/preload.js'),
    path.join(__dirname, 'preload.js'),
    path.join(__dirname, '../preload.js'),
  ];
  const preloadPath = preloadCandidates.find((p) => fs.existsSync(p)) || preloadCandidates[0];
  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    return { preloadPath, devUrl: process.env.VITE_DEV_SERVER_URL };
  }
  const indexCandidates = [
    path.join(appPath, 'dist/index.html'),
    path.join(__dirname, '../../dist/index.html'),
    path.join(__dirname, '../dist/index.html'),
  ];
  const filePath = indexCandidates.find((p) => fs.existsSync(p)) || indexCandidates[0];
  return { preloadPath, filePath };
}

function openCapture(): void {
  if (!captureTarget) return;
  let theme: string | undefined;
  try {
    theme = localStore.get().settings.theme;
  } catch {
    theme = undefined;
  }
  openQuickNote(captureTarget, theme);
}

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
    mainWindow.webContents.send('control:purposeSessionRequested');
  }
}

function startPurposeRequestWatcher() {
  if (purposeRequestPoller) return;
  // Polling is intentional here. It works whether Purpose launches a fresh
  // Control process or hands off to one that is already running.
  purposeRequestPoller = setInterval(notifyPurposeSessionIfPresent, 700);
}

function getCompanionCommand(): CompanionCommand | null {
  try {
    if (!fs.existsSync(COMPANION_REQUEST_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(COMPANION_REQUEST_FILE, 'utf-8'));
    return isValidCompanionCommand(parsed) ? parsed : null;
  } catch (error) {
    console.warn('Unable to read Companion command:', error);
    return null;
  }
}

function acknowledgeCompanionCommand(id: string): boolean {
  const command = getCompanionCommand();
  if (!command || command.id !== id) return false;
  try {
    fs.unlinkSync(COMPANION_REQUEST_FILE);
    return true;
  } catch (error) {
    console.warn('Unable to acknowledge Companion command:', error);
    return false;
  }
}

function notifyCompanionCommandIfPresent(): void {
  const command = getCompanionCommand();
  if (command) {
    sendToRenderer('control:companionCommand', command);
  }
}

function startCompanionRequestWatcher(): void {
  setInterval(notifyCompanionCommandIfPresent, 700);
}

// The brand mark ships in two Icon Composer appearance variants. The renderer
// tells us which one matches the app's active theme; until then we fall back to
// the macOS system appearance.
let dockIconDarkPreference: boolean | null = null;

function getAppLogoPath(): string | undefined {
  const appPath = app.getAppPath();
  const dark =
    dockIconDarkPreference ?? (process.platform === 'darwin' && nativeTheme.shouldUseDarkColors);
  const variant = dark ? 'AppIcon-Dark' : 'AppIcon-Default';
  const variantCandidates = [
    path.join(appPath, 'assets', `${variant}.png`),
    path.join(process.resourcesPath, 'assets', `${variant}.png`),
    path.join(appPath, 'assets', `${variant}.icns`),
    path.join(process.resourcesPath, 'assets', `${variant}.icns`),
    path.join(__dirname, '../../assets', `${variant}.png`),
    path.join(__dirname, '../assets', `${variant}.png`),
  ];
  const preferred = variantCandidates.find((p) => fs.existsSync(p));
  if (preferred) return preferred;

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

// Keep the Dock icon in sync with the system appearance so the dark mark shows
// in dark mode and the default mark shows in light mode.
function watchSystemAppearanceForDockIcon() {
  if (process.platform !== 'darwin') return;
  nativeTheme.on('updated', () => {
    // The renderer's theme choice wins once it has told us; otherwise follow
    // the system.
    if (dockIconDarkPreference === null) applyAppDockIcon();
  });
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
    console.error('Control renderer failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Control renderer loaded successfully.');
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
      // If a control session is actively running, show the confirmation modal without time restriction
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('control:triggerLeaveModal');
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
            mainWindow?.webContents.send('control:trayAction', 'togglePause');
          },
        },
        {
          label: 'Next Task',
          click: () => {
            mainWindow?.webContents.send('control:trayAction', 'nextTask');
          },
        },
        {
          label: 'End Session',
          click: () => {
            mainWindow?.webContents.send('control:trayAction', 'endSession');
          },
        },
        { type: 'separator' },
        {
          label: 'Quick Note…',
          click: () => {
            openCapture();
          },
        },
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
          label: 'Quick Note…',
          click: () => {
            openCapture();
          },
        },
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
    const plistPath = path.join(launchAgentsDir, 'com.control.studyapp.plist');

    if (enabled) {
      if (!fs.existsSync(launchAgentsDir)) {
        fs.mkdirSync(launchAgentsDir, { recursive: true });
      }

      const execPath = process.execPath.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.control.studyapp</string>
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
          mainWindow.webContents.send('control:tasksFileChanged');
        }
      });
    } else {
      obsidianManager.stopWatching();
    }
  };

  ipcMain.handle('control:getData', async () => {
    return localStore.get();
  });

  ipcMain.handle('control:saveData', async (_, data: ControlAppData) => {
    if (!data || typeof data !== 'object' || !Array.isArray((data as ControlAppData).modes)) {
      return false;
    }
    // Follow vault path changes so Markdown two-way sync stays attached
    ensureTasksWatch(data?.settings?.obsidian);
    const vaultPath = data?.settings?.obsidian?.vaultPath;
    if (vaultPath) {
      plannerMarkdown.ensureWatching(vaultPath, (payload) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('control:plannerFileChanged', payload);
        }
      });
    } else {
      plannerMarkdown.stopWatching();
    }
    const saved = localStore.save(data);
    if (saved) googleSync.onLocalDataSaved();
    if (saved) autoExec.onLocalDataSaved();
    if (saved) publishWidgetState();
    return saved;
  });

  ipcMain.handle('control:startBlocking', async (_, domains: string[], strategy: BlockingStrategy) => {
    if (!Array.isArray(domains)) return { success: false, error: 'Invalid blocklist.' };
    return await blocker.startBlocking(domains, strategy);
  });

  ipcMain.handle('control:stopBlocking', async () => {
    return await blocker.stopBlocking();
  });

  ipcMain.handle('control:getBlockerStatus', async () => {
    return blocker.getStatus();
  });

  ipcMain.handle('control:startAppBlocking', async (_, apps: string[]) => {
    if (!Array.isArray(apps)) return { success: false, error: 'Invalid app list.' };
    return await appBlocker.startBlocking(apps);
  });

  ipcMain.handle('control:stopAppBlocking', async () => {
    return await appBlocker.stopBlocking();
  });

  ipcMain.handle('control:getAppBlockerStatus', async () => {
    return appBlocker.getStatus();
  });

  ipcMain.handle('control:searchInstalledApps', async (_, query: string) => {
    return await appBlocker.searchInstalledApps(typeof query === 'string' ? query : '');
  });

  ipcMain.handle('control:updateTraySession', async (_, info: TraySessionInfo) => {
    updateTrayMenu(info);
    // Session ticks are the freshest signal for the live-timer widget.
    publishWidgetState();
  });

  ipcMain.handle('control:updateTray', async (_, text: string, title?: string, tooltip?: string) => {
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

  ipcMain.handle('control:sendNotification', async (_, title: string, body: string) => {
    if (Notification.isSupported()) {
      new Notification({
        title: typeof title === 'string' ? title.slice(0, 120) || 'Control' : 'Control',
        body: typeof body === 'string' ? body.slice(0, 500) : '',
      }).show();
    }
  });

  ipcMain.handle('control:setMinimalWindow', async (_, isMinimal: boolean) => {
    if (mainWindow) {
      if (isMinimal) {
        mainWindow.setSize(540, 480, true);
      } else {
        mainWindow.setSize(1060, 740, true);
      }
    }
  });

  // The renderer owns the light/dark theme; mirror it onto the Dock icon so the
  // brand mark matches the app, not necessarily the OS.
  ipcMain.handle('control:setDockIconAppearance', async (_, isDark: boolean) => {
    dockIconDarkPreference = !!isDark;
    applyAppDockIcon();
  });

  ipcMain.handle('control:syncToGoogleCalendar', async (_, blocks: ScheduleBlock[], config: GoogleCalendarConfig) => {
    return await calendarManager.syncToGoogleCalendar(blocks, config);
  });

  ipcMain.handle('control:exportToIcs', async (_, blocks: ScheduleBlock[]) => {
    return await calendarManager.exportToIcs(blocks);
  });

  ipcMain.handle('control:selectDirectory', async () => {
    return await obsidianManager.selectDirectory(mainWindow);
  });

  ipcMain.handle(
    'control:syncToObsidian',
    async (_, tasks: TaskItem[], modes: StudyMode[], config: ObsidianConfig) => {
      const result = await obsidianManager.syncTasks(tasks, modes, config);
      ensureTasksWatch(config);
      return result;
    }
  );

  ipcMain.handle('control:tasksMdRead', async (_, config: ObsidianConfig) => {
    ensureTasksWatch(config);
    return await obsidianManager.readTasks(config);
  });

  ipcMain.handle(
    'control:syncNotesToObsidian',
    async (_, notes: Note[], folders: NoteFolder[], config: ObsidianConfig) => {
      return await obsidianManager.syncNotes(
        Array.isArray(notes) ? notes : [],
        Array.isArray(folders) ? folders : [],
        config
      );
    }
  );

  ipcMain.handle('control:openPath', async (_, targetPath: string) => {
    return await obsidianManager.openPath(targetPath);
  });

  ipcMain.handle('control:setLaunchAtLogin', async (_, enabled: boolean) => {
    setupLaunchAtLogin(enabled);
    return true;
  });

  ipcMain.handle('control:openSelfControl', async (_, blocklist: string[], minutes: number) => {
    if (!Array.isArray(blocklist)) return { success: false, error: 'Invalid blocklist.' };
    if (!Number.isFinite(minutes)) return { success: false, error: 'Invalid duration.' };
    return await blocker.startSelfControl(blocklist, minutes);
  });

  // ── Markdown Day Planner (Obsidian is the source of truth) ────────────────
  const ensurePlannerWatch = (vaultPath: string) => {
    plannerMarkdown.ensureWatching(vaultPath, (payload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('control:plannerFileChanged', payload);
      }
    });
  };

  ipcMain.handle('control:plannerMdStatus', async (_, vaultPath: string) => {
    if (vaultPath) ensurePlannerWatch(vaultPath);
    return plannerMarkdown.getStatus(vaultPath);
  });

  ipcMain.handle('control:plannerMdListTemplates', async (_, vaultPath: string) => {
    if (!vaultPath) return [];
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.listTemplates(vaultPath);
  });

  ipcMain.handle('control:plannerMdReadDay', async (_, vaultPath: string, date: string) => {
    if (!vaultPath) return null;
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.readDay(vaultPath, date);
  });

  ipcMain.handle(
    'control:plannerMdApplyTemplate',
    async (_, vaultPath: string, templateName: string, date: string, variables: Record<string, string>) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.applyTemplate(vaultPath, templateName, date, variables || {});
    }
  );

  ipcMain.handle(
    'control:plannerMdCreateTemplate',
    async (_, vaultPath: string, name: string, content: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.createTemplate(vaultPath, name, content);
    }
  );

  ipcMain.handle(
    'control:plannerMdSaveDayAsTemplate',
    async (_, vaultPath: string, date: string, name: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.saveDayAsTemplate(vaultPath, date, name);
    }
  );

  ipcMain.handle(
    'control:plannerMdDuplicateTemplate',
    async (_, vaultPath: string, name: string, newName: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.duplicateTemplate(vaultPath, name, newName);
    }
  );

  ipcMain.handle('control:plannerMdDeleteTemplate', async (_, vaultPath: string, name: string) => {
    if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.deleteTemplate(vaultPath, name);
  });

  ipcMain.handle(
    'control:plannerMdWriteTemplate',
    async (_, vaultPath: string, name: string, content: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.writeTemplate(vaultPath, name, content);
    }
  );

  ipcMain.handle(
    'control:plannerMdToggleTask',
    async (_, vaultPath: string, date: string, taskIndex: number, completed: boolean) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      return plannerMarkdown.toggleTask(vaultPath, date, taskIndex, completed);
    }
  );

  ipcMain.handle(
    'control:plannerMdUpdateTaskTitle',
    async (_, vaultPath: string, date: string, taskIndex: number, title: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      return plannerMarkdown.updateTaskTitle(vaultPath, date, taskIndex, title);
    }
  );

  ipcMain.handle('control:plannerMdOpenFile', async (_, filePath: string) => {
    return await obsidianManager.openPath(filePath);
  });

  ipcMain.handle('control:plannerMdReadTemplate', async (_, vaultPath: string, templateName: string) => {
    if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
    ensurePlannerWatch(vaultPath);
    return plannerMarkdown.readTemplate(vaultPath, templateName);
  });

  ipcMain.handle(
    'control:plannerMdUpdateDaySchedule',
    async (_, vaultPath: string, date: string, sectionBody: string) => {
      if (!vaultPath) return { success: false, error: 'No Obsidian vault selected.' };
      ensurePlannerWatch(vaultPath);
      return plannerMarkdown.updateDaySchedule(vaultPath, date, sectionBody);
    }
  );

  ipcMain.handle('control:minimizeToTray', async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  ipcMain.handle('control:activitySetEnabled', async (_, enabled: boolean) => {
    try {
      if (enabled) activityTracker.start();
      else activityTracker.stop();
      return { success: true, running: activityTracker.running };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  registerQuickNoteIpc({
    store: localStore,
    target: () => captureTarget || resolveCaptureTarget(),
    notifyNotesChanged: (notes: Note[]) => sendToRenderer('control:notesChanged', notes),
  });

  ipcMain.handle('control:getPurposeSessionRequest', async () => {
    return getPurposeSessionRequest();
  });

  ipcMain.handle('control:acknowledgePurposeSessionRequest', async (_, id: string) => {
    return acknowledgePurposeSessionRequest(id);
  });

  ipcMain.handle('control:getCompanionCommand', async () => {
    return getCompanionCommand();
  });

  ipcMain.handle('control:acknowledgeCompanionCommand', async (_, id: string) => {
    return acknowledgeCompanionCommand(id);
  });

  ipcMain.handle('control:requestQuit', async () => {
    const isActive = currentTrayInfo && currentTrayInfo.isActive;
    if (isActive && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send('control:triggerLeaveModal');
    } else {
      isQuitting = true;
      await appBlocker.stopBlocking();
      await blocker.stopBlocking();
      app.exit(0);
    }
  });

  ipcMain.handle('control:confirmQuit', async () => {
    isQuitting = true;
    await appBlocker.stopBlocking();
    await blocker.stopBlocking();
    app.exit(0);
  });
}

// Allow audio cues and alarms to play without strict Chromium autoplay restrictions
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Auto-updates: the packaged app checks the GitHub Releases feed for a newer
// build. Runs only in the packaged app (dev builds should never self-update).
function setupAutoUpdater() {
  if (!app.isPackaged) return;
  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-downloaded', () => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Control update ready',
          body: 'A new version is installed and will apply when you quit Control.',
        }).show();
      }
    });
    autoUpdater.checkForUpdatesAndNotify().catch((err: unknown) => {
      console.warn('Auto-update check failed:', err);
    });
  } catch (err) {
    console.warn('Auto-updater setup failed:', err);
  }
}

// System-wide control API: control://control?mode=<mode id or name>&task=<text>
// (pre-rename control://focus?… links are still accepted).
// Shortcuts.app can open URLs, so personal automations come free.
// Registration + single-instance lock only apply to packaged builds so that
// parallel dev instances keep working.
const singleInstanceOk = !app.isPackaged || app.requestSingleInstanceLock();
if (!singleInstanceOk) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
    notifyPurposeSessionIfPresent();
  });
}

function handleControlUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (parsed.protocol !== 'control:') return;
  const action = parsed.hostname || parsed.pathname.replace(/^\/+/, '');
  if (action === 'companion') {
    const command = parseCompanionUrl(url);
    if (!command) return;
    try {
      fs.mkdirSync(path.dirname(COMPANION_REQUEST_FILE), { recursive: true });
      const tmp = `${COMPANION_REQUEST_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(command));
      fs.renameSync(tmp, COMPANION_REQUEST_FILE);
    } catch (err) {
      console.warn('Unable to write Companion command:', err);
      return;
    }
    notifyCompanionCommandIfPresent();
    return;
  }
  if (action !== 'control' && action !== 'focus') return;
  const mode = (parsed.searchParams.get('mode') || '').trim();
  const task = (parsed.searchParams.get('task') || '').trim();
  if (!mode && !task) return;
  const request: PurposeSessionRequest = {
    version: 2,
    id: `url-${Date.now()}`,
    createdAt: new Date().toISOString(),
    modeId: mode,
    purpose: task,
  };
  try {
    fs.mkdirSync(path.dirname(PURPOSE_REQUEST_FILE), { recursive: true });
    fs.writeFileSync(PURPOSE_REQUEST_FILE, JSON.stringify(request));
  } catch (err) {
    console.warn('Unable to write URL session request:', err);
    return;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
  notifyPurposeSessionIfPresent();
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleControlUrl(url);
});

// App lifecycle
app.whenReady().then(() => {
  applyAppDockIcon();
  watchSystemAppearanceForDockIcon();
  captureTarget = resolveCaptureTarget();
  const quickNoteAccelerator = registerQuickNoteShortcut(openCapture);
  if (quickNoteAccelerator) {
    console.log(`Quick-note shortcut registered: ${quickNoteAccelerator}`);
  } else {
    console.warn('Quick-note global shortcut unavailable (already taken). Tray item still works.');
  }
  if (app.isPackaged) {
    try {
      if (!app.isDefaultProtocolClient('control')) {
        app.setAsDefaultProtocolClient('control');
      }
    } catch (err) {
      console.warn('Unable to register control:// protocol:', err);
    }
  }
  setupIpc();
  createMainWindow();
  createTray();
  startPurposeRequestWatcher();
  startCompanionRequestWatcher();
  setupAutoUpdater();
  googleSync.start();
  autoExec.start();
  // Publish widget state immediately and keep it fresh for the native widgets.
  publishWidgetState();
  widgetStatePoller = setInterval(publishWidgetState, 15000);

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
        mainWindow.webContents.send('control:plannerFileChanged', payload);
      }
    });
  }
  if (settings.obsidian?.enabled && vaultPath) {
    obsidianManager.ensureWatching(settings.obsidian, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('control:tasksFileChanged');
      }
    });
  }

  // Distraction autopsy: log apps terminated while blocking is active.
  appBlocker.setKillListener((appName) => {
    sendToRenderer('control:distractionBlocked', { t: Date.now(), kind: 'app', name: appName });
  });
  // Automatic time tracking stays off unless the renderer enables it.
  activityTracker.setListener((point) => {
    sendToRenderer('control:activitySample', point);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', (e) => {
  if (isQuitting) {
    try { googleSync.stop(); } catch { /* ignore */ }
    try { autoExec.stop(); } catch { /* ignore */ }
    try { activityTracker.stop(); } catch { /* ignore */ }
    try { unregisterQuickNoteShortcut(); } catch { /* ignore */ }
    try { plannerMarkdown.stopWatching(); } catch { /* ignore */ }
    try { obsidianManager.stopWatching(); } catch { /* ignore */ }
    try { clearInterval(purposeRequestPoller as unknown as NodeJS.Timeout); } catch { /* ignore */ }
    purposeRequestPoller = null;
    try { clearInterval(widgetStatePoller as unknown as NodeJS.Timeout); } catch { /* ignore */ }
    widgetStatePoller = null;
    return;
  }

  const isActive = currentTrayInfo && currentTrayInfo.isActive;
  if (isActive && mainWindow && !mainWindow.isDestroyed()) {
    e.preventDefault();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('control:triggerLeaveModal');
    return;
  }

  e.preventDefault();
  isQuitting = true;
  void (async () => {
    try { await appBlocker.stopBlocking(); } catch { /* ignore */ }
    try { await blocker.stopBlocking(); } catch { /* ignore */ }
    app.quit();
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
