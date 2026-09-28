'use strict';
// 桌面态动态迁移：Win11 的「显示桌面」由 DWM 合成层收起所有顶层窗口的 visual
// （窗口的 iconic/z 序/cloak/rect 全无痕迹），唯一视觉豁免的是桌面层（Progman）内部的窗口；
// 而桌面层窗口又收不到真实输入。因此按 Win+D 时动态切换：
//   桌面态（显示桌面）→ SetParent 进 Progman 并置于图标层之上（随桌面可见，无需输入）
//   正常态            → 脱附回顶层沉底（交互恢复，贴桌面层级）
// 检测用 GetAsyncKeyState 轮询 Win+D 组合（无需钩子/消息泵/管理员权限）。
const koffi = require('koffi');

const VK_LWIN = 0x5b;
const VK_D = 0x44;
const POLL_MS = 20;      // 组合键按下持续时间远大于此，不会漏
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const HWND_TOP = 0;
const HWND_BOTTOM = 1;

let api = null;
function u32() {
  if (!api) {
    const lib = koffi.load('user32.dll');
    api = {
      GetAsyncKeyState: lib.func('short GetAsyncKeyState(int vKey)'),
      FindWindowW: lib.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)'),
      SetParent: lib.func('intptr_t SetParent(intptr_t hWndChild, intptr_t hWndNewParent)'),
      SetWindowPos: lib.func('int SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int x, int y, int cx, int cy, unsigned int uFlags)'),
    };
  }
  return api;
}

// 组合边沿判定（纯函数）：仅在「未按下 → 按下」的跳变时视为一次 Win+D
function isComboEdge(prevCombo, winDown, dDown) {
  const combo = winDown && dDown;
  return !prevCombo && combo;
}

function startDesktopModeWatch(win) {
  const { GetAsyncKeyState, FindWindowW, SetParent, SetWindowPos } = u32();
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
  let desktopMode = false;
  let prevCombo = false;
  const apply = (on) => {
    if (win.isDestroyed()) return;
    const progman = FindWindowW('Progman', null);
    if (!progman) return;
    try {
      if (on) {
        SetParent(hwnd, progman); // 桌面层：随「显示桌面」保持可见
        SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); // 浮于图标层
      } else {
        SetParent(hwnd, 0); // 回顶层：恢复输入
        SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); // 沉底贴桌面
      }
    } catch { /* 窗口销毁竞态：下次切换自愈 */ }
  };
  const timer = setInterval(() => {
    if (win.isDestroyed()) { stop(); return; }
    const winDown = !!(GetAsyncKeyState(VK_LWIN) & 0x8000);
    const dDown = !!(GetAsyncKeyState(VK_D) & 0x8000);
    if (isComboEdge(prevCombo, winDown, dDown)) {
      desktopMode = !desktopMode;
      apply(desktopMode);
    }
    prevCombo = winDown && dDown;
  }, POLL_MS);
  function stop() { clearInterval(timer); }
  return { stop };
}

module.exports = { startDesktopModeWatch, isComboEdge };
