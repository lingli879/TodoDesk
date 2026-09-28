'use strict';
// TodoDesk 主进程入口：单实例、数据目录、托盘、双窗口、IPC 注册、生命周期。
const { app, dialog, ipcMain, shell, Tray, Menu, nativeImage, Notification, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const store = require('../shared/store');
const { fitRectToDisplays } = require('../shared/geometry');
const logger = require('./logger');
const { registerIpc } = require('./ipc');
const { createWidgetWindow, applyHotkey } = require('./widget-window');
const { createMainWindow } = require('./main-window');
const { createDetailWindow, getDetailWindow } = require('./detail-window');

let dataDir = null;
let state = null;
let widgetWin = null;
let mainWin = null;
let tray = null;
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
    showWidget();
  });
  app.whenReady().then(bootstrap);
  app.on('before-quit', () => { quitting = true; });
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
}

function resolveDataDir() {
  const root = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(root, 'data');
}

async function bootstrap() {
  app.setAppUserModelId('com.tododesk.app');
  dataDir = resolveDataDir();
  try {
    store.ensureWritable(dataDir);
  } catch (e) {
    dialog.showErrorBox('TodoDesk 无法写入数据目录',
      `目录：${dataDir}\n请把软件移动到有写权限的位置后重试。\n${e.message}`);
    app.quit();
    return;
  }
  const r = store.loadState(dataDir);
  if (r.corrupted) {
    const btn = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['以空数据继续', '退出'],
      title: 'TodoDesk 数据文件损坏',
      message: '数据文件与备份均无法读取。',
      detail: '原文件已保留（确认后将改名为 .corrupt 留证），继续将以空数据启动。',
    });
    if (btn === 1) { app.quit(); return; }
    store.archiveCorrupted(dataDir);
    logger.write(dataDir, '数据文件双损坏，已留证并以空数据启动');
  } else if (r.recoveredFromBackup) {
    try {
      new Notification({ title: 'TodoDesk', body: '数据文件损坏，已从备份恢复' }).show();
    } catch { /* 通知失败不影响启动 */ }
    logger.write(dataDir, '主数据损坏，已从备份恢复');
  }
  state = r.data;
  saveStateNow();

  createWidget();
  createMainWin();
  createTray();
  registerIpc(ipcMain, {
    getState: () => state,
    mutate: (fn) => { const out = fn(state); saveStateNow(); return out; },
    broadcast,
    openDataFolder: () => shell.openPath(dataDir),
    showMainWindow,
    showWidget,
    hideWidget,
    toggleWidget,
    applyHotkey: (accel) => applyHotkey(accel, toggleWidget),
    setAutoLaunch: (v) => app.setLoginItemSettings({ openAtLogin: !!v }),
    openDetail,
  });
  startWatchdog();
}

// 看门狗：主进程暴毙（explorer 强杀连带桌面贴死锁等）后自动拉起应用。
// 以 ELECTRON_RUN_AS_NODE 运行于同一 exe，探活 ppid；优雅退出用标记文件区分。
function startWatchdog() {
  const mark = path.join(dataDir, '.graceful-exit');
  try { fs.unlinkSync(mark); } catch { /* 无残留 */ }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TD_WATCHDOG_PPID: String(process.pid),
    TD_WATCHDOG_MARK: mark,
    TD_WATCHDOG_APP: app.getAppPath(),
  };
  spawn(process.execPath, [path.join(__dirname, 'watchdog.js')], { env, detached: true, stdio: 'ignore' }).unref();
}

function saveStateNow() {
  try {
    store.saveState(dataDir, state);
  } catch (e) {
    logger.write(dataDir, `保存失败：${e.message}`);
  }
}

function broadcast(channel) {
  for (const w of [mainWin, widgetWin, getDetailWindow()]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel);
  }
}

// 详情独立窗口：不受桌面贴尺寸限制；贴桌面贴旁弹出
function openDetail(id) {
  const near = widgetWin && !widgetWin.isDestroyed() ? widgetWin.getBounds() : null;
  createDetailWindow(id, near);
}

// ---- 窗口 ----
function createWidget() {
  widgetWin = createWidgetWindow({
    getSettings: () => state.settings,
    onRectChanged: ({ position, size }) => {
      state.settings.widgetPosition = position;
      state.settings.widgetSize = size;
      saveStateNow();
    },
  });
  widgetWin.on('closed', () => { widgetWin = null; });
  const ok = applyHotkey(state.settings.hotkey, toggleWidget);
  if (!ok) {
    logger.write(dataDir, `快捷键注册失败：${state.settings.hotkey}`);
    try {
      new Notification({ title: 'TodoDesk', body: '全局快捷键注册失败，可在设置中修改' }).show();
    } catch { /* 忽略 */ }
  }
}

function createMainWin() {
  mainWin = createMainWindow();
  mainWin.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWin.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWin || mainWin.isDestroyed()) createMainWin();
  else { mainWin.show(); mainWin.focus(); }
}

function showWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) {
    // 显示前做多屏校正（spec §7：启动/显示时——隐藏期间可能拔掉了显示器）
    const b = widgetWin.getBounds();
    const fit = fitRectToDisplays(b, screen.getAllDisplays());
    if (fit.x !== b.x || fit.y !== b.y || fit.width !== b.width || fit.height !== b.height) {
      widgetWin.setBounds(fit);
    }
    widgetWin.show();
  }
}

function hideWidget() {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide();
}

function toggleWidget() {
  if (!widgetWin || widgetWin.isDestroyed()) { showWidget(); return; }
  if (widgetWin.isVisible()) widgetWin.hide();
  else widgetWin.show();
}

// ---- 托盘 ----
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../build/tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('TodoDesk');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开主程序', click: () => showMainWindow() },
    { label: '显示/隐藏桌面贴', click: () => toggleWidget() },
    { type: 'separator' },
    { label: '退出', click: () => exitApp() },
  ]));
}

function exitApp() {
  quitting = true;
  // 优雅退出标记：看门狗据此不复活
  try { fs.writeFileSync(path.join(dataDir, '.graceful-exit'), String(Date.now())); } catch { /* 尽力 */ }
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.destroy();
  if (mainWin && !mainWin.isDestroyed()) mainWin.destroy();
  const detail = getDetailWindow();
  if (detail && !detail.isDestroyed()) detail.destroy();
  app.quit();
}
