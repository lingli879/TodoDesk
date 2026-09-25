// 共享待办表单：桌面贴详情面板与主程序编辑弹窗共用同一套字段与联动逻辑。
import { isoToLocalInput, localInputToIso } from './format.js';

// createTodoForm({ todo, categories, now }) → { el, getValues() }
// 字段：标题、分类（含「未分类」）、备注、开始/完成/截止（datetime-local）+ 完成勾选。
// 勾选「完成」时若完成时间为空自动填 now；取消勾选清空完成时间。
export function createTodoForm({ todo = null, categories = [], now = new Date().toISOString() }) {
  const els = {};
  const root = document.createElement('form');
  root.className = 'todo-form';
  root.addEventListener('submit', (e) => e.preventDefault());

  const field = (labelText, inputEl) => {
    const w = document.createElement('label');
    w.className = 'field';
    const t = document.createElement('span');
    t.className = 'field-label';
    t.textContent = labelText;
    w.append(t, inputEl);
    root.append(w);
    return w;
  };

  els.title = document.createElement('input');
  els.title.type = 'text';
  els.title.placeholder = '要做的事';
  els.title.value = todo ? todo.title : '';
  field('标题', els.title);

  els.category = document.createElement('select');
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '未分类';
  els.category.append(optNone);
  for (const c of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    els.category.append(o);
  }
  els.category.value = todo && todo.categoryId ? todo.categoryId : '';
  field('分类', els.category);

  els.notes = document.createElement('textarea');
  els.notes.rows = 3;
  els.notes.placeholder = '备注…';
  els.notes.value = todo ? todo.notes || '' : '';
  field('备注', els.notes);

  const dt = (labelText, key) => {
    const box = document.createElement('div');
    box.className = 'field datetime-field';
    const t = document.createElement('span');
    t.className = 'field-label';
    t.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.value = todo && todo[key] ? isoToLocalInput(todo[key]) : '';
    els[key] = input;
    if (key === 'endTime') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!(todo && todo.endTime != null);
      cb.addEventListener('change', () => {
        if (cb.checked && !input.value) input.value = isoToLocalInput(now);
        if (!cb.checked) input.value = '';
      });
      els.doneToggle = cb;
      const lbl = document.createElement('span');
      lbl.className = 'done-label';
      lbl.textContent = '完成';
      const wrap = document.createElement('div');
      wrap.className = 'datetime-inline';
      wrap.append(cb, lbl, input);
      box.append(t, wrap);
    } else {
      box.append(t, input);
    }
    root.append(box);
  };

  dt('开始时间', 'startTime');
  dt('完成时间', 'endTime');
  dt('截止时间', 'dueTime');

  const err = document.createElement('div');
  err.className = 'form-error';
  root.append(err);
  els.error = err;

  return {
    el: root,
    showError(msg) { err.textContent = msg || ''; },
    getValues() {
      const title = els.title.value.trim();
      if (!title) { els.error.textContent = '标题不能为空'; els.title.focus(); return null; }
      if (!els.startTime.value) { els.error.textContent = '开始时间不能为空'; return null; }
      if (els.doneToggle.checked && !els.endTime.value) { els.error.textContent = '完成时间不能为空'; return null; }
      return {
        title,
        categoryId: els.category.value || null,
        notes: els.notes.value,
        startTime: localInputToIso(els.startTime.value),
        endTime: els.doneToggle.checked ? localInputToIso(els.endTime.value) : null,
        dueTime: els.dueTime.value ? localInputToIso(els.dueTime.value) : null,
      };
    },
  };
}
