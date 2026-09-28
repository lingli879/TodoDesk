'use strict';
// 看门狗：主进程被外部硬杀（explorer 强杀连带桌面贴死锁等）时自动拉起应用。
// 以 ELECTRON_RUN_AS_NODE=1 运行于同一 exe；优雅退出用标记文件区分；防循环重启。
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const GRACE_MS = 30000;         // 优雅标记有效期
const LOOP_WINDOW_MS = 120000;  // 循环判定窗口
const LOOP_MAX = 3;             // 窗口内最大重启次数

function decideRestart({ gracefulMarkAgeMs, recentRestartTimes, now }) {
  if (gracefulMarkAgeMs !== null && gracefulMarkAgeMs < GRACE_MS) return 'exit';
  const recent = recentRestartTimes.filter((t) => now - t < LOOP_WINDOW_MS);
  if (recent.length >= LOOP_MAX) return 'abort';
  return 'restart';
}

function main() {
  const ppid = parseInt(process.env.TD_WATCHDOG_PPID, 10);
  const mark = process.env.TD_WATCHDOG_MARK;
  const appDir = process.env.TD_WATCHDOG_APP;
  if (!ppid || !mark || !appDir) return;
  const iv = setInterval(() => {
    let alive = true;
    try { process.kill(ppid, 0); } catch { alive = false; }
    if (alive) return;
    clearInterval(iv);
    let age = null;
    try { age = Date.now() - fs.statSync(mark).mtimeMs; } catch { /* 无标记 = 暴毙 */ }
    const hist = `${mark}.history`;
    let times = [];
    try { times = JSON.parse(fs.readFileSync(hist, 'utf8')); } catch { /* 无史 */ }
    const decision = decideRestart({ gracefulMarkAgeMs: age, recentRestartTimes: times, now: Date.now() });
    if (decision === 'exit') { try { fs.unlinkSync(mark); } catch { /* 尽力 */ } process.exit(0); }
    if (decision === 'abort') { try { fs.unlinkSync(hist); } catch { /* 尽力 */ } process.exit(0); }
    times.push(Date.now());
    try { fs.writeFileSync(hist, JSON.stringify(times)); } catch { /* 尽力 */ }
    // 剥离 RUN_AS_NODE：新进程必须以 Electron 应用模式启动（继承自本看门狗的 env 会带上它）。
    // 不设 cwd：打包态 appDir 是 asar 文件路径，不能作 cwd（spawn 会失败）。
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    spawn(process.execPath, [appDir], { env, detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  }, 2000);
}

if (process.env.TD_WATCHDOG_PPID) main();
module.exports = { decideRestart };
