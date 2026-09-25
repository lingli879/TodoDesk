const test = require('node:test');
const assert = require('node:assert');
const { registerIpc } = require('../src/main/ipc');
const { seedState } = require('../src/shared/model');

function harness() {
  const handlers = {};
  const sent = [];
  const state = seedState('2026-09-25T00:00:00Z');
  const services = {
    getState: () => state,
    mutate: (fn) => fn(state),
    broadcast: (ch) => sent.push(ch),
    openDataFolder: () => {},
    showMainWindow: () => {},
    toggleWidget: () => {},
    applyHotkey: () => true,
  };
  registerIpc({ handle: (ch, fn) => { handlers[ch] = fn; } }, services);
  const call = (ch, arg) => handlers[ch]({ sender: {} }, arg);
  return { handlers, call, state, sent };
}

test('todos:create 校验拒绝空标题', async () => {
  const h = harness();
  const r = await h.call('todos:create', { title: '' });
  assert.equal(r.ok, false);
});

test('todos:complete 设 endTime 且幂等', async () => {
  const h = harness();
  const t = (await h.call('todos:create', { title: 'a', categoryId: null })).value;
  const c1 = await h.call('todos:complete', t.id);
  const c2 = await h.call('todos:complete', t.id);
  assert.equal(c2.value.endTime, c1.value.endTime);
});

test('写通道广播 data-changed', async () => {
  const h = harness();
  await h.call('todos:create', { title: 'a', categoryId: null });
  assert.ok(h.sent.includes('data-changed'));
});

test('categories:remove 归转为未分类', async () => {
  const h = harness();
  const cat = (await h.call('categories:create', { name: 'w', color: '#2FA98C' })).value;
  const todo = (await h.call('todos:create', { title: 'a', categoryId: cat.id })).value;
  await h.call('categories:remove', cat.id);
  assert.equal(h.state.todos.find((t) => t.id === todo.id).categoryId, null);
});

test('settings:set 副作用广播 settings-changed', async () => {
  const h = harness();
  await h.call('settings:set', { widgetOpacity: 0.6 });
  assert.equal(h.state.settings.widgetOpacity, 0.6);
  assert.ok(h.sent.includes('settings-changed'));
});
