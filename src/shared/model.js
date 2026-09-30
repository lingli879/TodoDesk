'use strict';
// 数据模型纯函数：默认值、完成语义、过滤排序、校验。无任何 IO 依赖。
const crypto = require('node:crypto');

const CATEGORY_PALETTE = [
  '#2FA98C', '#4A90D9', '#8B7EC8', '#E5A84B', '#E58BB0', '#3FB8C9', '#7FA653', '#7A8B87',
];

const DEFAULT_SETTINGS = {
  hotkey: 'Control+Alt+T',
  widgetOpacity: 0.55,
  widgetPosition: null,
  widgetSize: null,
  showCompletedInWidget: true,
  widgetGroupByCategory: true,
  widgetVisibleCategoryIds: [],
  widgetShowUncategorized: true,
  autoLaunch: false,
};

const id = () => crypto.randomUUID();

function createCategory({ name, color, sortOrder }, now) {
  return { id: id(), name, color, sortOrder: sortOrder ?? 0, createdAt: now };
}

function nextSortOrder(todos) {
  return todos.reduce((max, t) => Math.max(max, t.sortOrder ?? 0), -1) + 1;
}

function createTodo({ title, categoryId }, todos, now) {
  return {
    id: id(),
    title,
    notes: '',
    categoryId: categoryId ?? null,
    startTime: now,
    endTime: null,
    dueTime: null,
    createdAt: now,
    updatedAt: now,
    endTimeManuallySet: false,
    sortOrder: nextSortOrder(todos),
  };
}

function renumber(orderedIds) {
  return orderedIds.map((tid, i) => ({ id: tid, sortOrder: i }));
}

function isCompleted(todo) {
  return todo.endTime != null;
}

function isOverdue(todo, now) {
  if (todo.dueTime == null || isCompleted(todo)) return false;
  return new Date(todo.dueTime).getTime() < new Date(now).getTime();
}

