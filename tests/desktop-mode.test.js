const test = require('node:test');
const assert = require('node:assert');

// isComboEdge 纯函数（不触发 koffi 加载）
const { isComboEdge } = require('../src/main/desktop-mode');

test('未按下 → Win+D 同时按下 = 一次边沿', () => {
  assert.equal(isComboEdge(false, true, true), true);
});

test('持续按住（上一轮已组合）不重复触发', () => {
  assert.equal(isComboEdge(true, true, true), false);
});

test('只按 Win 不按 D 不触发', () => {
  assert.equal(isComboEdge(false, true, false), false);
});

test('只按 D 不按 Win 不触发', () => {
  assert.equal(isComboEdge(false, false, true), false);
});

test('抬起后再按 = 新边沿（toggle 语义）', () => {
  assert.equal(isComboEdge(false, true, true), true); // 第一按
  assert.equal(isComboEdge(true, true, true), false); // 持续
  assert.equal(isComboEdge(false, false, false), false); // 抬起
  assert.equal(isComboEdge(false, true, true), true); // 第二按
});
