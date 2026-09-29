'use strict';
// 桌面贴窗口：透明/无边框/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// 显示桌面切换的两种触发（同一 toggle、同一动作，均无坐标依赖）：
//   1. 键盘 Win+D：GetAsyncKeyState 轮询组合边沿
//   2. 任务栏「显示桌面」按钮：WinEvent 焦点序列指纹——「任务栏获焦后 500ms 内
//      桌面（Progman）获焦」。实测（Win11 26200）：点按钮 = 任务栏焦点 → 约 135ms
//      后桌面焦点；点时钟 = 任务栏焦点 → 弹出层焦点（桌面不获焦）；点桌面空白 =
//      桌面直接获焦（无前置任务栏焦点）。事件序列与分辨率/缩放无关。
// toggle 语义：进桌面 → 置顶豁免 DWM 收起（桌面贴随桌面可见）；
//              恢复 → 单次原子沉底（HWND_BOTTOM 隐含摘除 topmost 位，无中间帧）。
// 焦点驱动层级：桌面贴获焦 → 浮到普通层顶部；失焦 → 沉回底部（置顶豁免期间不沉）。
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
  const FindWindowW = lib.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)');
  const WinEventProcCb = koffi.proto('void WinEventProc(intptr_t hHook, unsigned long dwEvent, intptr_t hwnd, long idObject, long idChild, unsigned long dwThread, unsigned long dwTime)');
  const SetWinEventHook = lib.func('intptr_t SetWinEventHook(unsigned long eventMin, unsigned long eventMax, intptr_t hmod, WinEventProc *proc, unsigned long pid, unsigned long tid, unsigned long flags)');
  const UnhookWinEvent = lib.func('int UnhookWinEvent(intptr_t hHook)');

  const HWND_BOTTOM = 1;
  const SWP_NOSIZE = 0x0001;
  const SWP_NOMOVE = 0x0002;
  const SWP_NOACTIVATE = 0x0010;
  const EVENT_OBJECT_FOCUS = 0x8005;
  const EVENT_SYSTEM_FOREGROUND = 0x0003;
  const WINEVENT_OUTOFCONTEXT = 0;
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);

  const sink = () => {
    try { SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); } catch { /* 窗口竞态 */ }
  };
  const rise = () => { try { win.moveTop(); } catch { /* 窗口竞态 */ } };

  let desktopMode = false;
  const toggle = () => {
    desktopMode = !desktopMode;
    try {
      if (desktopMode) {
        win.setAlwaysOnTop(true, 'screen-saver');
      } else {
        // 显式摘除 topmost 位再沉底：实测 Win11 26200 上 HWND_BOTTOM 不摘 topmost
        // 位（窗口会留在置顶层底部），必须两步；同一同步块执行，同帧合并不闪
        win.setAlwaysOnTop(false, 'screen-saver');
        sink();
      }
    } catch { /* 窗口竞态 */ }
  };

  // ---- 焦点驱动层级（用户指定）：获焦 → 浮到普通层顶部；失焦 → 沉回底部 ----
  // Win+D 置顶豁免期间（desktopMode）失焦不沉，保住显示桌面态不被破坏。
  win.on('focus', rise);
  win.on('blur', () => { if (!desktopMode) sink(); });

  // ---- 前台切换守卫（用户指定）：系统激活的窗口只要不是 TodoDesk 的——
  // 取消置顶状态（撤销 Win+D 豁免）并沉底。覆盖桌面贴从未获焦（无 blur）的场景。
  // 判据 = 前台窗口所属进程：TodoDesk 主进程的窗口（桌面贴/主窗口/详情窗）豁免。
  const GetForegroundWindow = lib.func('intptr_t GetForegroundWindow()');
  const GetWindowThreadProcessId = lib.func('unsigned long GetWindowThreadProcessId(intptr_t h, unsigned long *pid)');
  const fgCb = koffi.register(() => {
    if (win.isDestroyed()) return;
    const fg = GetForegroundWindow();
    if (!fg || fg === hwnd) return;
    // 桌面系前台（Progman/WorkerW）= 桌面露出的正常状态（Win+D/按钮进入显示桌面
    // 时前台会切给桌面）：排除，否则前台守卫会撤销刚建立的置顶豁免（时序竞态）
    if (fg === FindWindowW('Progman', null) || fg === FindWindowW('WorkerW', null)) return;
    const pidBuf = koffi.alloc('unsigned long', 1);
    GetWindowThreadProcessId(fg, pidBuf);
    if (koffi.decode(pidBuf, 'unsigned long', 1)[0] === process.pid) return;
    // 前台切到非 TodoDesk 应用：复位豁免状态；原子沉底（HWND_BOTTOM 隐含摘除 topmost 位）
    desktopMode = false;
    sink();
  }, koffi.pointer(WinEventProcCb));
  const fgHook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, 0, fgCb, 0, 0, WINEVENT_OUTOFCONTEXT);

  // ---- 键盘 Win+D：组合键边沿 ----
  let prevCombo = false;
  const timer = setInterval(() => {
    if (win.isDestroyed()) { clearInterval(timer); return; }
    const combo = !!(GetAsyncKeyState(VK_LWIN) & 0x8000) && !!(GetAsyncKeyState(VK_D) & 0x8000);
    if (combo && !prevCombo) toggle();
    prevCombo = combo;
  }, 20);

  // ---- 任务栏「显示桌面」按钮：焦点序列指纹（任务栏获焦 → 500ms 内目标窗口获焦）----
  // 进桌面：任务栏 → Progman（桌面接管）；恢复：任务栏 → 应用窗口（排除任务栏
  // 自身 XAML 子元素与弹出层 CoreWindow）。点桌面本身无前置任务栏焦点，不误触。
  // 附加判据：应用启动时任务栏按钮也会闪烁获焦（非用户点击）——故任务栏获焦时
  // 还要求光标在任务栏矩形内（矩形实时取自 Shell_TrayWnd，分辨率无关）才算用户点击。
  const trayFocusAt = { t: 0 };
  const GetWindowLongW = lib.func('int GetWindowLongW(intptr_t h, int i)');
  const GetCursorPos = lib.func('int GetCursorPos(long *lpPoint)');
  const GetWindowRect = lib.func('int GetWindowRect(intptr_t h, long *rc)');
  const cursorInTray = (tray) => {
    const rc = koffi.alloc('long', 4);
    GetWindowRect(tray, rc);
    const [l, t, r, b] = koffi.decode(rc, 'long', 4);
    const pt = koffi.alloc('long', 2);
    GetCursorPos(pt);
    const [x, y] = koffi.decode(pt, 'long', 2);
    return x >= l && x < r && y >= t && y < b;
  };
  const isAppWindow = (h) => {
    const ex = GetWindowLongW(h, -20) >>> 0;
    const style = GetWindowLongW(h, -16) >>> 0;
    return !!(ex & 0x40000 /*WS_EX_APPWINDOW*/) || !!(style & 0x00c00000 /*WS_CAPTION*/);
  };
  const focusCb = koffi.register((hk, ev, h) => {
    if (win.isDestroyed()) return;
    const tray = FindWindowW('Shell_TrayWnd', null);
    const progman = FindWindowW('Progman', null);
    if (h === tray) {
      // 仅当光标在任务栏内且左键按下过（点按钮必有鼠标按下）才算用户点击任务栏；
      // 应用启动/Win+D 时任务栏的闪烁获焦（无鼠标按下）不算
      const ms = GetAsyncKeyState(VK_LBUTTON);
      trayFocusAt.t = (cursorInTray(tray) && ((ms & 0x8000) || (ms & 0x1))) ? Date.now() : 0;
      return;
    }
    if (h === progman) {
      // 任务栏点击后桌面接管 = 进入显示桌面
      if (trayFocusAt.t && Date.now() - trayFocusAt.t < 500 && !desktopMode) {
        trayFocusAt.t = 0;
        toggle();
      }
      return;
    }
    // 其他窗口：应用窗口（有任务栏按钮或标题框）在任务栏点击后接管 = 恢复
    if (trayFocusAt.t && Date.now() - trayFocusAt.t < 500 && desktopMode && isAppWindow(h)) {
      trayFocusAt.t = 0;
      toggle();
    }
  }, koffi.pointer(WinEventProcCb));
  const focusHook = SetWinEventHook(EVENT_OBJECT_FOCUS, EVENT_OBJECT_FOCUS, 0, focusCb, 0, 0, WINEVENT_OUTOFCONTEXT);

  win.once('closed', () => {
    clearInterval(timer);
    if (focusHook) UnhookWinEvent(focusHook);
    if (fgHook) UnhookWinEvent(fgHook);
    koffi.unregister(focusCb);
    koffi.unregister(fgCb);
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
