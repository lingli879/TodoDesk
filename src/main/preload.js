'use strict';
// preload：向两个渲染窗口暴露受控 API（contextBridge），渲染进程不直接碰文件系统。
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

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
});
