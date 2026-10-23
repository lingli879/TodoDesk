// 共享待办表单：桌面贴详情面板与主程序编辑弹窗共用同一套字段与联动逻辑。
import { isoToLocalInput, localInputToIso, durationHoursBetween } from './format.js';

// 只保留相对原待办真正变化的字段（按分钟精度比较时间），避免无关保存误置 endTimeManuallySet。
export function diffTodoPatch(todo, values) {
  const sameMinute = (a, b) => isoToLocalInput(a) === isoToLocalInput(b);
  const patch = {};
  if (values.title !== todo.title) patch.title = values.title;
  if ((values.notes || '') !== (todo.notes || '')) patch.notes = values.notes;
  if ((values.categoryId ?? null) !== (todo.categoryId ?? null)) patch.categoryId = values.categoryId;
  if (!sameMinute(values.startTime, todo.startTime)) patch.startTime = values.startTime;
  if (!sameMinute(values.endTime, todo.endTime)) patch.endTime = values.endTime;
  if (!sameMinute(values.dueTime, todo.dueTime)) patch.dueTime = values.dueTime;
  if ((values.durationHours ?? null) !== (todo.durationHours ?? null)) patch.durationHours = values.durationHours;
  return patch;
}

// createTodoForm({ todo, categories, now }) → { el, getValues() }
// 字段：任务、分类（含「未分类」）、备注、开始/完成/截止（datetime-local）+ 完成勾选、耗时（小时）。
// 勾选「完成」时若完成时间为空自动填 now；取消勾选清空完成时间。
// 耗时仅完成态显示：未手动编辑过时跟随开始/完成时间差自动重算（0.5 步进），手动输入后以人工值为准。
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
  field('任务', els.title);

  els.category = document.createElement('select');
  const optNone = document.createElement('option');
  optNone.value = '';
  optNone.textContent = '未分类';
  els.category.append(optNone);
  const sorted = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const c of sorted) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    els.category.append(o);
  }
  // 新建默认：分类=第一个分类；编辑：保持原分类
  els.category.value = todo && todo.categoryId ? todo.categoryId
    : (sorted[0] ? sorted[0].id : '');
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
    // 新建默认：开始时间=创建时刻（now）；其余时间留空
    input.value = todo && todo[key] ? isoToLocalInput(todo[key])
      : (!todo && key === 'startTime' ? isoToLocalInput(now) : '');
    els[key] = input;
    if (key === 'endTime') {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!(todo && todo.endTime != null);
      cb.addEventListener('change', () => {
        if (cb.checked && !input.value) input.value = isoToLocalInput(now);
        // 取消勾选不清空输入框：人工改过的完成时间保留原值，是否清除由保存动作（含确认）决定
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

  // ---- 耗时（小时）：仅完成态显示；未手动编辑时跟随开始/完成时间差自动重算 ----
  let durationAuto = true;
  els.duration = document.createElement('input');
  els.duration.type = 'number';
  els.duration.min = '0';
  els.duration.step = '0.5';
  els.duration.placeholder = '按时间差自动';
  els.duration.value = todo && todo.durationHours != null ? todo.durationHours : '';
  els.duration.addEventListener('input', () => { durationAuto = false; });
  const syncDuration = () => {
    if (!durationAuto) return;
    const h = durationHoursBetween(localInputToIso(els.startTime.value), localInputToIso(els.endTime.value));
    els.duration.value = h == null ? '' : h;
  };
  els.startTime.addEventListener('input', syncDuration);
  els.endTime.addEventListener('input', syncDuration);
  els.doneToggle.addEventListener('change', () => {
    durBox.hidden = !els.doneToggle.checked;
    if (els.doneToggle.checked) syncDuration(); // 勾选完成即给默认值
  });
  const durBox = document.createElement('div');
  durBox.className = 'field';
  durBox.hidden = !(todo && todo.endTime != null);
  const durLabel = document.createElement('span');
  durLabel.className = 'field-label';
  durLabel.textContent = '耗时（小时）';
  durBox.append(durLabel, els.duration);
  root.append(durBox);

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
      if (!title) { els.error.textContent = '任务不能为空'; els.title.focus(); return null; }
      if (!els.startTime.value) { els.error.textContent = '开始时间不能为空'; return null; }
      if (els.doneToggle.checked && !els.endTime.value) { els.error.textContent = '完成时间不能为空'; return null; }
      let durationHours = null;
      if (els.doneToggle.checked && els.duration.value.trim() !== '') {
        const n = Number(els.duration.value);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n * 2)) {
          els.error.textContent = '耗时必须为非负的 0.5 步进小时数';
          return null;
        }
        durationHours = n;
      }
      return {
        title,
        categoryId: els.category.value || null,
        notes: els.notes.value,
        startTime: localInputToIso(els.startTime.value),
        endTime: els.doneToggle.checked ? localInputToIso(els.endTime.value) : null,
        durationHours,
        dueTime: els.dueTime.value ? localInputToIso(els.dueTime.value) : null,
      };
    },
  };
}
