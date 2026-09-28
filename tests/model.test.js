const test = require('node:test');
const assert = require('node:assert');
const m = require('../src/shared/model');

test('createTodo 默认值：startTime=创建时刻、sortOrder=最大+1', () => {
  const now = '2026-09-25T02:00:00.000Z';
  const t1 = m.createTodo({ title: 'a', categoryId: null }, [], now);
  assert.equal(t1.startTime, now);
  assert.equal(t1.endTime, null);
  assert.equal(t1.sortOrder, 0);
  const t2 = m.createTodo({ title: 'b', categoryId: null }, [{ ...t1, sortOrder: 7 }], now);
  assert.equal(t2.sortOrder, 8);
});

test('applyTodoUpdate：带 endTime 的 patch 置 endTimeManuallySet', () => {
  const t = m.createTodo({ title: 'a' }, [], '2026-09-25T02:00:00.000Z');
  const done = m.applyTodoUpdate(t, { endTime: '2026-09-25T05:00:00.000Z' }, '2026-09-25T05:00:00.000Z');
  assert.equal(done.endTimeManuallySet, true);
  const undone = m.applyTodoUpdate(done, { endTime: null }, '2026-09-25T06:00:00.000Z');
  assert.equal(undone.endTimeManuallySet, false);
});

test('isSameDay 按本地自然日（跨 UTC 午夜）', () => {
  // 本地 2026-09-25 23:30 与 2026-09-26 00:30（构造本地时间再转 ISO）
  const late = new Date(2026, 8, 25, 23, 30).toISOString();
  const early = new Date(2026, 8, 26, 0, 30).toISOString();
  const ref = new Date(2026, 8, 25, 12, 0);
  assert.equal(m.isSameDay(late, ref), true);
  assert.equal(m.isSameDay(early, ref), false);
});

test('visibleTodos：分类过滤、未分类开关、当天完成倒序', () => {
  const now = new Date(2026, 8, 25, 12, 0);
  const cat = m.createCategory({ name: '工作', color: '#2FA98C', sortOrder: 0 }, now.toISOString());
  const t1 = m.createTodo({ title: 'a', categoryId: cat.id }, [], now.toISOString());
  const t2 = m.createTodo({ title: 'b', categoryId: null }, [t1], now.toISOString());
  const t3 = m.createTodo({ title: 'c', categoryId: cat.id }, [t1, t2], now.toISOString());
  const done1 = m.applyTodoUpdate(t1, { endTime: new Date(2026, 8, 25, 10, 0).toISOString() }, now.toISOString());
  const yesterday = new Date(2026, 8, 24, 10, 0).toISOString();
  const done2 = m.applyTodoUpdate(t3, { endTime: yesterday }, now.toISOString());
  const settings = { ...m.DEFAULT_SETTINGS };
  const view = m.visibleTodos([done1, done2, t2], [cat], settings, now);
  assert.equal(view.completedToday.length, 1);            // 只有今天的 done1
  assert.equal(view.groups.length, 2);                    // 未分类 + 工作
  const s2 = { ...settings, widgetShowUncategorized: false };
  assert.equal(m.visibleTodos([done1, done2, t2], [cat], s2, now).groups.every(g => g.category !== null), true);
});

test('isOverdue：有截止、未完成、已过点', () => {
  const now = new Date(2026, 8, 25, 12, 0);
  const t = m.createTodo({ title: 'a' }, [], now.toISOString());
  assert.equal(m.isOverdue({ ...t, dueTime: new Date(2026, 8, 25, 9, 0).toISOString() }, now), true);
  assert.equal(m.isOverdue({ ...t, dueTime: null }, now), false);
});

