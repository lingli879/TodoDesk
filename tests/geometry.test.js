const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/shared/geometry');

const DISP = [
  { primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
  { primary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
];

test('完全在屏内不动', () => {
  const r = g.fitRectToDisplays({ x: 100, y: 100, width: 300, height: 420 }, DISP);
  assert.deepEqual(r, { x: 100, y: 100, width: 300, height: 420 });
});

test('不交任何屏→主屏右下角', () => {
  const r = g.fitRectToDisplays({ x: 5000, y: 5000, width: 300, height: 420 }, DISP);
  assert.equal(r.x, 1920 - 300 - 16);
  assert.equal(r.y, 1040 - 420 - 16);
});

test('部分越界→收回完全可见', () => {
  const r = g.fitRectToDisplays({ x: 1800, y: -100, width: 300, height: 420 }, DISP);
  assert.equal(r.x, 1920 - 300);
  assert.equal(r.y, 0);
});

test('落在副屏则保留', () => {
  const r = g.fitRectToDisplays({ x: 2200, y: 100, width: 300, height: 420 }, DISP);
  assert.equal(r.x, 2200);
});
