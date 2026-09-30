'use strict';
// preload：向两个渲染窗口暴露受控 API（contextBridge），渲染进程不直接碰文件系统。
const { contextBridge, ipcRenderer } = require('electron');

// 主进程 handler 统一返回 { ok, value } | { ok:false, error } 信封，此处解包：
// 成功返回 value，失败抛 Error（渲染层 await 即得原始数据）。
const invoke = (ch) => async (...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (r && typeof r === 'object' && 'ok' in r) {
    if (!r.ok) throw new Error(r.error);
    return r.value;
  }
  return r;
};

contextBridge.exposeInMainWorld('todoDesk', {
  categories: {
    list: invoke('categories:list'),
    create: invoke('categories:create'),
    update: invoke('categories:update'),
    remove: invoke('categories:remove'),
  },
  todos: {
    list: invoke('todos:list'),
    create: invoke('todos:create'),
    update: invoke('todos:update'),
    complete: invoke('todos:complete'),
    uncomplete: invoke('todos:uncomplete'),
    remove: invoke('todos:remove'),
    reorder: invoke('todos:reorder'),
  },
  view: {
    widget: invoke('widget:view'),
    query: invoke('todos:query'),
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set'),
  },
  meta: {
    palette: invoke('meta:palette'),
  },
  widget: {
    show: invoke('widget:show'),
    hide: invoke('widget:hide'),
    toggle: invoke('widget:toggle'),
    // 拖动/缩放：附着桌面层后系统的 HTCAPTION/HTBORDER 循环失效，走应用层高频单向推送
    beginDrag: (p) => ipcRenderer.send('widget:begin-drag', p),
    dragMove: (p) => ipcRenderer.send('widget:drag-move', p),
    endDrag: () => ipcRenderer.send('widget:end-drag'),
  },
  detail: {
    open: invoke('detail:open'),
  },
  app: {
    quit: invoke('app:quit'),
  },
  openDataFolder: invoke('openDataFolder'),
  onDataChange: (cb) => {
    ipcRenderer.on('data-changed', cb);
    return () => ipcRenderer.removeListener('data-changed', cb);
  },
  onSettingsChange: (cb) => {
    ipcRenderer.on('settings-changed', cb);
    return () => ipcRenderer.removeListener('settings-changed', cb);
  },
  onHotkeyFailed: (cb) => {
    ipcRenderer.on('hotkey-failed', cb);
    return () => ipcRenderer.removeListener('hotkey-failed', cb);
  },
  onDetailLoad: (cb) => {
    const handler = (_e, id) => cb(id);
    ipcRenderer.on('detail:load', handler);
    return () => ipcRenderer.removeListener('detail:load', handler);
  },
});
