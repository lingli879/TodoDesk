'use strict';
// 便携数据层：加载（损坏→备份→标记）、原子保存（tmp+rename）、滚动备份、写权限探测。
const fs = require('node:fs');
const path = require('node:path');
const { seedState, DEFAULT_SETTINGS, computeDurationHours } = require('./model');

const FILE = 'data.json';
const BAK = 'data.json.bak';
const TMP = 'data.json.tmp';

function tryParse(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

// 剥离未知字段（向前兼容），补齐缺省字段。
function sanitize(data) {
  const categories = Array.isArray(data?.categories)
    ? data.categories.map((c) => ({
      id: c.id, name: c.name, color: c.color,
      sortOrder: c.sortOrder ?? 0, createdAt: c.createdAt,
    }))
    : seedState(new Date().toISOString()).categories;
  const todos = Array.isArray(data?.todos)
    ? data.todos.map((t) => ({
      id: t.id, title: t.title, notes: t.notes ?? '', categoryId: t.categoryId ?? null,
      startTime: t.startTime, endTime: t.endTime ?? null, dueTime: t.dueTime ?? null,
      // 存量已完成待办缺耗时 → 按时间差回填默认值（已有人工值不覆盖）
      durationHours: t.durationHours ?? (t.endTime != null ? computeDurationHours(t.startTime, t.endTime) : null),
      createdAt: t.createdAt, updatedAt: t.updatedAt,
      endTimeManuallySet: t.endTimeManuallySet === true, sortOrder: t.sortOrder ?? 0,
    }))
    : [];
  const settings = { ...DEFAULT_SETTINGS, ...(data?.settings || {}) };
  return { categories, todos, settings };
}

function loadState(dataDir) {
  const main = path.join(dataDir, FILE);
  const bak = path.join(dataDir, BAK);
  if (!fs.existsSync(main)) {
    if (fs.existsSync(bak)) {
      const parsed = tryParse(bak);
      if (parsed !== undefined) return { data: sanitize(parsed), recoveredFromBackup: true, corrupted: false };
    }
    return { data: seedState(new Date().toISOString()), recoveredFromBackup: false, corrupted: false };
  }
  const parsed = tryParse(main);
  if (parsed !== undefined) return { data: sanitize(parsed), recoveredFromBackup: false, corrupted: false };
  const parsedBak = fs.existsSync(bak) ? tryParse(bak) : undefined;
  if (parsedBak !== undefined) {
    return { data: sanitize(parsedBak), recoveredFromBackup: true, corrupted: false };
  }
  // 双损坏：不改动任何文件，只报告（调用方确认后 archiveCorrupted 留证）。
  return { data: seedState(new Date().toISOString()), recoveredFromBackup: false, corrupted: true };
}

function saveState(dataDir, data) {
  const main = path.join(dataDir, FILE);
  if (fs.existsSync(main)) fs.copyFileSync(main, path.join(dataDir, BAK));
  const tmp = path.join(dataDir, TMP);
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, main);
}

function ensureWritable(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const probe = path.join(dataDir, '.writetest');
  try {
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
  } catch (e) {
    throw new Error(`数据目录不可写：${dataDir}`);
  }
}

function archiveCorrupted(dataDir) {
  const main = path.join(dataDir, FILE);
  const bak = path.join(dataDir, BAK);
  if (fs.existsSync(main)) fs.renameSync(main, `${main}.corrupt`);
  if (fs.existsSync(bak)) fs.renameSync(bak, `${bak}.corrupt`);
}

module.exports = { loadState, saveState, ensureWritable, archiveCorrupted };