function isSameDay(iso, now) {
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

// 桌面贴视图：应用分类可见性/未分类开关/分组；组内 sortOrder 升序；当天完成倒序。
function visibleTodos(todos, categories, settings, now) {
  const visibleCatIds = new Set(
    Array.isArray(settings.widgetVisibleCategoryIds) && settings.widgetVisibleCategoryIds.length
      ? settings.widgetVisibleCategoryIds
      : categories.map((c) => c.id));
  const active = todos
    .filter((t) => !isCompleted(t))
    .filter((t) => (t.categoryId == null
      ? settings.widgetShowUncategorized !== false
      : visibleCatIds.has(t.categoryId)));
  const bySort = (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  const groups = [];
  if (settings.widgetGroupByCategory === false) {
    groups.push({ key: '__all__', category: null, todos: active.slice().sort(bySort) });
  } else {
    for (const cat of categories.slice().sort((a, b) => a.sortOrder - b.sortOrder)) {
      if (!visibleCatIds.has(cat.id)) continue;
      groups.push({ key: cat.id, category: cat, todos: active.filter((t) => t.categoryId === cat.id).sort(bySort) });
    }
    if (settings.widgetShowUncategorized !== false && active.some((t) => t.categoryId == null)) {
      groups.push({ key: '__none__', category: null, todos: active.filter((t) => t.categoryId == null).sort(bySort) });
    }
  }
  const completedToday = settings.showCompletedInWidget === false ? [] : todos
    .filter((t) => isCompleted(t) && isSameDay(t.endTime, now))
    .sort((a, b) => new Date(b.endTime) - new Date(a.endTime));
  return { groups, completedToday, activeCount: active.length };
}

// 主程序列表筛选：状态/分类/日期范围（dateField 为 startTime|endTime；日期为本地自然日，dateTo 含全天）。
function filterTodos(todos, { status = 'all', categoryId = 'all', dateField = 'startTime', dateFrom = null, dateTo = null } = {}, now = new Date()) {
  let out = todos.slice();
  if (status === 'active') out = out.filter((t) => !isCompleted(t));
  else if (status === 'completed') out = out.filter((t) => isCompleted(t));
  else if (status === 'overdue') out = out.filter((t) => isOverdue(t, now));
  if (categoryId !== 'all') {
    const target = categoryId === '__none__' ? null : categoryId;
    out = out.filter((t) => (t.categoryId ?? null) === target);
  }
  if (dateFrom) {
    const from = new Date(`${dateFrom}T00:00:00`);
    out = out.filter((t) => new Date(t[dateField]) >= from);
  }
  if (dateTo) {
    const to = new Date(`${dateTo}T23:59:59.999`);
    out = out.filter((t) => new Date(t[dateField]) <= to);
  }
  return out.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

function validIso(v) {
  return typeof v === 'string' && !Number.isNaN(new Date(v).getTime());
}

function validateNewTodo(input) {
  const errors = [];
  if (typeof input?.title !== 'string' || !input.title.trim()) errors.push('标题不能为空');
  else if (input.title.length > 200) errors.push('标题过长（≤200 字符）');
  if (input?.categoryId != null && typeof input.categoryId !== 'string') errors.push('分类无效');
  return { valid: errors.length === 0, errors };
}

function validateTodoPatch(patch) {
  const errors = [];
  const allowed = ['title', 'notes', 'categoryId', 'startTime', 'endTime', 'dueTime', 'endTimeManuallySet'];
  for (const k of Object.keys(patch || {})) {
    if (!allowed.includes(k)) errors.push(`未知字段 ${k}`);
  }
  if ('title' in patch && (typeof patch.title !== 'string' || !patch.title.trim() || patch.title.length > 200)) {
    errors.push('标题不能为空且 ≤200 字符');
  }
  if ('notes' in patch && typeof patch.notes !== 'string') errors.push('备注无效');
  if ('categoryId' in patch && patch.categoryId != null && typeof patch.categoryId !== 'string') errors.push('分类无效');
  for (const f of ['startTime', 'endTime', 'dueTime']) {
    if (f in patch && patch[f] !== null && !validIso(patch[f])) errors.push(`${f} 时间无效`);
  }
  return { valid: errors.length === 0, errors };
}

function validateCategoryInput(input) {
  const errors = [];
  if (typeof input?.name !== 'string' || !input.name.trim() || input.name.length > 50) errors.push('名称不能为空且 ≤50 字符');
  if (!CATEGORY_PALETTE.includes(input?.color)) errors.push('颜色必须在预设色板内');
  return { valid: errors.length === 0, errors };
}

// 合并 patch；凡通过编辑器改动 endTime 的保存动作置 endTimeManuallySet=true，清空 endTime 则清除标记。
// 设置 patch 校验：白名单 + 类型/范围；快捷键必须是「修饰键+键」组合（防裸键劫持）。
const HOTKEY_RE = /^(Control|Ctrl|CommandOrControl|Alt|Shift|Super|Meta)(\+(Control|Ctrl|Alt|Shift|Super|Meta|[A-Z0-9]))+$/;

function validateSettingsPatch(patch) {
  const errors = [];
  const rules = {
    hotkey: (v) => typeof v === 'string' && HOTKEY_RE.test(v),
    widgetOpacity: (v) => typeof v === 'number' && v >= 0.15 && v <= 1,
    widgetPosition: (v) => v === null || (isRect(v) && 'x' in v && 'y' in v),
    widgetSize: (v) => v === null || (isRect(v) && 'width' in v && 'height' in v),
    showCompletedInWidget: isBool,
    widgetGroupByCategory: isBool,
    widgetVisibleCategoryIds: (v) => Array.isArray(v) && v.every((x) => typeof x === 'string'),
    widgetShowUncategorized: isBool,
    autoLaunch: isBool,
  };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in rules)) { errors.push(`未知设置项 ${k}`); continue; }
    if (!rules[k](v)) errors.push(`设置项 ${k} 的值无效`);
  }
  return { valid: errors.length === 0, errors };
}

function isBool(v) { return typeof v === 'boolean'; }
function isRect(v) {
  return v && typeof v === 'object' && Object.values(v).every((x) => typeof x === 'number');
}

function applyTodoUpdate(todo, patch, now) {
  const next = { ...todo, ...patch, updatedAt: now };
  if ('endTime' in patch) {
    next.endTimeManuallySet = patch.endTime != null;
  }
  return next;
}

function seedState(now) {
  return {
    categories: [{ id: id(), name: '默认', color: '#2FA98C', sortOrder: 0, createdAt: now }],
    todos: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

module.exports = {
  CATEGORY_PALETTE,
  DEFAULT_SETTINGS,
  id,
  createCategory,
  createTodo,
  nextSortOrder,
  renumber,
  isCompleted,
  isOverdue,
  isSameDay,
  visibleTodos,
  filterTodos,
  validateNewTodo,
  validateTodoPatch,
  validateCategoryInput,
  validateSettingsPatch,
  applyTodoUpdate,
  seedState,
};
