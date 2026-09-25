// 桌面贴：渲染 + 统一内联交互（点空白新建 / 点标题改名 / 点勾完成）+ 详情面板。
import { fmtTime } from '../common/format.js';
import { createTodoForm, diffTodoPatch } from '../common/todo-form.js';

const panel = document.getElementById('panel');
const listEl = document.getElementById('list');
const doneSec = document.getElementById('done');
const doneList = document.getElementById('doneList');
const doneCount = document.getElementById('doneCount');
const countEl = document.getElementById('count');
const ctxMenu = document.getElementById('ctxMenu');
const confirmEl = document.getElementById('confirmBox');
const detailLayer = document.getElementById('detailLayer');

let view = { groups: [], completedToday: [], activeCount: 0 };
let catsCache = [];          // 按 sortOrder 升序
let editing = null;          // { mode:'create'|'edit', id?, categoryId, input }
let pendingChain = null;     // 连续录入：{ categoryId }
let celebratingId = null;    // 庆祝动效期间延迟重绘

// ---------- 渲染 ----------
export async function refresh() {
  [view, catsCache] = await Promise.all([
    window.todoDesk.view.widget(),
    window.todoDesk.categories.list(),
  ]);
  catsCache.sort((a, b) => a.sortOrder - b.sortOrder);
  if (celebratingId) return; // 动效播完由定时器触发重绘
  render();
}

async function applyOpacity() {
  const s = await window.todoDesk.settings.get();
  panel.style.setProperty('--panel-alpha', s.widgetOpacity);
}

function render() {
  listEl.replaceChildren();
  if (!view.activeCount && !view.completedToday.length) {
    const e = document.createElement('div');
    e.id = 'empty';
    e.textContent = '点击空白处，输入要做的事';
    listEl.append(e);
  }
  for (const g of view.groups) {
    if (!g.todos.length) continue;
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.dataset.key = g.key;
    sec.dataset.categoryId = g.category ? g.category.id : '';
    const head = document.createElement('div');
    head.className = 'group-head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = g.category ? g.category.color : 'var(--ink-soft)';
    const name = document.createElement('span');
    name.textContent = g.category ? g.category.name : '未分类';
    head.append(dot, name);
    const ul = document.createElement('ul');
    ul.className = 'rows';
    for (const t of g.todos) ul.append(renderTodo(t));
    sec.append(head, ul);
    listEl.append(sec);
  }

  const show = view.completedToday.length > 0;
  doneSec.hidden = !show;
  doneList.replaceChildren(...view.completedToday.map(renderDoneTodo));
  doneCount.textContent = show ? `(${view.completedToday.length})` : '';
  countEl.textContent = view.activeCount ? `${view.activeCount} 项进行中` : '';

  if (pendingChain) {
    const { categoryId } = pendingChain;
    pendingChain = null;
    beginCreate(categoryId);
  }
}

function isOverdueActive(t) {
  return t.dueTime != null && new Date(t.dueTime).getTime() < Date.now();
}

function renderTodo(t) {
  const li = document.createElement('li');
  li.className = 'todo';
  li.dataset.id = t.id;

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.textContent = '⠿';
  grip.title = '拖动排序';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.title = '完成';

  li.append(grip, cb);

  if (isOverdueActive(t)) {
    const d = document.createElement('span');
    d.className = 'dot overdue';
    d.title = '已逾期';
    li.append(d);
  }

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = t.title;
  li.append(title);

  const more = document.createElement('button');
  more.className = 'more';
  more.textContent = '⋯';
  more.title = '详情';
  li.append(more);
  return li;
}

function renderDoneTodo(t) {
  const li = document.createElement('li');
  li.className = 'todo done';
  li.dataset.id = t.id;
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = true;
  cb.title = '取消完成';
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = t.title;
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(t.endTime);
  li.append(cb, title, time);
  return li;
}

// ---------- 内联编辑（新建与改名是同一种操作） ----------
function findGroupUl(categoryId) {
  const key = categoryId == null ? '__none__' : categoryId;
  let ul = listEl.querySelector(`.group[data-key="${CSS.escape(key)}"] ul.rows`)
    || listEl.querySelector('.group ul.rows');
  if (!ul) {
    // 空态（没有任何分组渲染）：临时挂一个 ul 承载编辑行，提交后正常重绘出分组
    const sec = document.createElement('section');
    sec.className = 'group';
    ul = document.createElement('ul');
    ul.className = 'rows';
    sec.append(ul);
    listEl.querySelector('#empty')?.remove();
    listEl.append(sec);
  }
  return ul;
}

export function beginCreate(categoryId) {
  const ul = findGroupUl(categoryId);
  if (!ul) return;
  openEditingRow(ul, 'create', null, categoryId);
}

