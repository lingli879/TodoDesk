const test = require('node:test');
const assert = require('node:assert');
const { registerIpc } = require('../src/main/ipc');
const { seedState } = require('../src/shared/model');

function harness() {
  const handlers = {};
  const sent = [];
  const opened = [];
  const winOps = [];
  let quitCalls = 0;
  const state = seedState('2026-09-25T00:00:00Z');
  const services = {
    getState: () => state,
    mutate: (fn) => fn(state),
    broadcast: (ch) => sent.push(ch),
    openDataFolder: () => {},
    showMainWindow: () => {},
    exitApp: () => { quitCalls += 1; },
    toggleWidget: () => {},
    applyHotkey: () => true,
    openDetail: (id) => { opened.push(id); },
    beginWidgetDrag: (p) => winOps.push(['begin-drag', p]),
    dragWidget: (p) => winOps.push(['drag', p]),
    endWidgetDrag: () => winOps.push(['end-drag']),
    beginWidgetResize: (p) => winOps.push(['begin-resize', p]),
    resizeWidgetTo: (p) => winOps.push(['resize', p]),
    endWidgetResize: () => winOps.push(['end-resize']),
  };
  registerIpc({
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  }, services);
  const call = (ch, arg) => handlers[ch]({ sender: {} }, arg);
  return { handlers, call, state, sent, opened, winOps, quitCalls: () => quitCalls };
}

test('todos:create 校验拒绝空标题', async () => {
  const h = harness();
  const r = await h.call('todos:create', { title: '' });
  assert.equal(r.ok, false);
});

test('detail:open 转发待办 id 给主进程服务', async () => {
  const h = harness();
  const r = await h.call('detail:open', 't-123');
  assert.equal(r.ok, true);
  assert.deepEqual(h.opened, ['t-123']);
});

test('widget:begin-drag/drag-move 转发给窗口服务', () => {
  const h = harness();
  h.call('widget:begin-drag', { screenX: 10, screenY: 20 });
  h.call('widget:drag-move', { screenX: 30, screenY: 45 });
  assert.deepEqual(h.winOps, [
    ['begin-drag', { screenX: 10, screenY: 20 }],
    ['drag', { screenX: 30, screenY: 45 }],
  ]);
});

test('widget:begin-resize/resize-move/end-resize 顺序转发', () => {
  const h = harness();
  h.call('widget:begin-resize', { screenX: 0, screenY: 0 });
  h.call('widget:resize-move', { screenX: 100, screenY: 60 });
  h.call('widget:end-resize');
  assert.deepEqual(h.winOps, [
    ['begin-resize', { screenX: 0, screenY: 0 }],
    ['resize', { screenX: 100, screenY: 60 }],
    ['end-resize'],
  ]);
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