test('renumber 与 filterTodos', () => {
  assert.deepEqual(m.renumber(['x', 'y', 'z']), [
    { id: 'x', sortOrder: 0 }, { id: 'y', sortOrder: 1 }, { id: 'z', sortOrder: 2 }]);
  const cat = m.createCategory({ name: 'w', color: '#2FA98C', sortOrder: 0 }, '2026-09-25T00:00:00Z');
  const a = m.createTodo({ title: 'a', categoryId: cat.id }, [], '2026-09-25T00:00:00Z');
  const b = m.applyTodoUpdate(a, { endTime: '2026-09-26T00:00:00Z' }, '2026-09-26T00:00:00Z');
  assert.equal(m.filterTodos([a, b], { status: 'completed' }).length, 1);
  assert.equal(m.filterTodos([a, b], { status: 'overdue', }).length, 0);
  assert.equal(m.filterTodos([a], { status: 'all', dateField: 'startTime', dateFrom: '2026-09-26' }).length, 0);
});

test('validateCategoryInput：color 必须在色板内', () => {
  assert.equal(m.validateCategoryInput({ name: 'x', color: '#FF0000' }).valid, false);
  assert.equal(m.validateCategoryInput({ name: 'x', color: '#2FA98C' }).valid, true);
  assert.equal(m.validateCategoryInput({ name: '', color: '#2FA98C' }).valid, false);
});

test('validateSettingsPatch：白名单/类型/范围/快捷键须带修饰键', () => {
  assert.equal(m.validateSettingsPatch({ widgetOpacity: 0.6 }).valid, true);
  assert.equal(m.validateSettingsPatch({ widgetOpacity: 0.15 }).valid, true, '透明度下限 0.15 放行');
  assert.equal(m.validateSettingsPatch({ widgetOpacity: 0.1 }).valid, false, '透明度低于 0.15 拒绝');
  assert.equal(m.validateSettingsPatch({ widgetOpacity: 5 }).valid, false, '透明度超范围拒绝');
  assert.equal(m.validateSettingsPatch({ widgetOpacity: 'x' }).valid, false, '透明度非数字拒绝');
  assert.equal(m.validateSettingsPatch({ hacker: 1 }).valid, false, '未知键拒绝');
  assert.equal(m.validateSettingsPatch({ hotkey: 'T' }).valid, false, '裸键快捷键拒绝');
  assert.equal(m.validateSettingsPatch({ hotkey: 'Control+Alt+T' }).valid, true);
  assert.equal(m.validateSettingsPatch({ widgetVisibleCategoryIds: ['a', 'b'] }).valid, true);
  assert.equal(m.validateSettingsPatch({ widgetVisibleCategoryIds: 'a' }).valid, false);
  assert.equal(m.validateSettingsPatch({ widgetPosition: { x: 1, y: 2 } }).valid, true);
  assert.equal(m.validateSettingsPatch({ widgetPosition: { x: 1 } }).valid, false);
  assert.equal(m.validateSettingsPatch({ widgetSize: null }).valid, true);
  assert.equal(m.validateSettingsPatch({ autoLaunch: true, showCompletedInWidget: false, widgetGroupByCategory: true, widgetShowUncategorized: false }).valid, true);
  assert.equal(m.validateSettingsPatch({ autoLaunch: 'yes' }).valid, false);
});

test('showCompletedInWidget=false 时桌面贴视图不含当天完成', () => {
  const now = new Date(2026, 8, 25, 12, 0);
  const cat = m.createCategory({ name: '工作', color: '#2FA98C', sortOrder: 0 }, now.toISOString());
  const t = m.createTodo({ title: 'a', categoryId: cat.id }, [], now.toISOString());
  const done = m.applyTodoUpdate(t, { endTime: new Date(2026, 8, 25, 10, 0).toISOString() }, now.toISOString());
  const sOff = { ...m.DEFAULT_SETTINGS, showCompletedInWidget: false };
  assert.equal(m.visibleTodos([done], [cat], sOff, now).completedToday.length, 0);
  assert.equal(m.visibleTodos([done], [cat], m.DEFAULT_SETTINGS, now).completedToday.length, 1);
});
