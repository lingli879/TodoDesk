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
