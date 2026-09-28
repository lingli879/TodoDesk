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
      GetWindowRect: lib.func('int GetWindowRect(intptr_t hWnd, long *lpRect)'),
      ScreenToClient: lib.func('int ScreenToClient(intptr_t hWnd, long *lpPoint)'),
    };
  }
  return api;
}

// 窗口屏幕矩形（GetWindowRect 恒为屏幕坐标，不受父子化影响）
function screenRect(hwnd) {
  const { GetWindowRect } = u32();
  const p = koffi.alloc('long', 4);
  GetWindowRect(hwnd, p);
  return koffi.decode(p, 'long', 4);
}

// 组合边沿判定（纯函数）：仅在「未按下 → 按下」的跳变时视为一次 Win+D
function isComboEdge(prevCombo, winDown, dDown) {
  const combo = winDown && dDown;
  return !prevCombo && combo;
}

function startDesktopModeWatch(win) {
  const { GetAsyncKeyState, FindWindowW, SetParent, SetWindowPos, ScreenToClient } = u32();
  const hwnd = win.getNativeWindowHandle().readUInt32LE(0);
  let desktopMode = false;
  let prevCombo = false;
  let savedBounds = null; // attach 前的 Electron bounds（DIP 真值，detach 时恢复）
  const apply = (on) => {
    if (win.isDestroyed()) return;
    const progman = FindWindowW('Progman', null);
    if (!progman) return;
    try {
      if (on) {
        // 记录 Electron bounds（真值源）：SetParent 坐标语义切换 + Chromium 内部状态同步都依赖它
        savedBounds = win.getBounds();
        const rc = screenRect(hwnd); // 原生屏幕矩形（物理像素）
        const w = rc[2] - rc[0], h = rc[3] - rc[1];
        SetParent(hwnd, progman); // 桌面层：随「显示桌面」保持可见
        const pbuf = koffi.alloc('long', 2);
        koffi.encode(pbuf, 'long[2]', [rc[0], rc[1]]);
        ScreenToClient(progman, pbuf); // 目标屏幕位置 → Progman 客户区坐标（多屏/缩放下有偏移）
        const [cx, cy] = koffi.decode(pbuf, 'long', 2);
        SetWindowPos(hwnd, HWND_TOP, cx, cy, w, h, SWP_NOACTIVATE); // 浮于图标层
        // 显示桌面动画可能平移桌面层子窗口，动画结束后复查校正一次
        setTimeout(() => {
          if (win.isDestroyed() || !desktopMode) return;
          const now = screenRect(hwnd);
          if (Math.abs(now[0] - rc[0]) > 2 || Math.abs(now[1] - rc[1]) > 2
            || Math.abs((now[2] - now[0]) - w) > 2 || Math.abs((now[3] - now[1]) - h) > 2) {
            const pb = koffi.alloc('long', 2);
            koffi.encode(pb, 'long[2]', [rc[0], rc[1]]);
            ScreenToClient(progman, pb);
            const [x2, y2] = koffi.decode(pb, 'long', 2);
            SetWindowPos(hwnd, HWND_TOP, x2, y2, w, h, SWP_NOACTIVATE);
          }
        }, 500);
      } else {
        SetParent(hwnd, 0); // 回顶层：恢复输入
        SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE); // 沉底贴桌面
        // 用 Electron setBounds 恢复（DIP 真值）：裸 SetWindowPos 会让 Chromium 内部 bounds 脱节，
        // 重新顶层化后被重置到屏幕中心/最小尺寸（实测）
        const restore = savedBounds;
        if (restore) win.setBounds(restore);
        savedBounds = null;
        // 「显示桌面」恢复时 Explorer 可能延迟把重新顶层化的窗口摆到级联位置（屏中心），
        // 800ms 后复查一次，被篡改则用 Electron bounds 再校正
        setTimeout(() => {
          if (win.isDestroyed() || desktopMode || !restore) return;
          const now = win.getBounds();
          if (Math.abs(now.x - restore.x) > 2 || Math.abs(now.y - restore.y) > 2
            || Math.abs(now.width - restore.width) > 2 || Math.abs(now.height - restore.height) > 2) {
            win.setBounds(restore);
          }
        }, 800);
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
