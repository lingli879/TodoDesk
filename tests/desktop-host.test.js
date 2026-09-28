const test = require('node:test');
const assert = require('node:assert');

// chooseHost 是纯函数，不触发 koffi 加载（desktop-host 对原生绑定惰性初始化）
const { chooseHost } = require('../src/main/desktop-host');

test('有 WorkerW → 附着它（壁纸与图标之间）', () => {
  assert.equal(chooseHost({ progman: 11, workerW: 22 }), 22);
});

test('无 WorkerW 但有 Progman → 降级附着 Progman', () => {
  assert.equal(chooseHost({ progman: 11, workerW: 0 }), 11);
});

test('两者皆无 → 返回 null，保持普通顶层窗口', () => {
  assert.equal(chooseHost({ progman: 0, workerW: 0 }), null);
});

const { findDesktopHost } = require('../src/main/desktop-host');

test('真桌面会话能找到宿主窗口（win32 smoke）', { skip: process.platform !== 'win32' }, () => {
  const host = findDesktopHost();
  assert.ok(host === null || typeof host === 'number', '返回 null 或 number');
  // 有交互桌面时必须找到宿主；无桌面会话（SSH/服务）时才允许 null
  if (process.env.SESSIONNAME && !process.env.SESSIONNAME.includes('Service')) {
    assert.ok(typeof host === 'number' && host !== 0, '桌面会话中宿主必然存在');
  }
});

const { decideRestart } = require('../src/main/watchdog');

test('优雅退出标记 30 秒内 → 不重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: 5000, recentRestartTimes: [], now: 1000000 }), 'exit');
});

test('无标记且未达循环上限 → 重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [], now: 1000000 }), 'restart');
});

test('2 分钟内已重启 3 次 → 放弃（防循环）', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [999000, 995000, 890000], now: 1000000 }), 'abort');
});

test('重启史超过 2 分钟前 → 不算循环，照常重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [500000, 400000, 300000], now: 1000000 }), 'restart');
});
