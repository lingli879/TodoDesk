// 详情独立窗口：表单查看/编辑 + 保存/删除/关闭。初始 id 来自 URL query，复用时来自 detail:load。
// 无 id（或收到 detail:new）时为快速新建模式：保存即创建并关窗。
import { createTodoForm, diffTodoPatch } from '../common/todo-form.js';

const body = document.getElementById('detailBody');
const titleEl = document.getElementById('detailTitle');
let todoId = new URLSearchParams(location.search).get('id');
let todo = null;
let form = null;

// 渲染表单 + 操作条；数据变化（他处修改）时重建
async function load(id) {
  todoId = id;
  titleEl.textContent = '待办详情';
  const todos = await window.todoDesk.todos.list();
  const next = todos.find((t) => t.id === todoId);
  if (!next) { window.close(); return; } // 待办已被删除
  todo = next;
  const categories = await window.todoDesk.categories.list();
  form = createTodoForm({ todo, categories });
  const bar = document.createElement('div');
  bar.className = 'bar';
  const del = document.createElement('button');
  del.className = 'danger';
  del.textContent = '删除';
  const close = document.createElement('button');
  close.textContent = '关闭';
  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = '保存';
  bar.append(del, close, save);
  body.replaceChildren(form.el, bar);

  close.addEventListener('click', () => window.close());
  save.addEventListener('click', saveTodo);
  // 删除二态确认：第一次点变「确认删除？」，再点执行；点别处重置
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!del.classList.contains('confirming')) {
      del.classList.add('confirming');
      del.textContent = '确认删除？';
      setTimeout(() => { del.classList.remove('confirming'); del.textContent = '删除'; }, 3000);
      return;
    }
    await window.todoDesk.todos.remove(todoId);
    window.close();
  });
  document.body.addEventListener('click', (e) => {
    if (!del.contains(e.target) && del.classList.contains('confirming')) {
      del.classList.remove('confirming');
      del.textContent = '删除';
    }
  });
}

async function saveTodo() {
  const values = form.getValues();
  if (!values) return;
  const patch = diffTodoPatch(todo, values);
  // 取消完成且完成时间曾被人工改过 → 需明确保存（信息会丢失）
  if (todo.endTime != null && values.endTime == null && todo.endTimeManuallySet) {
    if (!confirm('完成时间是手动调整过的，取消完成后将清除，确定？')) return;
  }
  if (!Object.keys(patch).length) { window.close(); return; }
  try {
    await window.todoDesk.todos.update({ id: todoId, patch });
    window.close();
  } catch (e) {
    form.showError(e.message);
  }
}

document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

// ---- 快速新建模式（全局快捷键入口）：表单同主程序新建，保存即创建 ----
async function loadNew() {
  todoId = null;
  todo = null;
  titleEl.textContent = '新建待办';
  const categories = await window.todoDesk.categories.list();
  form = createTodoForm({ todo: null, categories });
  const bar = document.createElement('div');
  bar.className = 'bar';
  const close = document.createElement('button');
  close.textContent = '关闭';
  const save = document.createElement('button');
  save.className = 'primary';
  save.textContent = '保存';
  bar.append(close, save);
  body.replaceChildren(form.el, bar);
  close.addEventListener('click', () => window.close());
  save.addEventListener('click', saveNewTodo);
  els.title.focus(); // 新建即录入：光标直接落在任务输入框
}

const els = { get title() { return form?.el.querySelector('input[type="text"]') || null; } };

async function saveNewTodo() {
  const values = form.getValues();
  if (!values) return;
  try {
    const created = await window.todoDesk.todos.create({ title: values.title, categoryId: values.categoryId });
    const patch = {};
    if (values.notes) patch.notes = values.notes;
    if (values.dueTime) patch.dueTime = values.dueTime;
    if (values.endTime) patch.endTime = values.endTime;
    if (values.startTime) patch.startTime = values.startTime;
    if (Object.keys(patch).length) await window.todoDesk.todos.update({ id: created.id, patch });
    window.close();
  } catch (e) {
    form.showError(e.message);
  }
}

// 数据在他处变化（如桌面贴完成/改名）时刷新表单；自身保存/删除后窗口已关，无副作用。
// 新建模式（todoId=null）不刷新——录入到一半被他处数据变化冲掉不可接受。
window.todoDesk.onDataChange(() => { if (todoId) load(todoId); });
// 单例复用：桌面贴上点另一条待办的详情图标时，主进程推新 id 过来
window.todoDesk.onDetailLoad((id) => { if (id) load(id); });
// 快捷键新建：单例窗口切到新建模式
window.todoDesk.onNewTodo(() => { loadNew(); });

if (todoId) load(todoId);
else loadNew();
