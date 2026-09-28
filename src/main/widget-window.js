'use strict';
// 桌面贴窗口：透明/无边框/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// Win+D / 任务栏「显示桌面」按钮：Shell 钩子监听（RegisterShellHookWindow + 子类化窗口
// 过程拦截 WM_SHELLHOOK）。实测信号：显示桌面切换时 HSHELL_WINDOWACTIVATED(0x4) 且
// lParam=0（无窗口被激活，显示桌面的专属特征）；恢复时 lParam=窗口句柄。键盘与按钮
// 走同一 Shell 路径，单一事件源统一覆盖。状态化规则（非盲翻转，防乱序双翻）：
//   桌面激活(lp=0)  且未置顶 → 置顶（豁免 DWM 显示桌面收起）
//   窗口激活(lp≠0)  且已置顶 → 取消置顶
// 启动时沉底（贴桌面层级）。拖动/缩放走应用层 IPC（见 main.js）。
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
  const FindWindowW = lib.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)');
  const GetForegroundWindow = lib.func('intptr_t GetForegroundWindow()');
  const RegisterShellHookWindow = lib.func('int RegisterShellHookWindow(intptr_t hwnd)');
  const DeregisterShellHookWindow = lib.func('int DeregisterShellHookWindow(intptr_t hwnd)');
  const RegisterWindowMessageW = lib.func('unsigned int RegisterWindowMessageW(const wchar_t *lpString)');
  const SetWindowLongPtrW = lib.func('intptr_t SetWindowLongPtrW(intptr_t h, int index, intptr_t newLong)');
  const CallWindowProcW = lib.func('intptr_t CallWindowProcW(intptr_t prev, intptr_t h, unsigned int msg, intptr_t wp, intptr_t lp)');
  const WndProcCb = koffi.proto('intptr_t WndProc(intptr_t hwnd, unsigned int msg, intptr_t wp, intptr_t lp)');
  const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  const EnumWindows = lib.func('int EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = lib.func('int IsWindowVisible(intptr_t h)');
  const IsIconic = lib.func('int IsIconic(intptr_t h)');
  const GetWindowLongW = lib.func('int GetWindowLongW(intptr_t h, int i)');

  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const GWLP_WNDPROC = -4;
  const HSHELL_WINDOWACTIVATED = 0x4;
  const WS_VISIBLE = 0x10000000;
  const WS_CAPTION = 0x00c00000;
  const WS_EX_APPWINDOW = 0x40000;
  const WS_EX_TOOLWINDOW = 0x80;
  const WS_EX_TOPMOST = 0x8;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);

  const sink = () => {
    try { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch { /* 窗口竞态 */ }
  };
  const rise = () => { try { win.moveTop(); } catch { /* 窗口竞态 */ } };

  let desktopMode = false;
  const applyTopmost = (on) => {
    desktopMode = on;
    try { win.setAlwaysOnTop(on, 'screen-saver'); } catch { /* 竞态：下次事件自愈 */ }
  };

  // ---- 显示桌面确认（通用，不依赖坐标/分辨率/任务栏位置）----
  // Shell 的桌面激活信号（lp=0）在「点桌面图标」时也会出现。通用判据看效果：
  // 显示桌面的本质是「普通窗口全部从屏幕消失」（被最小化/收起）。
  // 枚举判定「无可见未最小化的应用窗口」即为显示桌面。
  const hasVisibleAppWindow = () => {
    let found = false;
    const cb = koffi.register((h) => {
      if (found || h === hwnd) return 1;
      const ex = GetWindowLongW(h, -20) >>> 0;
      if (ex & (WS_EX_TOOLWINDOW | WS_EX_TOPMOST)) return 1;
      const style = GetWindowLongW(h, -16) >>> 0;
      if (!(style & WS_VISIBLE) || !IsWindowVisible(h) || IsIconic(h)) return 1;
      if (!((ex & WS_EX_APPWINDOW) || (style & WS_CAPTION))) return 1;
      found = true;
      return 0; // 找到即停
    }, koffi.pointer(EnumWindowsProc));
    try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
    return found;
  };

  // Shell 钩子：显示桌面切换（键盘 Win+D 与任务栏按钮同源）广播「无窗口激活」（lp=0）
  RegisterShellHookWindow(hwnd);
  const WM_SHELLHOOK = RegisterWindowMessageW('SHELLHOOK');
  // 渐进重试：首次立即判定（键盘 Win+D 时序快，立即命中即无闪烁）；
  // 按钮触发时首个信号早于窗口最小化完成——每 150ms 复查，窗口全部消失的瞬间命中
  //（无固定延迟的空等）。点桌面图标场景窗口始终显示，重试耗尽后放弃。
  const attemptShowDesktop = (n) => {
    if (desktopMode || win.isDestroyed() || n > 6) return;
    if (!hasVisibleAppWindow()) { applyTopmost(true); return; }
    setTimeout(() => attemptShowDesktop(n + 1), 150);
  };
  const shellProc = koffi.register((h, msg, wp, lp) => {
    if (msg === WM_SHELLHOOK && wp === HSHELL_WINDOWACTIVATED && !win.isDestroyed()) {
      if (lp === 0 && !desktopMode) attemptShowDesktop(0);
      else if (lp !== 0 && desktopMode) applyTopmost(false); // 窗口接管：立即取消置顶
    }
    return CallWindowProcW(prevProc, h, msg, wp, lp);
  }, koffi.pointer(WndProcCb));
  const prevProc = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, shellProc);

  win.once('closed', () => {
    try {
      SetWindowLongPtrW(hwnd, GWLP_WNDPROC, prevProc);
      DeregisterShellHookWindow(hwnd);
    } catch { /* 已销毁 */ }
    koffi.unregister(shellProc);
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
