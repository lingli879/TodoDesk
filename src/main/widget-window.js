'use strict';
// 桌面贴窗口：透明/无边框/不抢焦点（WS_EX_NOACTIVATE）+ Win+D 桌面态动态迁移（见 desktop-mode.js）/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
// 拖动/缩放走应用层 IPC（见 main.js）：桌面歌词类软件的通用形态。
const { BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fitRectToDisplays, MARGIN } = require('../shared/geometry');
const { startDesktopModeWatch } = require('./desktop-mode');

const DEFAULT_SIZE = { width: 300, height: 420 };
const MIN_SIZE = { width: 240, height: 200 };

function bottomRight(workArea, size) {
  return {
    x: workArea.x + workArea.width - size.width - MARGIN,
    y: workArea.y + workArea.height - size.height - MARGIN,
  };
}

function createWidgetWindow({ getSettings, onRectChanged }) {
  const s = getSettings();
  const size = s.widgetSize || { ...DEFAULT_SIZE };
  let rect;
  if (s.widgetPosition) {
    rect = fitRectToDisplays({ ...s.widgetPosition, ...size }, screen.getAllDisplays());
  } else {
    rect = { ...bottomRight(screen.getPrimaryDisplay().workArea, size), ...size };
  }

  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: false, // 普通窗口层级，不遮挡其他应用；透明度由 CSS --panel-alpha 控制
    skipTaskbar: true,
    focusable: false, // WS_EX_NOACTIVATE：不抢焦点 + Win+D「显示桌面」不最小化（桌面歌词式，实测）
    show: false,
    webPreferences: fs.existsSync(preloadPath) ? { preload: preloadPath } : {},
  });
  win.loadFile(path.join(__dirname, '../renderer/widget/widget.html'));

  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const b = win.getBounds();
      onRectChanged({ position: { x: b.x, y: b.y }, size: { width: b.width, height: b.height } });
    }, 500);
  };
  win.on('moved', persist);
  win.on('resized', persist);
  // Win+D 兜底：桌面态迁移由 desktop-mode 轮询驱动（约 20ms 粒度），
  // 极端时序下若仍被最小化则立即弹回（无任务栏按钮 = 用户没有主动最小化的常规途径）
  win.on('minimize', () => win.restore());
  win.once('ready-to-show', () => {
    win.show();
    startDesktopModeWatch(win); // Win+D 桌面态：附着桌面层保可见；恢复时脱附保交互
  });
  return win;
}

function applyHotkey(accel, onToggle) {
  globalShortcut.unregisterAll();
  if (!accel) return true;
  try {
    return globalShortcut.register(accel, onToggle) !== false;
  } catch {
    return false;
  }
}

module.exports = { createWidgetWindow, applyHotkey, MIN_SIZE };
