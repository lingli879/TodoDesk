'use strict';
// IPC 通道注册：全部数据操作的受控入口。ipcMain 可注入（测试用 fake）。
const {
  CATEGORY_PALETTE, createCategory, createTodo, renumber,
  visibleTodos, filterTodos, validateNewTodo, validateTodoPatch,
  validateCategoryInput, validateSettingsPatch, applyTodoUpdate, computeDurationHours,
} = require('../shared/model');

function registerIpc(ipcMain, services) {
  const on = (ch, fn) => ipcMain.handle(ch, async (event, arg) => {
    try {
      return { ok: true, value: await fn(arg, event) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  });
  const now = () => new Date().toISOString();
  const changed = () => services.broadcast('data-changed');
  const findTodo = (s, id) => {
    const t = s.todos.find((x) => x.id === id);
    if (!t) throw new Error('待办不存在');
    return t;
  };

  // ---- 分类 ----
  on('categories:list', () => services.getState().categories);

  on('categories:create', (input) => {
    const v = validateCategoryInput(input);
    if (!v.valid) throw new Error(v.errors.join('；'));
    const cat = services.mutate((s) => {
      const c = createCategory(input, now());
      s.categories.push(c);
      return c;
    });
    changed();
    return cat;
  });

  on('categories:update', ({ id, patch }) => {
    const errs = [];
    if ('name' in patch && (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 50)) errs.push('名称不能为空且 ≤50 字符');
    if ('color' in patch && !CATEGORY_PALETTE.includes(patch.color)) errs.push('颜色必须在预设色板内');
    if ('sortOrder' in patch && !Number.isInteger(patch.sortOrder)) errs.push('排序无效');
    if (errs.length) throw new Error(errs.join('；'));
    const out = services.mutate((s) => {
      const i = s.categories.findIndex((c) => c.id === id);
      if (i < 0) throw new Error('分类不存在');
      s.categories[i] = { ...s.categories[i], ...patch };
      return s.categories[i];
    });
    changed();
    return out;
  });

  on('categories:remove', (id) => {
    services.mutate((s) => {
      s.categories = s.categories.filter((c) => c.id !== id);
      for (const t of s.todos) if (t.categoryId === id) t.categoryId = null;
    });
    changed();
  });

  // ---- 待办 ----
  on('todos:list', () => services.getState().todos);

  on('todos:create', (input) => {
    const v = validateNewTodo(input);
    if (!v.valid) throw new Error(v.errors.join('；'));
    const todo = services.mutate((s) => {
      const t = createTodo(input, s.todos, now());
      s.todos.push(t);
      return t;
    });
    changed();
    return todo;
  });

  on('todos:update', ({ id, patch }) => {
    const v = validateTodoPatch(patch);
    if (!v.valid) throw new Error(v.errors.join('；'));
    const out = services.mutate((s) => {
      const t = findTodo(s, id);
      const i = s.todos.indexOf(t);
      s.todos[i] = applyTodoUpdate(t, patch, now());
      return s.todos[i];
    });
    changed();
    return out;
  });

  on('todos:complete', (id) => {
    const out = services.mutate((s) => {
      const t = findTodo(s, id);
      if (t.endTime == null) {
        t.endTime = now();
        t.updatedAt = t.endTime;
        t.durationHours = computeDurationHours(t.startTime, t.endTime);
      }
      return t;
    });
    changed();
    return out;
  });

  on('todos:uncomplete', (id) => {
    const out = services.mutate((s) => {
      const t = findTodo(s, id);
      t.endTime = null;
      t.durationHours = null;
      t.endTimeManuallySet = false;
      t.updatedAt = now();
      return t;
    });
    changed();
    return out;
  });

  on('todos:remove', (id) => {
    services.mutate((s) => {
      s.todos = s.todos.filter((t) => t.id !== id);
    });
    changed();
  });

  on('todos:reorder', (orderedIds) => {
    if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string')) {
      throw new Error('参数无效');
    }
    const order = new Map(renumber(orderedIds).map((r) => [r.id, r.sortOrder]));
    services.mutate((s) => {
      for (const t of s.todos) if (order.has(t.id)) t.sortOrder = order.get(t.id);
    });
    changed();
  });

  on('todos:query', (filter) => filterTodos(services.getState().todos, filter || {}));

  on('widget:view', () => {
    const s = services.getState();
    return visibleTodos(s.todos, s.categories, s.settings, new Date());
  });

  // ---- 设置（带副作用）----
  on('settings:get', () => services.getState().settings);

  on('settings:set', (patch) => {
    const v = validateSettingsPatch(patch);
    if (!v.valid) throw new Error(v.errors.join('；'));
    const prev = services.getState().settings;
    const next = { ...prev, ...patch };
    services.mutate((s) => { s.settings = next; });
    if ('hotkey' in patch || 'newTodoHotkey' in patch) {
      const reg = services.applyHotkeys(next);
      if (!reg.hotkey || !reg.newTodoHotkey) services.broadcast('hotkey-failed');
    }
    if ('autoLaunch' in patch) services.setAutoLaunch?.(next.autoLaunch);
    services.broadcast('settings-changed');
    return next;
  });

  // ---- 其他 ----
  on('meta:palette', () => CATEGORY_PALETTE);
  on('widget:show', () => services.showWidget());
  on('widget:hide', () => services.hideWidget());
  on('widget:toggle', () => services.toggleWidget());
  on('detail:open', (id) => services.openDetail(id));
  on('openDataFolder', () => services.openDataFolder());
  on('app:quit', () => services.exitApp());
  on('app:show-main', () => services.showMainWindow());

  // ---- 桌面贴窗口拖动/缩放（附着桌面层后系统循环失效，应用层单向高频通道）----
  const recv = (ch, fn) => ipcMain.on(ch, (_event, arg) => {
    try { fn(arg); } catch { /* 高频通道静默，断点续传由下一次事件承担 */ }
  });
  recv('widget:begin-drag', (p) => services.beginWidgetDrag(p));
  recv('widget:drag-move', (p) => services.dragWidget(p));
  recv('widget:end-drag', () => services.endWidgetDrag());
}

module.exports = { registerIpc };
