const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const store = require('../src/shared/store');
const { seedState } = require('../src/shared/model');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'td-'));
const good = seedState('2026-09-25T00:00:00Z');

test('首次 load 返回种子并可在 save/load 往返', () => {
  const dir = tmp();
  const r = store.loadState(dir);
  assert.equal(r.data.categories[0].name, '默认');
  store.saveState(dir, { ...r.data, todos: [{ id: '1', title: 'x' }] });
  const r2 = store.loadState(dir);
  assert.equal(r2.data.todos.length, 1);
  assert.equal(r2.corrupted, false);
});

test('sanitize 补 durationHours 并为存量已完成回填', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    ...good,
    todos: [
      { id: '1', title: 'done-old', startTime: '2026-09-25T02:00:00Z', endTime: '2026-09-25T04:15:00Z' },
      { id: '2', title: 'done-kept', startTime: '2026-09-25T02:00:00Z', endTime: '2026-09-25T04:15:00Z', durationHours: 5 },
      { id: '3', title: 'active', startTime: '2026-09-25T02:00:00Z', endTime: null },
    ],
  }));
  const r = store.loadState(dir);
  const [d1, d2, a] = r.data.todos;
  assert.equal(d1.durationHours, 2.5, '存量已完成按时间差回填（2.25h 半值向上）');
  assert.equal(d2.durationHours, 5, '已有人工值不覆盖');
  assert.equal(a.durationHours, null, '未完成不填');
});

test('save 产生 .bak 滚动备份', () => {
  const dir = tmp();
  store.saveState(dir, good);
  store.saveState(dir, { ...good, todos: [{ id: '1', title: 'y' }] });
  const bak = JSON.parse(fs.readFileSync(path.join(dir, 'data.json.bak'), 'utf8'));
  assert.equal(bak.todos.length, 0); // 第一版内容进备份
});

test('主文件损坏→从备份恢复并标记', () => {
  const dir = tmp();
  store.saveState(dir, good);
  store.saveState(dir, good); // 确保 bak 存在
  fs.writeFileSync(path.join(dir, 'data.json'), '{broken json');
  const r = store.loadState(dir);
  assert.equal(r.recoveredFromBackup, true);
  assert.equal(r.corrupted, false);
});

test('双损坏→只标记不改文件（Review Focus 3）', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'data.json'), 'x');
  fs.writeFileSync(path.join(dir, 'data.json.bak'), 'y');
  const before = fs.readFileSync(path.join(dir, 'data.json'), 'utf8');
  const r = store.loadState(dir);
  assert.equal(r.corrupted, true);
  assert.equal(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'), before);
  store.archiveCorrupted(dir);
  assert.ok(fs.existsSync(path.join(dir, 'data.json.corrupt')));
});

test('ensureWritable 可写目录通过', () => {
  assert.doesNotThrow(() => store.ensureWritable(tmp()));
});
