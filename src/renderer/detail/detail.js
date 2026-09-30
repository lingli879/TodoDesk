// 详情独立窗口：表单查看/编辑 + 保存/删除/关闭。初始 id 来自 URL query，复用时来自 detail:load。
import { createTodoForm, diffTodoPatch } from '../common/todo-form.js';

const body = document.getElementById('detailBody');
let todoId = new URLSearchParams(location.search).get('id');
let todo = null;
let form = null;

// 渲染表单 + 操作条；数据变化（他处修改）时重建
async function load(id) {
  todoId = id;
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

// 数据在他处变化（如桌面贴完成/改名）时刷新表单；自身保存/删除后窗口已关，无副作用
window.todoDesk.onDataChange(() => { if (todoId) load(todoId); });
// 单例复用：桌面贴上点另一条待办的详情图标时，主进程推新 id 过来
window.todoDesk.onDetailLoad((id) => { if (id) load(id); });

if (todoId) load(todoId);
