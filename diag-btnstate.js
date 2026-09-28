'use strict';
// 决定性实验：模拟真实点击显示桌面按钮 → 采样普通窗口的全套可观测状态
const { spawn, execSync } = require('node:child_process');
const koffi = require('koffi');
const u = koffi.load('user32.dll');
const dwm = koffi.load('dwmapi.dll');
const FW = u.func('intptr_t FindWindowW(const wchar_t *c, const wchar_t *t)');
const IsIconic = u.func('int IsIconic(intptr_t h)');
const IsVis = u.func('int IsWindowVisible(intptr_t h)');
const GWR = u.func('int GetWindowRect(intptr_t h, long *rc)');
const WFP = u.func('intptr_t WindowFromPoint(long x, long y)');
const GAC = u.func('intptr_t GetAncestor(intptr_t h, unsigned int ga)');
const SCP = u.func('int SetCursorPos(int x, int y)');
const ME = u.func('void mouse_event(unsigned long f, unsigned long dx, unsigned long dy, unsigned long d, uintptr_t e)');
const Dgwa = dwm.func('long DwmGetWindowAttribute(intptr_t h, unsigned long attr, void *pv, int cb)');
const rect = (h) => { const p = koffi.alloc('long', 4); GWR(h, p); return koffi.decode(p, 'long', 4); };
const cloakOf = (h) => { const b = koffi.alloc('unsigned long', 1); Dgwa(h, 14, b, 4); return koffi.decode(b, 'unsigned long', 1)[0]; };

spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
setTimeout(() => {
  const np = FW('Notepad', null);
  const snap = (label) => {
    const [l, t, r, b] = rect(np);
    const cx = (l + r) >> 1, cy = (t + b) >> 1;
    const hit = WFP(cx, cy);
    let root = hit, inTree = false, c = hit, n = 0;
    while (c && n++ < 10) { if (c === np) { inTree = true; break; } c = GAC(c, 2); }
    console.log(label,
      'iconic=' + IsIconic(np),
      'visible=' + IsVis(np),
      'cloak=' + cloakOf(np),
      'hit=' + String(hit),
      'hitIsNotepad=' + inTree);
  };
  snap('[正常态]    ');
  // 点击任务栏右下角显示桌面按钮（最右缘中点）——用主屏物理坐标
  console.log('--- 模拟点击显示桌面按钮 ---');
  const p1 = koffi.alloc('long', 2);
  SCP(3050, 1880); ME(2, 0, 0, 0, 0); ME(4, 0, 0, 0, 0);
  setTimeout(() => {
    snap('[按钮触发后]');
    // 再点一次恢复
    SCP(3050, 1880); ME(2, 0, 0, 0, 0); ME(4, 0, 0, 0, 0);
    setTimeout(() => {
      snap('[再点恢复后]');
      try { execSync('taskkill /F /IM notepad.exe', { stdio: 'ignore' }); } catch { /* gone */ }
      process.exit(0);
    }, 2000);
  }, 2000);
}, 4000);
