// 桌面贴：渲染 + 统一内联交互（点空白新建 / 点标题改名 / 悬停图标完成删除详情）。
import { fmtTime } from '../common/format.js';

const panel = document.getElementById('panel');
const listEl = document.getElementById('list');
const doneSec = document.getElementById('done');
const doneList = document.getElementById('doneList');
const doneCount = document.getElementById('doneCount');
const countEl = document.getElementById('count');
const confirmEl = document.getElementById('confirmBox');
// 右键菜单与内嵌详情层已移除：详情为独立窗口，操作走行内悬停图标

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
    // 不渲染分组标题：所有任务按「分类顺序→任务序号」平铺展示（.group 结构保留，供空白新建定位分类）
    const sec = document.createElement('section');
    sec.className = 'group';
    sec.dataset.key = g.key;
    sec.dataset.categoryId = g.category ? g.category.id : '';
    const ul = document.createElement('ul');
    ul.className = 'rows';
    for (const t of g.todos) ul.append(renderTodo(t));
    sec.append(ul);
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

  // 行首项目符号：白色圆点，兼任拖拽排序手柄
  const bullet = document.createElement('span');
  bullet.className = 'bullet';
  bullet.title = '拖动排序';

  li.append(bullet);

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

  // 悬停操作图标：完成（绿）/ 删除（红）/ 详情（白）
  const acts = document.createElement('span');
  acts.className = 'acts';
  const act = (cls, label, text) => {
    const b = document.createElement('button');
    b.className = cls;
    b.title = label;
    b.textContent = text;
    acts.append(b);
  };
  act('act-done', '完成', '✔');
  act('act-del', '删除', '✖');
  act('act-detail', '详情', 'ⓘ');
  li.append(acts);
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
  const ul = li.parentElement; // 需在 remove 前取，否则为 null
  const ref = li.nextSibling; // 编辑行插在原行位置，取消/提交后列表不跳动
  li.remove();
  openEditingRow(ul, 'edit', todo, todo.categoryId, ref);
}

function openEditingRow(ul, mode, todo, categoryId, refLi = null) {
  cancelEditing();
  const li = document.createElement('li');
  li.className = 'editing';
  // 与任务行同构的占位（白点），输入文字与任务标题对齐，减少错落
  li.append(Object.assign(document.createElement('span'), { className: 'bullet' }));
  const input = document.createElement('input');
  input.placeholder = mode === 'create' ? '要做的事…（回车连续添加）' : '';
  if (mode === 'edit') input.value = todo.title; // 预填原内容，支持在其上继续修改
  li.append(input);
  ul.insertBefore(li, refLi);
  editing = { mode, id: todo ? todo.id : null, categoryId, input, original: todo ? todo.title : '' };
  input.focus();
  if (mode === 'edit') input.setSelectionRange(input.value.length, input.value.length); // 光标置于末尾
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEditing(mode === 'create' ? 'chain' : 'close'); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); render(); }
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
    } else {
      render(); // 空值/未改动 → 未保存，恢复被编辑行顶掉的原行
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

// ---------- 拖拽排序（组内，行首白点即手柄；点标题仍是编辑，两种手势互不干扰） ----------
let drag = null; // { id, li, ul, startY, started }

listEl.addEventListener('pointerdown', (e) => {
  if (!e.target.classList.contains('bullet')) return;
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

// ---------- 详情：独立窗口（不受桌面贴尺寸限制，主进程弹出） ----------
export function openDetail(todoId) {
  window.todoDesk.detail.open(todoId);
}

// ---------- 事件接线 ----------
listEl.addEventListener('click', (e) => {
  const todoLi = e.target.closest('.todo');
  if (todoLi) {
    const id = todoLi.dataset.id;
    if (e.target.classList.contains('act-done')) { completeTodo(id); return; }
    if (e.target.classList.contains('act-del')) {
      (async () => {
        if (await confirmBox('删除这条待办？')) await window.todoDesk.todos.remove(id);
      })();
      return;
    }
    if (e.target.classList.contains('act-detail')) { openDetail(id); return; }
    if (e.target.classList.contains('title')) { beginEdit(id); return; }
    return; // 白点由拖拽模块接线
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

// 右键菜单已移除：仅阻止系统默认菜单，避免透明窗口上弹出浏览器菜单
panel.addEventListener('contextmenu', (e) => e.preventDefault());

window.todoDesk.onDataChange(() => { refresh(); });
window.todoDesk.onSettingsChange(() => { applyOpacity(); refresh(); });

// ---- 窗口拖动/缩放（附着桌面层后系统的 HTCAPTION/HTBORDER 循环失效，走 IPC 应用层实现）----
// 按下时上报屏幕坐标，主进程记录窗口基准并按增量 setPosition/setSize。
function windowDrag(el) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    window.todoDesk.widget.beginDrag({ screenX: e.screenX, screenY: e.screenY });
    const move = (ev) => window.todoDesk.widget.dragMove({ screenX: ev.screenX, screenY: ev.screenY });
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      window.todoDesk.widget.endDrag();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}
windowDrag(document.getElementById('dragHandle'));
const doneSummary = document.querySelector('#done summary');
if (doneSummary) windowDrag(doneSummary);

document.getElementById('resizeHandle').addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  window.todoDesk.widget.beginResize({ screenX: e.screenX, screenY: e.screenY });
  const move = (ev) => window.todoDesk.widget.resizeMove({ screenX: ev.screenX, screenY: ev.screenY });
  const up = () => {
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
    window.todoDesk.widget.endResize();
  };
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
});

refresh();
applyOpacity();
