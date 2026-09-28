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
