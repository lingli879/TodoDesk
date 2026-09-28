'use strict';
// 桌面贴窗口：透明/无边框/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// 【当前步骤：仅 Win+D】键盘组合边沿（GetAsyncKeyState 20ms 轮询）→ toggle 置顶。
// 原理：Win11「显示桌面」由 DWM 收起一切非置顶窗口的画面，置顶层豁免——
// 按下瞬间置顶，桌面贴随桌面保持可见；再按取消置顶。不判断窗口状态（用户指示：
// 不管窗口收完没收完），按键即翻转。任务栏按钮/桌面空白处待后续步骤。
// 启动时沉底（贴桌面层级）。拖动/缩放走应用层 IPC（见 main.js）。
const { BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fitRectToDisplays, MARGIN } = require('../shared/geometry');

const DEFAULT_SIZE = { width: 300, height: 420 };
const MIN_SIZE = { width: 240, height: 200 };
const VK_LWIN = 0x5b;
const VK_D = 0x44;

function setupLayering(win) {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const SetWindowPos = lib.func('int SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, unsigned int uFlags)');
  const GetAsyncKeyState = lib.func('short GetAsyncKeyState(int vKey)');

  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);

  const sink = () => {
    try { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch { /* 窗口竞态 */ }
  };
  const rise = () => { try { win.moveTop(); } catch { /* 窗口竞态 */ } };

  // ---- 仅 Win+D：组合键边沿 → toggle（用户验证过的实现） ----
  // 进桌面：置顶豁免收起。恢复：单次原子沉底（HWND_BOTTOM 隐含摘除 topmost 位，
  // 无「普通层顶部」中间帧——只取消置顶不沉底会悬在应用前面）
  let desktopMode = false;
  let prevCombo = false;
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    const combo = !!(GetAsyncKeyState(VK_LWIN) & 0x8000) && !!(GetAsyncKeyState(VK_D) & 0x8000);
    if (combo && !prevCombo) {
      desktopMode = !desktopMode;
      try {
        if (desktopMode) win.setAlwaysOnTop(true, 'screen-saver');
        else sink();
      } catch { /* 窗口竞态 */ }
    }
    prevCombo = combo;
  }, 20);

  win.once('closed', () => clearInterval(timer));

  return { sink, rise };
}

function bottomRight(workArea, size) {
  return {
    x: workArea.x + workArea.width - size.width - MARGIN,
    y: workArea.y + workArea.height - size.height - MARGIN,
  };
}

function createWidgetWindow({ getSettings, onRectChanged }) {
  const s = getSettings();
  const size = s.widgetSize || { ...DEFAULT_SIZE };
  let rect;
  if (s.widgetPosition) {
    rect = fitRectToDisplays({ ...s.widgetPosition, ...size }, screen.getAllDisplays());
  } else {
    rect = { ...bottomRight(screen.getPrimaryDisplay().workArea, size), ...size };
  }

  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: false, // 普通窗口层级，不遮挡其他应用；透明度由 CSS --panel-alpha 控制
    skipTaskbar: true,
    show: false,
    webPreferences: fs.existsSync(preloadPath) ? { preload: preloadPath } : {},
  });
  win.loadFile(path.join(__dirname, '../renderer/widget/widget.html'));

  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      onRectChanged({ position: { x: b.x, y: b.y }, size: { width: b.width, height: b.height } });
    }, 500);
  };
  win.on('moved', persist);
  win.on('resized', persist);
  // 个别环境把无任务栏窗口也最小化时立即弹回（用户没有主动最小化的常规途径，误伤为零）
  win.on('minimize', () => win.restore());
  const layering = setupLayering(win);
  win.once('ready-to-show', () => {
    win.show();
    layering.sink(); // 启动即沉底（贴桌面层级）
  });
  win.layering = layering; // main.js 显示/切换桌面贴时 rise() 用
  return win;
}

function applyHotkey(accel, onToggle) {
  globalShortcut.unregisterAll();
  if (!accel) return true;
  try {
    return globalShortcut.register(accel, onToggle) !== false;
  } catch {
    return false;
  }
}

module.exports = { createWidgetWindow, applyHotkey, MIN_SIZE };
