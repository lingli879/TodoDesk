'use strict';
// 详情窗口：独立于桌面贴尺寸的固定大小编辑窗（单例复用，贴桌面贴旁弹出）。
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { fitRectToDisplays } = require('../shared/geometry');

const SIZE = { width: 380, height: 560 };
const MIN_SIZE = { width: 340, height: 460 };

let detailWin = null;

// 弹出位置：桌面贴右侧贴边；越屏则左侧；再越屏交由 fitRectToDisplays 收敛。
function placeNear(nearRect) {
  const displays = screen.getAllDisplays();
  let x = nearRect.x + nearRect.width + 12;
  if (x + SIZE.width > Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))) {
    x = nearRect.x - SIZE.width - 12;
  }
  const y = Math.max(nearRect.y, 0);
  return fitRectToDisplays({ x, y, ...SIZE }, displays);
}

function createDetailWindow(todoId, nearRect) {
  if (detailWin && !detailWin.isDestroyed()) {
    // 单例复用：仅切换待办并前置
    detailWin.webContents.send('detail:load', todoId);
    detailWin.show();
    detailWin.focus();
    return detailWin;
  }
  const preloadPath = path.join(__dirname, 'preload.js');
  const rect = nearRect ? placeNear(nearRect) : { ...SIZE };
  detailWin = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: SIZE.width,
    height: SIZE.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    resizable: true,
    show: false,
    webPreferences: { preload: preloadPath },
  });
  detailWin.loadFile(path.join(__dirname, '../renderer/detail/detail.html'), { query: { id: todoId } });
  detailWin.once('ready-to-show', () => detailWin.show());
  detailWin.on('closed', () => { detailWin = null; });
  return detailWin;
}

module.exports = { createDetailWindow, getDetailWindow: () => detailWin };
