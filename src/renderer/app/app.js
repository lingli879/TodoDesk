// 主程序壳：页面注册与导航切换、弹窗与确认对话框、数据变更刷新。
import { renderTodosPage } from './pages/todos.js';
import { renderCategoriesPage } from './pages/categories.js';
import { renderSettingsPage } from './pages/settings.js';

const pages = {};
let current = 'todos';
let renderToken = 0;

export function registerPage(id, renderFn) {
  pages[id] = renderFn;
}

export async function showPage(id) {
  const token = ++renderToken;
  current = id;
  document.querySelectorAll('aside nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.page === id);
  });
  const fn = pages[id];
  if (!fn) return;
  // 先渲染进 fragment，期间若有更新的 showPage 调用（并发筛选变更）则丢弃本次结果
  const frag = document.createDocumentFragment();
  await fn(frag);
  if (token !== renderToken) return;
  const page = document.getElementById('page');
  page.replaceChildren(frag);
}

// 确认对话框（Promise<boolean>）
export function confirmDialog(message) {
  return new Promise((resolve) => {
    const layer = document.getElementById('modalLayer');
    layer.replaceChildren();
    const box = document.createElement('div');
    box.className = 'modal confirm-modal';
    const p = document.createElement('p');
    p.textContent = message;
    const bar = document.createElement('div');
    bar.className = 'form-bar';
    const ok = document.createElement('button');
    ok.className = 'primary';
    ok.textContent = '确定';
    const cancel = document.createElement('button');
    cancel.textContent = '取消';
    bar.append(cancel, ok);
    box.append(p, bar);
    layer.append(box);
    layer.hidden = false;
    ok.focus();
    const close = (v) => { layer.hidden = true; layer.replaceChildren(); resolve(v); };
    ok.addEventListener('click', () => close(true));
    cancel.addEventListener('click', () => close(false));
  });
}

document.querySelector('aside nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-page]');
  if (b) showPage(b.dataset.page);
});

document.getElementById('showWidget').addEventListener('click', () => {
  window.todoDesk.widget.show();
});

window.todoDesk.onDataChange(() => showPage(current));

registerPage('todos', renderTodosPage);
registerPage('categories', renderCategoriesPage);
registerPage('settings', renderSettingsPage);
showPage('todos');
