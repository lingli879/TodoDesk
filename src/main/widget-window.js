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
const VK_LWIN = 0x5b;
const VK_D = 0x44;

// Win+D 桌面态守卫：桌面态时「临时置顶」（Win11 显示桌面由 DWM 收起一切非置顶窗口的画面，
// 置顶层豁免；此时满屏皆桌面无窗口可挡），恢复后回落普通层级。纯 Electron API 切换，
// 不做 SetParent（父子化会破坏 per-monitor DPI 上下文与输入状态，已实测）。
//
// 双路径检测：
// 1. 快路径：GetAsyncKeyState 轮询 Win+D 组合边沿（20ms，先于收起动画置顶）
// 2. 慢路径：真实桌面态观测（200ms）——「屏幕上没有任何可见且未最小化的应用窗口」。
//    覆盖任务栏「显示桌面」按钮/触摸手势等非键盘触发，并校正键盘路径的状态失步
//    （如点任务栏图标恢复单个窗口后，键盘 toggle 计数与真实桌面态脱节）。
//    判据 WS_EX_APPWINDOW 正判（有任务栏按钮的应用标志）：天然排除工具窗、
//    skipTaskbar 悬浮物与置顶桌面歌词，避免它们让观测永远误判非桌面态。
function startWinDGuard(win) {
  const koffi = require('koffi');
  const lib = koffi.load('user32.dll');
  const GetAsyncKeyState = lib.func('short GetAsyncKeyState(int vKey)');
  const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  const EnumWindows = lib.func('int EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = lib.func('int IsWindowVisible(intptr_t h)');
  const IsIconic = lib.func('int IsIconic(intptr_t h)');
  const GetWindowLongW = lib.func('int GetWindowLongW(intptr_t h, int i)');

  const WS_VISIBLE = 0x10000000;
  const WS_CAPTION = 0x00c00000;
  const WS_EX_APPWINDOW = 0x40000;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_TOPMOST = 0x8;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
  let topmost = false;
  let lastFlip = 0;

  const setTopmost = (on) => {
    if (on === topmost) return;
    topmost = on;
    lastFlip = Date.now();
    try { win.setAlwaysOnTop(on, 'screen-saver'); } catch { /* 竞态：观测路径自愈 */ }
  };

  function isDesktopState() {
    let ordinary = 0;
    const cb = koffi.register((h) => {
      if (h === hwnd) return 1;
      const ex = GetWindowLongW(h, -20) >>> 0;
      if (ex & WS_EX_TOOLWINDOW) return 1; // 工具窗/skipTaskbar 悬浮物
      if (ex & WS_EX_TOPMOST) return 1;    // 置顶桌面歌词等悬浮
      const style = GetWindowLongW(h, -16) >>> 0;
      if (!(style & WS_VISIBLE)) return 1;
      if (!IsWindowVisible(h) || IsIconic(h)) return 1;
      // 应用窗口 = 有任务栏按钮标志或标准标题框（Win11 WinUI 应用如记事本无 APPWINDOW）
      if (!((ex & WS_EX_APPWINDOW) || (style & WS_CAPTION))) return 1;
      ordinary++;
      return 1;
    }, koffi.pointer(EnumWindowsProc));
    try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
    return ordinary === 0;
  }

  let prevCombo = false;
  let fast = null;
  let slow = null;
  const dead = () => win.isDestroyed();
  fast = setInterval(() => {
    if (dead()) { clearInterval(fast); clearInterval(slow); return; }
    const combo = !!(GetAsyncKeyState(VK_LWIN) & 0x8000) && !!(GetAsyncKeyState(VK_D) & 0x8000);
    if (combo && !prevCombo) setTopmost(!topmost);
    prevCombo = combo;
  }, 20);

  // 慢路径：观测真实桌面态。键盘切换后留 800ms 宽限（等收起/恢复动画完成）再开始校正。
  slow = setInterval(() => {
    if (dead()) { clearInterval(fast); clearInterval(slow); return; }
    if (Date.now() - lastFlip < 800) return;
    try { setTopmost(isDesktopState()); } catch { /* 枚举竞态：下轮再试 */ }
  }, 200);
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
