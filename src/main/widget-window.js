'use strict';
// 桌面贴窗口：透明/无边框/普通层级（不置顶不遮挡应用）/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// Win+D：按下期间临时置顶（Win11「显示桌面」由 DWM 收起一切非置顶窗口的画面，置顶层豁免——
// 此时满屏皆桌面无窗口可挡），再按时回落普通层级。检测为 GetAsyncKeyState 轮询（无钩子无权限）。
// 拖动/缩放走应用层 IPC（见 main.js）。
const { BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fitRectToDisplays, MARGIN } = require('../shared/geometry');

const DEFAULT_SIZE = { width: 300, height: 420 };
const MIN_SIZE = { width: 240, height: 200 };

// Win+D 桌面态守卫：桌面态时「临时置顶」（Win11 显示桌面由 DWM 收起一切非置顶窗口的画面，
// 置顶层豁免；此时满屏皆桌面无窗口可挡），恢复后回落普通层级。纯 Electron API 切换，
// 不做 SetParent（父子化会破坏 per-monitor DPI 上下文与输入状态，已实测）。
//
// 纯事件驱动（无定时器无轮询）：SetWinEventHook 订阅前台切换/最小化/显示/隐藏事件，
// 系统在状态变化时回调（WINEVENT_OUTOFCONTEXT 经主线程消息循环派发），回调内
// 节流 50ms 后重算桌面态。桌面态定义：「屏幕上没有任何可见且未最小化的应用窗口」，
// 判据：非工具窗/非置顶悬浮/可见/未最小化，且有 (APPWINDOW 或 WS_CAPTION)
//（Win11 WinUI 应用如记事本无 APPWINDOW 位）。
function startWinDGuard(win) {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  const EnumWindows = lib.func('int EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = lib.func('int IsWindowVisible(intptr_t h)');
  const IsIconic = lib.func('int IsIconic(intptr_t h)');
  const GetWindowLongW = lib.func('int GetWindowLongW(intptr_t h, int i)');
  const WinEventProcCb = koffi.proto('void WinEventProc(intptr_t hHook, unsigned long dwEvent, intptr_t hwnd, long idObject, long idChild, unsigned long dwEventThread, unsigned long dwmsEventTime)');
  const SetWinEventHook = lib.func('intptr_t SetWinEventHook(unsigned long eventMin, unsigned long eventMax, intptr_t hmodWinEventProc, WinEventProc *lpfnWinEventProc, unsigned long idProcess, unsigned long idThread, unsigned long dwFlags)');
  const UnhookWinEvent = lib.func('int UnhookWinEvent(intptr_t hHook)');

  // EVENT_SYSTEM_FOREGROUND / MINIMIZESTART / MINIMIZEEND / OBJECT_SHOW / OBJECT_HIDE
  const EVENTS = [0x0003, 0x0016, 0x0017, 0x8002, 0x8003];
  const WINEVENT_OUTOFCONTEXT = 0;
  const WS_VISIBLE = 0x10000000;
  const WS_CAPTION = 0x00c00000;
  const WS_EX_APPWINDOW = 0x40000;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_TOPMOST = 0x8;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
  let topmost = false;
  let lastCheck = 0;

  const setTopmost = (on) => {
    if (on === topmost) return;
    topmost = on;
    try { win.setAlwaysOnTop(on, 'screen-saver'); } catch { /* 竞态：下次事件自愈 */ }
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

  let recheckTimer = null;
  const compute = () => {
    if (win.isDestroyed()) return;
    try { setTopmost(isDesktopState()); } catch { /* 枚举竞态：复核自愈 */ }
  };
  const check = () => {
    const now = Date.now();
    if (now - lastCheck < 50) return; // 事件风暴节流
    lastCheck = now;
    compute();
    // Win32 事件早于窗口状态生效（如 MINIMIZESTART 先于 iconic 置位）：
    // 150ms 后复核一次（事件处理的收尾，非常驻轮询）
    if (recheckTimer) clearTimeout(recheckTimer);
    recheckTimer = setTimeout(() => { recheckTimer = null; compute(); }, 150);
  };

  const hookCb = koffi.register((_hook, _event, eventHwnd, idObject) => {
    if (eventHwnd === 0 || idObject !== 0 /*OBJID_WINDOW*/) return;
    check();
  }, koffi.pointer(WinEventProcCb));
  const hooks = EVENTS.map((ev) => SetWinEventHook(ev, ev, 0, hookCb, 0, 0, WINEVENT_OUTOFCONTEXT));

  win.once('closed', () => {
    for (const h of hooks) if (h) UnhookWinEvent(h);
    koffi.unregister(hookCb);
  });

  check(); // 初始态
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
  // Win+D 兜底：临时置顶由 startWinDGuard 驱动；极端时序下若仍被最小化则立即弹回
  // （无任务栏按钮 = 用户没有主动最小化的常规途径，误伤为零）
  win.on('minimize', () => win.restore());
  win.once('ready-to-show', () => {
    win.show();
    startWinDGuard(win);
  });
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
