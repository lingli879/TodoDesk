'use strict';
// 主程序窗口：原生标题栏（自动跟随系统明暗），关闭=隐藏到托盘。
const { BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

function createMainWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');
  const win = new BrowserWindow({
    width: 1000,
    height: 680,
    minWidth: 760,
    minHeight: 480,
    show: false,
    icon: path.join(__dirname, '../../build/tray.png'), // 与托盘同源图案
    webPreferences: fs.existsSync(preloadPath) ? { preload: preloadPath } : {},
  });
  win.loadFile(path.join(__dirname, '../renderer/app/index.html'));
  win.once('ready-to-show', () => win.show());
  // close→隐藏到托盘 的生命周期策略由 main.js 统一管理（带退出标志）
  return win;
}

module.exports = { createMainWindow };
