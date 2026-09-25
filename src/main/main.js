'use strict';
// TodoDesk 主进程入口：单实例、数据目录解析与写权限检测、损坏确认、日志、生命周期。
const { app, dialog } = require('electron');
const path = require('path');
const store = require('../shared/store');
const logger = require('./logger');

let dataDir = null;
let state = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Task 7 接入：显示主程序与桌面贴
    showMainWindow();
    showWidget();
  });
  app.whenReady().then(bootstrap);
  app.on('window-all-closed', () => { /* 托盘常驻，不退出 */ });
}

function resolveDataDir() {
  const root = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(root, 'data');
}

async function bootstrap() {
  app.setAppUserModelId('com.tododesk.app');
  dataDir = resolveDataDir();
  try {
    store.ensureWritable(dataDir);
  } catch (e) {
    dialog.showErrorBox('TodoDesk 无法写入数据目录',
      `目录：${dataDir}\n请把软件移动到有写权限的位置后重试。\n${e.message}`);
    app.quit();
    return;
  }
  const r = store.loadState(dataDir);
  if (r.corrupted) {
    const btn = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['以空数据继续', '退出'],
      title: 'TodoDesk 数据文件损坏',
      message: '数据文件与备份均无法读取。',
      detail: '原文件已保留（确认后将改名为 .corrupt 留证），继续将以空数据启动。',
    });
    if (btn === 1) { app.quit(); return; }
    store.archiveCorrupted(dataDir);
    logger.write(dataDir, '数据文件双损坏，已留证并以空数据启动');
  } else if (r.recoveredFromBackup) {
    try {
      const { Notification } = require('electron');
      new Notification({ title: 'TodoDesk', body: '数据文件损坏，已从备份恢复' }).show();
    } catch { /* 通知失败不影响启动 */ }
    logger.write(dataDir, '主数据损坏，已从备份恢复');
  }
  state = r.data;
  saveStateNow();
  // Task 6/7 接入：创建桌面贴窗口、主程序窗口、托盘、注册 IPC
  createWidget();
  showMainWindow();
}

function saveStateNow() {
  try {
    store.saveState(dataDir, state);
  } catch (e) {
    logger.write(dataDir, `保存失败：${e.message}`);
  }
}

// ---- 以下为接线占位，Task 6/7 替换为真实实现 ----
function createWidget() {}
function showMainWindow() {}
function showWidget() {}
function toggleWidget() {}
function broadcast() {}
