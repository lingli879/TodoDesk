'use strict';
// 桌面层附着：把桌面贴 SetParent 到 WorkerW（壁纸与桌面图标之间），
// 使其不受 Win+D「显示桌面」影响（Rainmeter 式）。koffi 为 N-API，无需为 Electron rebuild。
// 句柄统一为 number（koffi 的 intptr_t 返回值），有效性用 truthiness 判断（0 为无效）。

function chooseHost({ progman, workerW }) {
  if (workerW) return workerW; // 首选：图标层之下的 WorkerW，不遮挡桌面图标
  if (progman) return progman; // 退化：直接附 Progman（此时会浮在图标之上，罕见配置）
  return null;                 // 找不到桌面层：保持普通顶层窗口（仍会被 Win+D 波及）
}

const koffi = require('koffi');

const WM_SPAWN_WORKERW = 0x052c; // 让 Explorer 在壁纸与图标之间生成 WorkerW
const SMTO_NORMAL = 0x0000;
const POLL_MS = 3000; // Explorer 重启自愈检测周期

let api = null;
function u32() {
  // 惰性加载：require 本模块（如单测 chooseHost）不触发原生 dlopen
  if (!api) {
    const lib = koffi.load('user32.dll');
    const EnumWindowsProc = koffi.proto('int EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
    api = {
      FindWindowW: lib.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)'),
      FindWindowExW: lib.func('intptr_t FindWindowExW(intptr_t hWndParent, intptr_t hWndChildAfter, const wchar_t *lpszClass, const wchar_t *lpszWindow)'),
      EnumWindows: lib.func('int EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)'),
      EnumWindowsProc,
      SendMessageTimeoutW: lib.func('intptr_t SendMessageTimeoutW(intptr_t hWnd, unsigned int Msg, intptr_t wParam, intptr_t lParam, unsigned int fuFlags, unsigned int uTimeout, intptr_t *lpdwResult)'),
      SetParent: lib.func('intptr_t SetParent(intptr_t hWndChild, intptr_t hWndNewParent)'),
      IsWindow: lib.func('int IsWindow(intptr_t hWnd)'),
    };
  }
  return api;
}

// 新结构（Win11 26200 实测）：Progman 直接子级里，SHELL_DLL_DefView（图标层）之后有一个 WorkerW（壁纸层）
function workerUnderProgman(progman) {
  const { FindWindowExW } = u32();
  const defView = FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
  return defView ? FindWindowExW(progman, defView, 'WorkerW', null) : 0;
}

// 经典结构：SHELLDLL_DefView 的宿主（通常为 Progman）之后（z 序更低）的顶层 WorkerW
function topWorkerAfterDefViewHost() {
  const { FindWindowExW, EnumWindows, EnumWindowsProc } = u32();
  let host = 0;
  const cb = koffi.register((hwnd) => {
    if (FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null)) host = hwnd;
    return 1; // 继续枚举
  }, koffi.pointer(EnumWindowsProc));
  try { EnumWindows(cb, 0); } finally { koffi.unregister(cb); }
  return host ? FindWindowExW(0, host, 'WorkerW', null) : 0;
}

function findDesktopHost() {
  const { FindWindowW, SendMessageTimeoutW } = u32();
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;
  let workerW = workerUnderProgman(progman) || topWorkerAfterDefViewHost();
  if (!workerW) {
    // 边缘配置（如禁用桌面图标）下没有 WorkerW：请 Explorer 生成一个再找
    const out = [0];
    SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0, 1, SMTO_NORMAL, 1000, out);
    workerW = workerUnderProgman(progman) || topWorkerAfterDefViewHost();
  }
  return chooseHost({ progman, workerW });
}

function readHwnd(win) {
  const buf = win.getNativeWindowHandle();
  return process.arch === 'x64' ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

// 附着桌面贴到桌面层；onLost 在 HWND 被外部销毁（Explorer 重启连带 WorkerW 销毁）时回调一次
function attachWidgetToDesktop(win, { onLost } = {}) {
  const { SetParent, IsWindow } = u32();
  const hwnd = readHwnd(win);
  let attached = false;
  const host = findDesktopHost();
  if (host) {
    try { SetParent(hwnd, host); attached = true; } catch { /* 附着失败：降级为普通顶层窗口 */ }
  }
  const timer = setInterval(() => {
    if (win.isDestroyed()) { stop(); return; }
    if (!IsWindow(hwnd)) { stop(); if (onLost) onLost(); }
  }, POLL_MS);
  function stop() { clearInterval(timer); }
  return { attached, stop };
}

module.exports = { chooseHost, findDesktopHost, attachWidgetToDesktop };
