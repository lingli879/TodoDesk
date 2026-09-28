// 设置页：快捷键录制、桌面贴透明度/显示已完成/分组、开机自启动、打开数据文件夹。
export async function renderSettingsPage(page) {
  const s = await window.todoDesk.settings.get();

  const head = document.createElement('div');
  head.className = 'page-head';
  const h1 = document.createElement('h1');
  h1.textContent = '设置';
  head.append(h1);
  page.append(head);

  const box = document.createElement('div');
  box.className = 'filter-bar';
  box.style.flexDirection = 'column';
  box.style.alignItems = 'stretch';
  box.style.gap = '14px';
  box.style.padding = '18px 20px';

  // ---- 快捷键（录制式改键）----
  const hotkeyRow = row('显示/隐藏桌面贴快捷键');
  const recBtn = document.createElement('button');
  recBtn.className = 'ghost';
  recBtn.textContent = s.hotkey || '未设置（点击录制）';
  recBtn.style.minWidth = '150px';
  const hotkeyErr = document.createElement('span');
  hotkeyErr.style.cssText = 'color: var(--danger); font-size: 12px';
  let recording = false;
  recBtn.addEventListener('click', () => {
    if (recording) return;
    recording = true;
    recBtn.textContent = '请按下组合键…';
    const onKey = (e) => {
      e.preventDefault();
      if (e.key === 'Escape') { cleanup(); return; }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return; // 等待非修饰键
      if (!e.ctrlKey && !e.altKey && !e.metaKey) {
        // 裸键会劫持系统级按键（任何程序里按此键都会触发），必须带修饰键
        hotkeyErr.textContent = '请加 Ctrl / Alt 等修饰键组合';
        return;
      }
      const parts = [];
      if (e.ctrlKey) parts.push('Control');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Meta');
      parts.push(e.key.length === 1 ? e.key.toUpperCase() : e.key);
      cleanup(parts.join('+'));
    };
    const cleanup = async (accel) => {
      recording = false;
      recBtn.removeEventListener('keydown', onKey);
      if (accel) {
        try {
          await window.todoDesk.settings.set({ hotkey: accel });
          recBtn.textContent = accel;
          hotkeyErr.textContent = '';
        } catch (err) {
          hotkeyErr.textContent = err.message;
        }
      } else {
        recBtn.textContent = (await window.todoDesk.settings.get()).hotkey || '未设置';
      }
    };
    recBtn.addEventListener('keydown', onKey);
    recBtn.focus();
  });
  hotkeyErr.textContent = '';
  hotkeyRow.append(recBtn, hotkeyErr);
  box.append(hotkeyRow);

  window.todoDesk.onHotkeyFailed(() => {
    hotkeyErr.textContent = '快捷键被其他程序占用，请换一个';
    recBtn.textContent = '点击重新录制';
  });

  // ---- 桌面贴透明度 ----
  const opacityRow = row('桌面贴透明度');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0.15';
  range.max = '1';
  range.step = '0.05';
  range.value = s.widgetOpacity;
  range.style.flex = '1';
  const opacityVal = document.createElement('span');
  opacityVal.style.cssText = 'font-variant-numeric: tabular-nums; color: var(--ink-soft); min-width: 38px';
  opacityVal.textContent = Number(s.widgetOpacity).toFixed(2);
  range.addEventListener('input', () => { opacityVal.textContent = Number(range.value).toFixed(2); });
  range.addEventListener('change', () => window.todoDesk.settings.set({ widgetOpacity: Number(range.value) }));
  opacityRow.append(range, opacityVal);
  box.append(opacityRow);

  // ---- 开关们 ----
  const toggles = [
    ['桌面贴显示当天已完成', 'showCompletedInWidget', s.showCompletedInWidget],
    ['桌面贴按分类分组', 'widgetGroupByCategory', s.widgetGroupByCategory],
    ['开机自启动', 'autoLaunch', s.autoLaunch],
  ];
  for (const [label, key, val] of toggles) {
    const r = row(label);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = val;
    cb.addEventListener('change', () => window.todoDesk.settings.set({ [key]: cb.checked }));
    r.append(cb);
    box.append(r);
  }

  // ---- 打开数据文件夹 ----
  const dataRow = row('数据');
  const openBtn = document.createElement('button');
  openBtn.className = 'ghost';
  openBtn.textContent = '打开数据文件夹';
  openBtn.addEventListener('click', () => window.todoDesk.openDataFolder());
  dataRow.append(openBtn);
  box.append(dataRow);

  page.append(box);
}

function row(label) {
  const r = document.createElement('div');
  r.className = 'setting-row';
  r.style.cssText = 'display:flex;align-items:center;gap:12px';
  const t = document.createElement('span');
  t.textContent = label;
  t.style.cssText = 'min-width: 170px; color: var(--ink-soft)';
  r.append(t);
  return r;
}
