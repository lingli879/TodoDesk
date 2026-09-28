'use strict';
// 桌面贴窗口：透明/无边框/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// Win+D（16ce6c5 验证通过版）：GetAsyncKeyState 轮询组合边沿 → toggle → setAlwaysOnTop
// 切换置顶（Win11「显示桌面」由 DWM 收起一切非置顶窗口的画面，置顶层豁免）。
// 任务栏「显示桌面」按钮：同一轮询里检测「左键按下边沿 + 光标在按钮区域」（主屏最右缘
// 任务栏高度内）→ 与键盘完全相同的翻转。不用鼠标钩子（高频回调进 JS 易崩且断钩子链）；
// 不用窗口状态观测（按钮走 DWM 收起，窗口状态零变化，只有键盘 Win+D 才真最小化）。
// 启动时沉底（贴桌面层级）。拖动/缩放走应用层 IPC（见 main.js）。
const { BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fitRectToDisplays, MARGIN } = require('../shared/geometry');

const DEFAULT_SIZE = { width: 300, height: 420 };
const MIN_SIZE = { width: 240, height: 200 };
const VK_LWIN = 0x5b;
const VK_D = 0x44;
const VK_LBUTTON = 0x01;

function setupLayering(win) {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const SetWindowPos = lib.func('int SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, unsigned int uFlags)');
  const GetAsyncKeyState = lib.func('short GetAsyncKeyState(int vKey)');
  const GetCursorPos = lib.func('int GetCursorPos(long *lpPoint)');
  const GetSystemMetrics = lib.func('int GetSystemMetrics(int nIndex)');
  const SystemParametersInfoW = lib.func('int SystemParametersInfoW(unsigned int uiAction, unsigned int uiParam, void *pvParam, unsigned int winIni)');

  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);

  const sink = () => {
    try { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch { /* 窗口竞态 */ }
  };
  const rise = () => { try { win.moveTop(); } catch { /* 窗口竞态 */ } };

  const applyTopmost = (on) => {
    try { win.setAlwaysOnTop(on, 'screen-saver'); } catch { /* 竞态：下次自愈 */ }
  };

  let desktopMode = false;
  const flip = () => {
    desktopMode = !desktopMode;
    applyTopmost(desktopMode);
  };

  // 按钮/键盘统一在 20ms 轮询里检测（本进程 DPI aware，屏幕 API 返回物理像素与鼠标坐标同系）
  const waBuf = koffi.alloc('long', 4);
  SystemParametersInfoW(48 /*SPI_GETWORKAREA*/, 0, waBuf, 0);
  const [, , , waBottom] = koffi.decode(waBuf, 'long', 4);
  const screenW = GetSystemMetrics(0 /*SM_CXSCREEN*/);
  const BTN_X = screenW - 20; // 「显示桌面」按钮在任务栏最右缘的窄条

  let prevCombo = false;
  let prevBtn = false;
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    // 键盘 Win+D 组合边沿
    const combo = !!(GetAsyncKeyState(VK_LWIN) & 0x8000) && !!(GetAsyncKeyState(VK_D) & 0x8000);
    if (combo && !prevCombo) flip();
    prevCombo = combo;
    // 任务栏「显示桌面」按钮：左键按下边沿 + 光标在按钮区域
    const btnDown = !!(GetAsyncKeyState(VK_LBUTTON) & 0x8000);
    if (btnDown && !prevBtn) {
      const pt = koffi.alloc('long', 2);
      GetCursorPos(pt);
      const [mx, my] = koffi.decode(pt, 'long', 2);
      if (mx >= BTN_X && my >= waBottom) flip();
    }
    prevBtn = btnDown;
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
