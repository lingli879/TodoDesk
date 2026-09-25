// 桌面贴渲染入口：订阅 data-changed / settings-changed，全量重绘。
import { fmtTime } from '../common/format.js';

const panel = document.getElementById('panel');
const listEl = document.getElementById('list');
const doneSec = document.getElementById('done');
const doneList = document.getElementById('doneList');
const doneCount = document.getElementById('doneCount');
const countEl = document.getElementById('count');

let view = { groups: [], completedToday: [], activeCount: 0 };

export async function refresh() {
  view = await window.todoDesk.view.widget();
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

window.todoDesk.onDataChange(() => { refresh(); });
window.todoDesk.onSettingsChange(() => { applyOpacity(); refresh(); });

refresh();
applyOpacity();
