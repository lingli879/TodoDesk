// 待办管理页：筛选（状态/分类/日期范围）、列表、新建/编辑弹窗（复用共享表单）、批量删除。
// 历史完成查看 = 状态选「已完成」+ 日期范围按完成时间筛选。
import { createTodoForm, diffTodoPatch } from '../../common/todo-form.js';
import { fmtDateTime, fmtHours } from '../../common/format.js';
import { confirmDialog } from '../app.js';

let filter = { status: 'all', categoryId: 'all', dateField: 'startTime', dateFrom: '', dateTo: '' };
let sortState = null; // { key: 'startTime'|'endTime'|'durationHours'|'dueTime', dir: 1|-1 }，null = 默认排序（未完成在前，各按开始/完成时间升序；sortOrder 只对桌面贴生效）

export async function renderTodosPage(page) {
  const [categories, todos] = await Promise.all([
    window.todoDesk.categories.list(),
    window.todoDesk.view.query(cleanFilter(filter)),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));

  // ---- 页头 ----
  const head = document.createElement('div');
  head.className = 'page-head';
  const h1 = document.createElement('h1');
  h1.textContent = '待办管理';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn-primary';
  createBtn.textContent = '新建待办';
  createBtn.addEventListener('click', () => openTodoModal(null, categories));
  head.append(h1, createBtn);
  page.append(head);

  // ---- 筛选条 ----
  const bar = document.createElement('div');
  bar.className = 'filter-bar';

  const statusSel = select([
    ['all', '全部'], ['active', '进行中'], ['completed', '已完成'], ['overdue', '已逾期'],
  ], filter.status, (v) => { filter.status = v; rerender(); });
  bar.append(wrapLabel('状态', statusSel));

  const catSel = select([['all', '全部分类'], ['__none__', '未分类'],
    ...categories.map((c) => [c.id, c.name])], filter.categoryId, (v) => { filter.categoryId = v; rerender(); });
  bar.append(wrapLabel('分类', catSel));

  const fieldSel = select([['startTime', '开始时间'], ['endTime', '完成时间']], filter.dateField, (v) => { filter.dateField = v; rerender(); });
  bar.append(wrapLabel('按', fieldSel));

  const from = dateInput(filter.dateFrom, (v) => { filter.dateFrom = v; rerender(); });
  const to = dateInput(filter.dateTo, (v) => { filter.dateTo = v; rerender(); });
  bar.append(wrapLabel('日期', from), span('至'), wrapLabel('', to));
  page.append(bar);

  // ---- 列表 ----
  if (!todos.length) {
    const empty = document.createElement('div');
    empty.className = 'list-empty';
    empty.textContent = '还没有待办，点「新建待办」开始';
    page.append(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'list';
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  tr.append(Object.assign(document.createElement('th'), { style: 'width:32px' }));
  tr.append(th('任务'));
  tr.append(th('分类'));
  // 时间列头可点击排序（spec §3），再点切换升降序
  for (const [label, key] of [['开始', 'startTime'], ['完成', 'endTime'], ['耗时', 'durationHours'], ['截止', 'dueTime']]) {
    const h = th(label + (sortState && sortState.key === key ? (sortState.dir === 1 ? ' ↑' : ' ↓') : ''), () => {
      sortState = sortState && sortState.key === key ? { key, dir: -sortState.dir } : { key, dir: 1 };
      rerender();
    });
    h.style.cursor = 'pointer';
    tr.append(h);
  }
  tr.append(th('备注'));
  tr.append(Object.assign(document.createElement('th'), { style: 'width:110px', textContent: '操作' }));
  thead.append(tr);
  table.append(thead);
  const tbody = document.createElement('tbody');

  const rows = sortState
    ? [...todos].sort((a, b) => {
        // 耗时是数字，其余是 ISO 时间；统一折成可比较数值
        const val = (t) => (typeof t[sortState.key] === 'number' ? t[sortState.key] : new Date(t[sortState.key] ?? 0).getTime());
        return (val(a) - val(b)) * sortState.dir;
      })
    : todos;
  for (const t of rows) {
    const cat = t.categoryId ? catMap.get(t.categoryId) : null;
    const done = t.endTime != null;
    const overdue = !done && t.dueTime != null && new Date(t.dueTime).getTime() < Date.now();

    const tr = document.createElement('tr');
    if (done) tr.className = 'done-row';

    const sel = document.createElement('input');
    sel.type = 'checkbox';
    sel.dataset.id = t.id;
    sel.addEventListener('change', updateBatchBar);
    tr.append(td(sel));

    const titleTd = tdText(t.title);
    titleTd.className = 'title-cell';
    tr.append(titleTd);

    const catTd = document.createElement('td');
    const catSpan = document.createElement('span');
    catSpan.className = 'cat';
    if (cat) {
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = cat.color;
      catSpan.append(dot, document.createTextNode(cat.name));
    } else {
      catSpan.textContent = '未分类';
    }
    catTd.append(catSpan);
    tr.append(catTd);

    tr.append(timeTd(t.startTime));
    tr.append(timeTd(t.endTime));
    const durTd = document.createElement('td');
    durTd.className = 'time';
    durTd.textContent = fmtHours(t.durationHours);
    tr.append(durTd);
    tr.append(timeTd(t.dueTime, overdue));

    const notesTd = tdText(t.notes || '');
    notesTd.className = 'notes-cell';
    tr.append(notesTd);

    const actTd = document.createElement('td');
    actTd.className = 'actions';
    const editBtn = actionBtn('编辑', () => openTodoModal(t, categories));
    const delBtn = actionBtn('删除', async () => {
      if (await confirmDialog(`删除「${t.title}」？`)) await window.todoDesk.todos.remove(t.id);
    });
    delBtn.classList.add('del');
    actTd.append(editBtn, delBtn);
    tr.append(actTd);
    tbody.append(tr);
  }
  table.append(tbody);
  page.append(table);

  // 截断列的悬停提示：布局完成后检测溢出，仅在显示不完整时挂 title（全文）
  requestAnimationFrame(() => {
    for (const td of tbody.querySelectorAll('td.title-cell, td.notes-cell')) {
      if (td.scrollWidth > td.clientWidth) td.title = td.textContent;
    }
  });

  // ---- 批量删除 ----
  const batchBar = document.createElement('div');
  batchBar.className = 'batch-bar';
  const delSel = document.createElement('button');
  delSel.textContent = '删除所选';
  delSel.style.display = 'none';
  delSel.addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('table.list tbody input[type="checkbox"]:checked')].map((c) => c.dataset.id);
    if (!ids.length) return;
    if (await confirmDialog(`删除所选的 ${ids.length} 条待办？`)) {
      for (const id of ids) await window.todoDesk.todos.remove(id);
    }
  });
  batchBar.append(delSel);
  page.append(batchBar);

  function updateBatchBar() {
    const n = document.querySelectorAll('table.list tbody input[type="checkbox"]:checked').length;
    delSel.style.display = n ? '' : 'none';
    delSel.textContent = `删除所选 (${n})`;
  }
}