export function beginEdit(todoId) {
  const li = listEl.querySelector(`.todo[data-id="${CSS.escape(todoId)}"]`);
  if (!li) return;
  const todo = view.groups.flatMap((g) => g.todos).find((t) => t.id === todoId);
  if (!todo) return;
  openEditingRow(li.parentElement, 'edit', todo, todo.categoryId);
  li.remove();
}

function openEditingRow(ul, mode, todo, categoryId) {
  cancelEditing();
  const li = document.createElement('li');
  li.className = 'editing';
  const input = document.createElement('input');
  input.placeholder = mode === 'create' ? '要做的事…（回车连续添加）' : todo.title;
  li.append(input);
  ul.append(li);
  editing = { mode, id: todo ? todo.id : null, categoryId, input, original: todo ? todo.title : '' };
  input.focus();
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEditing(mode === 'create' ? 'chain' : 'close'); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  });
  input.addEventListener('blur', () => { if (editing && editing.input === input) commitEditing('close'); });
}

export async function commitEditing(next) {
  if (!editing) return;
  const ed = editing;
  editing = null;
  const value = ed.input.value.trim();
  ed.input.closest('li.editing')?.remove();
  if (ed.mode === 'create') {
    if (value) {
      if (next === 'chain') pendingChain = { categoryId: ed.categoryId };
      await window.todoDesk.todos.create({ title: value, categoryId: ed.categoryId });
    }
  } else if (ed.id) {
    if (value && value !== ed.original) {
      await window.todoDesk.todos.update({ id: ed.id, patch: { title: value } });
    }
  }
}

export function cancelEditing() {
  if (!editing) return;
  editing.input.closest('li.editing')?.remove();
  editing = null;
}

// ---------- 完成 / 取消完成 ----------
async function completeTodo(id) {
  const li = listEl.querySelector(`.todo[data-id="${CSS.escape(id)}"]`);
  celebratingId = id;
  if (li) li.classList.add('celebrate');
  await window.todoDesk.todos.complete(id);
  setTimeout(() => {
    celebratingId = null;
    refresh();
  }, 450);
}

async function uncompleteTodo(id) {
  const done = view.completedToday.find((t) => t.id === id);
  if (done && done.endTimeManuallySet) {
    const ok = await confirmBox('完成时间是手动调整过的，取消完成后将清除，确定？');
    if (!ok) return;
  }
  await window.todoDesk.todos.uncomplete(id);
}

// ---------- 确认气泡 ----------
export function confirmBox(message) {
  return new Promise((resolve) => {
    confirmEl.replaceChildren();
    const p = document.createElement('p');
    p.textContent = message;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = '确定';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    bar.append(cancel, ok);
    confirmEl.append(p, bar);
    confirmEl.hidden = false;
    const close = (v) => { confirmEl.hidden = true; confirmEl.replaceChildren(); resolve(v); };
    ok.addEventListener('click', () => close(true));
    cancel.addEventListener('click', () => close(false));
    confirmEl.dataset.esc = '';
    const escHandler = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', escHandler); close(false); } };
    document.addEventListener('keydown', escHandler);
    ok.focus();
  });
}

// ---------- 右键菜单 ----------
export function openCtxMenu(todoId, x, y) {
  const todo = [...view.groups.flatMap((g) => g.todos), ...view.completedToday]
    .find((t) => t.id === todoId);
  if (!todo) return;
  const done = todo.endTime != null;
  ctxMenu.replaceChildren();
  const item = (label, fn, disabled = false) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (disabled) { b.disabled = true; b.title = 'Task 11 接入'; }
    else b.addEventListener('click', () => { closeCtxMenu(); fn(); });
    ctxMenu.append(b);
  };
  item(done ? '取消完成' : '完成', () => (done ? uncompleteTodo(todoId) : completeTodo(todoId)));
  if (!done) item('修改标题', () => beginEdit(todoId));
  item('打开详情', () => openDetail(todoId));
  item('删除', async () => {
    if (await confirmBox('删除这条待办？')) await window.todoDesk.todos.remove(todoId);
  });
  ctxMenu.hidden = false;
  const r = panel.getBoundingClientRect();
  ctxMenu.style.left = `${Math.min(Math.max(4, x - r.left), r.width - 130)}px`;
  ctxMenu.style.top = `${Math.min(Math.max(4, y - r.top), r.height - ctxMenu.offsetHeight - 4)}px`;
}

function closeCtxMenu() {
  ctxMenu.hidden = true;
  ctxMenu.replaceChildren();
}

// ---------- 拖拽排序（组内，⠿ 手柄；点标题仍是编辑，两种手势互不干扰） ----------
let drag = null; // { id, li, ul, startY, started }

