const test = require('node:test');
const assert = require('node:assert');

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
