'use strict';
// 桌面贴窗口：透明/无边框/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// 层级 = 两个正交控制（用户指定）：
//   1. Win+D toggle 状态机：只管「置顶豁免」（置顶时豁免 DWM 显示桌面收起，桌面贴随桌面可见）；
//      每次「显示桌面切换」（键盘/任务栏按钮）翻转一次，方向性去抖（进桌面稳 250ms、退出 40ms）
//   2. 焦点驱动上浮/沉底：显示快捷键或点击桌面贴 → 浮到普通层顶部；点别的窗口 → 沉底（贴桌面常态）
// 置顶期间失焦不沉（保持 Win+D 豁免）。拖动/缩放走应用层 IPC（见 main.js）。
const { BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fitRectToDisplays, MARGIN } = require('../shared/geometry');

const DEFAULT_SIZE = { width: 300, height: 420 };
const MIN_SIZE = { width: 240, height: 200 };

function setupLayering(win) {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const SetWindowPos = lib.func('int SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, unsigned int uFlags)');
  const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  const EnumWindows = lib.func('int EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = lib.func('int IsWindowVisible(intptr_t h)');
  const IsIconic = lib.func('int IsIconic(intptr_t h)');
  const GetWindowLongW = lib.func('int GetWindowLongW(intptr_t h, int i)');
  const WinEventProcCb = koffi.proto('void WinEventProc(intptr_t hHook, unsigned long dwEvent, intptr_t hwnd, long idObject, long idChild, unsigned long dwEventThread, unsigned long dwmsEventTime)');
  const SetWinEventHook = lib.func('intptr_t SetWinEventHook(unsigned long eventMin, unsigned long eventMax, intptr_t hmodWinEventProc, WinEventProc *lpfnWinEventProc, unsigned long idProcess, unsigned long idThread, unsigned long dwFlags)');
  const UnhookWinEvent = lib.func('int UnhookWinEvent(intptr_t hHook)');

  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const WS_VISIBLE = 0x10000000;
  const WS_CAPTION = 0x00c00000;
  const WS_EX_APPWINDOW = 0x40000;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_TOPMOST = 0x8;
  // EVENT_SYSTEM_FOREGROUND / MINIMIZESTART / MINIMIZEEND / OBJECT_SHOW / OBJECT_HIDE
  const EVENTS = [0x0003, 0x0016, 0x0017, 0x8002, 0x8003];
  const WINEVENT_OUTOFCONTEXT = 0;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);

  let toggle = false; // Win+D toggle：true = 置顶豁免中

  // 沉底 = 单次原子操作（HWND_BOTTOM 隐含摘除 topmost 位），无「普通层顶部」中间帧
  const sink = () => {
    try { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch { /* 窗口竞态 */ }
  };
  const rise = () => { try { win.moveTop(); } catch { /* 窗口竞态 */ } };

  // ---- 焦点驱动：点击/调出 → 顶部；点别的窗口 → 沉底（置顶豁免期间不沉）----
  win.on('focus', rise);
  win.on('blur', () => { if (!toggle) sink(); });

  // ---- Win+D toggle：只管置顶豁免，不管沉底 ----
  const apply = () => {
    try {
      if (toggle) {
        win.setAlwaysOnTop(true, 'screen-saver');
      } else if (win.isFocused()) {
        win.setAlwaysOnTop(false); // 取消豁免；用户正操作着（有焦点）→ 留在普通层顶部
      } else {
        sink(); // 无焦点：原子取消置顶并回沉底常态
      }
    } catch { /* 窗口竞态：下次事件自愈 */ }
  };

  function isDesktopState() {
    let ordinary = 0;
    const cb = koffi.register((h) => {
      if (h === hwnd) return 1;
      const ex = GetWindowLongW(h, -20) >>> 0;
      if (ex & WS_EX_TOOLWINDOW) return 1;
      if (ex & WS_EX_TOPMOST) return 1;
      const style = GetWindowLongW(h, -16) >>> 0;
      if (!(style & WS_VISIBLE)) return 1;
      if (!IsWindowVisible(h) || IsIconic(h)) return 1;
      if (!((ex & WS_EX_APPWINDOW) || (style & WS_CAPTION))) return 1;
      ordinary++;
      return 1;
    }, koffi.pointer(EnumWindowsProc));
    try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
    return ordinary === 0;
  }

  let stable = false;
  let pending = null;
  let recheckTimer = null;
  const onChange = () => {
    if (win.isDestroyed()) return;
    const observed = isDesktopState();
    const now = Date.now();
    if (observed === stable) { pending = null; return; }
    if (!pending || pending.value !== observed) pending = { value: observed, since: now };
    // 进桌面稳 250ms（防收起动画中间态）；退出快切 40ms（窗口出现是明确信号）
    const needMs = observed ? 250 : 40;
    if (now - pending.since >= needMs) {
      stable = observed;
      toggle = !toggle; // 一次稳定的「显示桌面切换」翻转一次
      pending = null;
      apply();
    } else if (!recheckTimer) {
      recheckTimer = setTimeout(() => { recheckTimer = null; onChange(); }, 120);
    }
  };

  const hookCb = koffi.register((_hook, _event, eventHwnd, idObject) => {
    if (eventHwnd === 0 || idObject !== 0 /*OBJID_WINDOW*/) return;
    onChange();
  }, koffi.pointer(WinEventProcCb));
  const hooks = EVENTS.map((ev) => SetWinEventHook(ev, ev, 0, hookCb, 0, 0, WINEVENT_OUTOFCONTEXT));

  win.once('closed', () => {
    if (recheckTimer) clearTimeout(recheckTimer);
    for (const h of hooks) if (h) UnhookWinEvent(h);
    koffi.unregister(hookCb);
  });

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
