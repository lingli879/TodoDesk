'use strict';
// 简单运行日志：追加 <dataDir>/log.txt，超 1MB 轮转为 log.old.txt（覆盖旧的）。
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1024 * 1024;

function write(dataDir, line) {
  try {
    const file = path.join(dataDir, 'log.txt');
    try {
      const st = fs.statSync(file);
      if (st.size > MAX_BYTES) fs.renameSync(file, path.join(dataDir, 'log.old.txt'));
    } catch { /* 文件尚不存在 */ }
    const ts = new Date().toLocaleString('zh-CN', { hour12: false });
    fs.appendFileSync(file, `[${ts}] ${line}\n`, 'utf8');
  } catch { /* 日志失败不影响主流程 */ }
}

module.exports = { write };