function rerender() {
  document.querySelectorAll('.filter-bar select, .filter-bar input').forEach((el) => el.blur());
  import('../app.js').then(({ showPage }) => showPage('todos'));
}

function cleanFilter(f) {
  const out = { status: f.status, categoryId: f.categoryId, dateField: f.dateField };
  if (f.dateFrom) out.dateFrom = f.dateFrom;
  if (f.dateTo) out.dateTo = f.dateTo;
  return out;
}

// 新建/编辑弹窗：同一套共享表单；新建 = create({title,categoryId}) + 非默认字段 update
async function openTodoModal(todo, categories) {
  const layer = document.getElementById('modalLayer');
  layer.replaceChildren();
  const box = document.createElement('div');
  box.className = 'modal';
  const h2 = document.createElement('h2');
  h2.textContent = todo ? '编辑待办' : '新建待办';
  const form = createTodoForm({ todo, categories });
  const bar = document.createElement('div');
  bar.className = 'form-bar';
  const close = document.createElement('button');
  close.textContent = '关闭';
  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = '保存';
  bar.append(close, save);
  box.append(h2, form.el, bar);
  layer.append(box);
  layer.hidden = false;

  const closeLayer = () => { layer.hidden = true; layer.replaceChildren(); };
  close.addEventListener('click', closeLayer);

  save.addEventListener('click', async () => {
    const values = form.getValues();
    if (!values) return;
    try {
      if (todo) {
        // 取消完成且完成时间曾被人工改过 → 先确认
        if (todo.endTime != null && values.endTime == null && todo.endTimeManuallySet) {
          if (!(await confirmDialog('完成时间是手动调整过的，取消完成后将清除，确定？'))) return;
        }
        const patch = diffTodoPatch(todo, values);
        if (Object.keys(patch).length) await window.todoDesk.todos.update({ id: todo.id, patch });
        closeLayer();
      } else {
        const created = await window.todoDesk.todos.create({ title: values.title, categoryId: values.categoryId });
        const patch = {};
        if (values.notes) patch.notes = values.notes;
        if (values.dueTime) patch.dueTime = values.dueTime;
        if (values.endTime) {
          patch.endTime = values.endTime;
          if (values.durationHours != null) patch.durationHours = values.durationHours;
        }
        if (values.startTime) patch.startTime = values.startTime;
        if (Object.keys(patch).length) await window.todoDesk.todos.update({ id: created.id, patch });
      }
      closeLayer();
    } catch (e) {
      form.showError(e.message);
    }
  });
}

// ---- 小工具 ----
function td(el) { const c = document.createElement('td'); c.append(el); return c; }
function th(text, onClick) {
  const h = document.createElement('th');
  h.textContent = text;
  if (onClick) h.addEventListener('click', onClick);
  return h;
}
function tdText(text) { const c = td(document.createTextNode(text)); return c; }
function timeTd(iso, overdue = false) {
  const c = document.createElement('td');
  c.className = 'time' + (overdue ? ' overdue' : '');
  c.textContent = iso ? fmtDateTime(iso) : '—';
  return c;
}
function actionBtn(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}
function select(options, value, onChange) {
  const s = document.createElement('select');
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function dateInput(value, onChange) {
  const i = document.createElement('input');
  i.type = 'date';
  i.value = value;
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
function wrapLabel(text, el) {
  const l = document.createElement('label');
  if (text) l.append(document.createTextNode(text));
  l.append(el);
  return l;
}
function span(text) { const s = document.createElement('span'); s.textContent = text; s.style.fontSize = '12px'; s.style.color = 'var(--ink-soft)'; return s; }
