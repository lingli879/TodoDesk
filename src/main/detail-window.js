'use strict';
// 详情窗口：独立于桌面贴尺寸的固定大小编辑窗（单例复用，光标所在屏居中弹出）。
// 两种内容模式：编辑已有待办（detail:load 推 id）/ 快速新建待办（detail:new）。
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');

const SIZE = { width: 380, height: 560 };
const MIN_SIZE = { width: 340, height: 460 };

let detailWin = null;

// 弹出位置：光标所在显示器的工作区居中——不跟随桌面贴，也不依赖主程序窗口
function placeCentered() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = d.workArea;
  return {
    x: Math.round(wa.x + (wa.width - SIZE.width) / 2),
    y: Math.round(wa.y + (wa.height - SIZE.height) / 2),
  };
}

function createWindow(query) {
  const preloadPath = path.join(__dirname, 'preload.js');
  const pos = placeCentered();
  detailWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: SIZE.width,
    height: SIZE.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    resizable: true,
    show: false,
    webPreferences: { preload: preloadPath },
  });
  detailWin.loadFile(path.join(__dirname, '../renderer/detail/detail.html'), { query });
  detailWin.once('ready-to-show', () => detailWin.show());
  detailWin.on('closed', () => { detailWin = null; });
  return detailWin;
}

function createDetailWindow(todoId) {
  if (detailWin && !detailWin.isDestroyed()) {
    // 单例复用：仅切换待办并前置
    detailWin.webContents.send('detail:load', todoId);
    detailWin.show();
    detailWin.focus();
    return detailWin;
  }
  return createWindow({ id: todoId });
}

// 全局快捷键「新建待办」入口：不显示主程序，直接弹新建表单
function openNewTodoWindow() {
  if (detailWin && !detailWin.isDestroyed()) {
    detailWin.webContents.send('detail:new');
    detailWin.show();
    detailWin.focus();
    return detailWin;
  }
  return createWindow({}); // query 无 id → 新建模式
}

module.exports = { createDetailWindow, openNewTodoWindow, getDetailWindow: () => detailWin };
