// 分类管理页：增删改（名称/颜色/排序）+ 桌面贴展示配置（哪些分类上贴、未分类开关）。
import { confirmDialog } from '../app.js';

export async function renderCategoriesPage(page) {
  const [categories, settings, palette] = await Promise.all([
    window.todoDesk.categories.list(),
    window.todoDesk.settings.get(),
    window.todoDesk.meta.palette(),
  ]);
  categories.sort((a, b) => a.sortOrder - b.sortOrder);

  // ---- 页头 ----
  const head = document.createElement('div');
  head.className = 'page-head';
  const h1 = document.createElement('h1');
  h1.textContent = '分类管理';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary';
  addBtn.textContent = '新建分类';
  addBtn.addEventListener('click', async () => {
    const used = new Set(categories.map((c) => c.color));
    const color = palette.find((c) => !used.has(c)) || palette[0];
    const c = await window.todoDesk.categories.create({ name: '新分类', color });
    await window.todoDesk.categories.update({ id: c.id, patch: { sortOrder: categories.length } });
  });
  head.append(h1, addBtn);
  page.append(head);

  // ---- 分类列表 ----
  const table = document.createElement('table');
  table.className = 'list';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>颜色</th><th>名称</th><th>排序</th><th style="width:110px">操作</th></tr>';
  table.append(thead);
  const tbody = document.createElement('tbody');

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const tr = document.createElement('tr');

    // 颜色选择（8 色板）
    const colorTd = document.createElement('td');
    const colorSel = document.createElement('select');
    for (const hex of palette) {
      const o = document.createElement('option');
      o.value = hex;
      o.textContent = hex;
      colorSel.append(o);
    }
    colorSel.value = cat.color;
    colorSel.addEventListener('change', () => saveOrderThen(cat.id, { color: colorSel.value }));
    colorTd.append(colorSel);
    tr.append(colorTd);

    // 名称（失焦保存）
    const nameTd = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = cat.name;
    nameInput.style.cssText = 'font:inherit;color:var(--ink);background:transparent;border:none;outline:none;width:100%';
    nameInput.addEventListener('change', () => saveOrderThen(cat.id, { name: nameInput.value.trim() || cat.name }));
    nameTd.append(nameInput);
    tr.append(nameTd);

    // 排序：上移/下移
    const orderTd = document.createElement('td');
    orderTd.className = 'actions';
    const up = document.createElement('button');
    up.textContent = '↑ 上移';
    up.disabled = i === 0;
    up.addEventListener('click', async () => {
      const prev = categories[i - 1];
      await window.todoDesk.categories.update({ id: cat.id, patch: { sortOrder: prev.sortOrder } });
      await window.todoDesk.categories.update({ id: prev.id, patch: { sortOrder: cat.sortOrder } });
    });
    const down = document.createElement('button');
    down.textContent = '↓ 下移';
    down.disabled = i === categories.length - 1;
    down.addEventListener('click', async () => {
      const next = categories[i + 1];
      await window.todoDesk.categories.update({ id: cat.id, patch: { sortOrder: next.sortOrder } });
      await window.todoDesk.categories.update({ id: next.id, patch: { sortOrder: cat.sortOrder } });
    });
    orderTd.append(up, down);
    tr.append(orderTd);

    // 删除
    const actTd = document.createElement('td');
    actTd.className = 'actions';
    const del = document.createElement('button');
    del.textContent = '删除';
    del.classList.add('del');
    del.addEventListener('click', async () => {
      if (await confirmDialog(`删除分类「${cat.name}」？该分类下的待办将转为未分类。`)) {
        await window.todoDesk.categories.remove(cat.id);
      }
    });
    actTd.append(del);
    tr.append(actTd);
    tbody.append(tr);
  }
  table.append(tbody);
  page.append(table);

  // ---- 桌面贴展示配置 ----
  const cfgHead = document.createElement('div');
  cfgHead.className = 'page-head';
  cfgHead.style.marginTop = '22px';
  const cfgH2 = document.createElement('h1');
  cfgH2.style.fontSize = '16px';
  cfgH2.textContent = '桌面贴展示';
  cfgHead.append(cfgH2);
  page.append(cfgHead);

  const allOn = !settings.widgetVisibleCategoryIds.length;
  const cfgBox = document.createElement('div');
  cfgBox.className = 'filter-bar';
  cfgBox.style.flexDirection = 'column';
  cfgBox.style.alignItems = 'flex-start';
  cfgBox.style.gap = '10px';

  const allLabel = document.createElement('label');
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.checked = allOn;
  allCb.addEventListener('change', async () => {
    await window.todoDesk.settings.set({ widgetVisibleCategoryIds: allCb.checked ? [] : categories.map((c) => c.id) });
  });
  allLabel.append(allCb, document.createTextNode(' 展示全部分类'));
  cfgBox.append(allLabel);

  for (const cat of categories) {
    const l = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = allOn || settings.widgetVisibleCategoryIds.includes(cat.id);
    cb.disabled = allOn;
    cb.addEventListener('change', async () => {
      const cur = new Set((await window.todoDesk.settings.get()).widgetVisibleCategoryIds);
      if (cb.checked) cur.add(cat.id); else cur.delete(cat.id);
      await window.todoDesk.settings.set({ widgetVisibleCategoryIds: [...cur] });
    });
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.cssText = `width:8px;height:8px;border-radius:50%;background:${cat.color};display:inline-block`;
    l.append(cb, dot, document.createTextNode(` ${cat.name}`));
    cfgBox.append(l);
  }

  const noneLabel = document.createElement('label');
  const noneCb = document.createElement('input');
  noneCb.type = 'checkbox';
  noneCb.checked = settings.widgetShowUncategorized;
  noneCb.addEventListener('change', () => window.todoDesk.settings.set({ widgetShowUncategorized: noneCb.checked }));
  noneLabel.append(noneCb, document.createTextNode(' 展示「未分类」待办'));
  cfgBox.append(noneLabel);
  page.append(cfgBox);
}

// 更新分类字段（名称/颜色）后不动排序
async function saveOrderThen(id, patch) {
  await window.todoDesk.categories.update({ id, patch });
}
