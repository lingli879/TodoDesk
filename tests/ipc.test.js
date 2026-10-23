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
  let mainShown = 0;
  let hotkeyRegs = 0;
  let hotkeyOk = true;
  const state = seedState('2026-09-25T00:00:00Z');
  const services = {
    getState: () => state,
    mutate: (fn) => fn(state),
    broadcast: (ch) => sent.push(ch),
    openDataFolder: () => {},
    showMainWindow: () => { mainShown += 1; },
    exitApp: () => { quitCalls += 1; },
    toggleWidget: () => {},
    applyHotkeys: () => { hotkeyRegs += 1; return { hotkey: hotkeyOk, newTodoHotkey: hotkeyOk }; },
    openDetail: (id) => { opened.push(id); },
    beginWidgetDrag: (p) => winOps.push(['begin-drag', p]),
    dragWidget: (p) => winOps.push(['drag', p]),
    endWidgetDrag: () => winOps.push(['end-drag']),
  };
  registerIpc({
    handle: (ch, fn) => { handlers[ch] = fn; },
    on: (ch, fn) => { handlers[ch] = fn; },
  }, services);
  const call = (ch, arg) => handlers[ch]({ sender: {} }, arg);
  return { handlers, call, state, sent, opened, winOps, quitCalls: () => quitCalls, mainShown: () => mainShown,
    hotkeyRegs: () => hotkeyRegs, setHotkeyOk: (v) => { hotkeyOk = v; } };
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

test('app:quit 转发给退出服务', async () => {
  const h = harness();
  const r = await h.call('app:quit');
  assert.equal(r.ok, true);
  assert.equal(h.quitCalls(), 1);
});

test('app:show-main 转发给主窗口服务', async () => {
  const h = harness();
  const r = await h.call('app:show-main');
  assert.equal(r.ok, true);
  assert.equal(h.mainShown(), 1);
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

test('todos:complete 设 endTime 且幂等', async () => {
  const h = harness();
  const t = (await h.call('todos:create', { title: 'a', categoryId: null })).value;
  const c1 = await h.call('todos:complete', t.id);
  const c2 = await h.call('todos:complete', t.id);
  assert.equal(c2.value.endTime, c1.value.endTime);
});

test('todos:complete 自动算耗时、uncomplete 清空、update 改完成时间默认重算', async () => {
  const h = harness();
  const t = (await h.call('todos:create', { title: 'a', categoryId: null })).value;
  const c1 = await h.call('todos:complete', t.id);
  assert.equal(c1.value.durationHours, 0, '创建后立刻完成 → 0h');
  await h.call('todos:uncomplete', t.id);
  assert.equal(h.state.todos[0].durationHours, null, '取消完成清空耗时');
  const end = new Date(Date.parse(t.startTime) + 3.3 * 3600e3).toISOString();
  const u1 = await h.call('todos:update', { id: t.id, patch: { endTime: end } });
  assert.equal(u1.value.durationHours, 3.5, '3.3h → 3.5（未显式给耗时 → 重算）');
  const end2 = new Date(Date.parse(t.startTime) + 5 * 3600e3).toISOString();
  const u2 = await h.call('todos:update', { id: t.id, patch: { endTime: end2, durationHours: 2 } });
  assert.equal(u2.value.durationHours, 2, '显式人工耗时优先');
  const bad = await h.call('todos:update', { id: t.id, patch: { durationHours: 1.2 } });
  assert.equal(bad.ok, false, '非 0.5 步进被校验拒绝');
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

test('settings:set 改任一快捷键都整体重注；注册失败广播 hotkey-failed', async () => {
  const h = harness();
  await h.call('settings:set', { newTodoHotkey: 'Control+Shift+M' });
  assert.equal(h.state.settings.newTodoHotkey, 'Control+Shift+M', '新值已写入');
  assert.equal(h.hotkeyRegs(), 1, '改新建快捷键（非桌面贴快捷键）也触发重注');
  assert.ok(!h.sent.includes('hotkey-failed'), '注册成功不广播失败');

  h.setHotkeyOk(false);
  await h.call('settings:set', { hotkey: 'Control+Alt+X' });
  assert.equal(h.hotkeyRegs(), 2, '改桌面贴快捷键同样重注');
  assert.ok(h.sent.includes('hotkey-failed'), '注册失败广播 hotkey-failed');

  await h.call('settings:set', { widgetOpacity: 0.7 });
  assert.equal(h.hotkeyRegs(), 2, '非快捷键设置不触发重注');
});