listEl.addEventListener('pointerdown', (e) => {
  if (!e.target.classList.contains('grip')) return;
  const li = e.target.closest('.todo');
  if (!li) return;
  drag = { id: li.dataset.id, li, ul: li.parentElement, startY: e.clientY, started: false };
  e.target.setPointerCapture(e.pointerId);
  e.preventDefault();
});

listEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.started) {
    if (Math.abs(e.clientY - drag.startY) < 4) return; // 4px 阈值，避免误触
    drag.started = true;
    drag.li.classList.add('dragging');
  }
  const siblings = [...drag.ul.children]
    .filter((el) => el !== drag.li && el.classList.contains('todo'));
  const next = siblings.find((el) => {
    const r = el.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2;
  });
  if (next) drag.ul.insertBefore(drag.li, next);
  else drag.ul.append(drag.li);
});

listEl.addEventListener('pointerup', async () => {
  if (!drag) return;
  const { li, ul, started } = drag;
  drag = null;
  li.classList.remove('dragging');
  if (!started) return;
  const ids = [...ul.children]
    .filter((el) => el.classList.contains('todo') && !el.classList.contains('editing'))
    .map((el) => el.dataset.id);
  await window.todoDesk.todos.reorder(ids);
});

listEl.addEventListener('pointercancel', () => {
  if (!drag) return;
  drag.li.classList.remove('dragging');
  drag = null;
});

// ---------- 详情面板（右键菜单「打开详情」/ 条目「⋯」按钮；等宽覆盖、内部滚动） ----------
let detailOpen = false;

export async function openDetail(todoId) {
  const todos = await window.todoDesk.todos.list();
  const todo = todos.find((t) => t.id === todoId);
  if (!todo) return;
  const categories = await window.todoDesk.categories.list();
  const form = createTodoForm({ todo, categories });

  const closePanel = () => {
    detailLayer.hidden = true;
    detailLayer.replaceChildren();
    detailOpen = false;
  };

  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = '保存';
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = '删除';
  const close = document.createElement('button');
  close.textContent = '关闭';
  const bar = document.createElement('div');
  bar.className = 'form-bar';
  bar.append(del, close, save);

  const inner = document.createElement('div');
  inner.className = 'detail-inner';
  inner.append(form.el, bar);
  detailLayer.replaceChildren(inner);
  detailLayer.hidden = false;
  detailOpen = true;
  form.el.querySelector('input').focus();

  close.addEventListener('click', closePanel);
  del.addEventListener('click', async () => {
    if (await confirmBox('删除这条待办？')) {
      await window.todoDesk.todos.remove(todoId);
      closePanel();
    }
  });
  save.addEventListener('click', async () => {
    const values = form.getValues();
    if (!values) return;
    const patch = diffTodoPatch(todo, values);
    // 取消完成且完成时间曾被人工改过 → 先确认（spec §3 防误丢人工记录）
    if (todo.endTime != null && values.endTime == null && todo.endTimeManuallySet) {
      if (!(await confirmBox('完成时间是手动调整过的，取消完成后将清除，确定？'))) return;
    }
    if (!Object.keys(patch).length) { closePanel(); return; }
    try {
      await window.todoDesk.todos.update({ id: todoId, patch });
      closePanel();
    } catch (e) {
      form.showError(e.message);
    }
  });
}

// ---------- 事件接线 ----------
listEl.addEventListener('click', (e) => {
  const todoLi = e.target.closest('.todo');
  if (todoLi) {
    const id = todoLi.dataset.id;
    if (e.target.matches('input[type="checkbox"]')) {
      const done = todoLi.classList.contains('done');
      if (done) uncompleteTodo(id);
      else completeTodo(id);
      return;
    }
    if (e.target.classList.contains('title')) { beginEdit(id); return; }
    if (e.target.classList.contains('more')) { openDetail(id); return; }
    return; // grip 由拖拽模块接线
  }
  // 空白处：新建。分组内→该组分类；分组外→第一个分类。
  const group = e.target.closest('.group');
  if (group) beginCreate(group.dataset.categoryId || null);
  else beginCreate(catsCache.length ? catsCache[0].id : null);
});

doneList.addEventListener('click', (e) => {
  const todoLi = e.target.closest('.todo');
  if (todoLi && e.target.matches('input[type="checkbox"]')) uncompleteTodo(todoLi.dataset.id);
});

panel.addEventListener('contextmenu', (e) => {
  const todoLi = e.target.closest('.todo');
  if (todoLi) {
    e.preventDefault();
    openCtxMenu(todoLi.dataset.id, e.clientX, e.clientY);
  }
});

document.addEventListener('click', (e) => {
  if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) closeCtxMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !ctxMenu.hidden) closeCtxMenu();
});

window.todoDesk.onDataChange(() => { refresh(); });
window.todoDesk.onSettingsChange(() => { applyOpacity(); refresh(); });

refresh();
applyOpacity();
