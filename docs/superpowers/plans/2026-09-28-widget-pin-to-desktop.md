# 桌面贴「钉在桌面层」实现计划（WorkerW 父化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面贴 BrowserWindow 父化为桌面子窗口（SetParent 到 WorkerW），使 Win+D「显示桌面」不再最小化/恢复它，行为对齐 Rainmeter 类桌面小组件。

**Architecture:** 桌面贴当前是普通顶层窗口（`src/main/widget-window.js`），Win+D 枚举所有可见顶层窗口所以会波及它。新增 `src/main/desktop-host.js`：用 koffi 调 user32（FindWindow/EnumWindows/SetParent），把窗口附到「壁纸与桌面图标之间的 WorkerW」；附不上则逐级降级（Progman → 保持顶层窗口）。Explorer 重启会销毁 WorkerW 并连带销毁桌面贴 HWND，用 3 秒轮询 `IsWindow` 检测并自动重建窗口 + 重新附着。

**Tech Stack:** Electron 44（已有）、koffi（新增，N-API FFI，无需为 Electron rebuild）、user32.dll、node:test。

**Spec:** 本轮对话（2026-09-28）确定的方案：WorkerW 父化 + koffi 路线；**默认钉在桌面，不做设置项**。根因分析见对话记录：`alwaysOnTop:false` 只是不置顶，窗口仍是顶层窗口。

## Global Constraints

- 仅支持 Windows（打包 target 只有 `win dir`），user32 调用无需跨平台分支。
- 生产依赖只允许新增 `koffi` 一个。
- 不得破坏现有行为：多屏位置校正（`fitRectToDisplays`）、矩形去抖持久化、全局快捷键、托盘菜单、显示/隐藏切换、详情独立窗口。
- 代码风格：中文注释、轻量直接（参照 `src/shared/geometry.js`）、测试用 `node:test` + `node:assert`、中文测试名。
- koffi 是 N-API 模块，**不做** electron-rebuild。
- 所有 HWND 在模块内统一用 BigInt（koffi 的 `intptr_t` 返回 BigInt；`0n` 为无效值）。

## Review Focus

1. **Win+D / Win+M / 任务栏「显示桌面」**：桌面贴纹丝不动（核心验收，无法自动化 → Task 5 手动清单第 2 步）。
2. **Explorer 崩溃/重启**：WorkerW 销毁会连带销毁桌面贴 HWND，必须 3 秒内自动重生，不留半死窗口/白屏（轮询 `IsWindow` + `onLost` 重建 → Task 4；手动 `taskkill /f /im explorer.exe` → Task 5 第 6 步）。
3. **无 WorkerW 的边缘配置**（桌面图标被禁用等）：降级附到 Progman；连 Progman 都没有（理论上不可能）：保持普通顶层窗口不崩溃（`chooseHost` 三分支单测 → Task 2）。
4. **多屏（含负坐标副屏）**：WorkerW 客户区原点即虚拟屏幕 (0,0)，与 Electron 全局坐标同源，坐标不得漂移（Task 5 手动第 4 步含跨屏拖动）。
5. **父化后交互回归**：`-webkit-app-region: drag` 拖动（`widget.css:34`）、边缘缩放、勾选/hover 图标、透明效果（Task 5 手动第 4-5 步；若 drag 失效走备选方案，见 Task 5 末尾）。
6. **打包产物可用性**：koffi 的 .node 二进制必须在 dist 里且可加载（asarUnpack 配置 → Task 5 第 7 步真机验证）。

---

### Task 1: 引入 koffi 并冒烟验证 user32 绑定

**Files:**
- Modify: `package.json`（dependencies + build.asarUnpack）

**Interfaces:**
- Consumes: 无
- Produces: `node_modules/koffi` 可用；`package.json` 的 `build.asarUnpack` 含 koffi（后续任务与打包都依赖）

- [ ] **Step 1: 安装 koffi**

```bash
cd E:/apps/TodoDesk && npm install koffi --save
```

- [ ] **Step 2: 冒烟验证——能从 user32 找到 Progman**

Run（一次性命令，不进测试套件；用 `intptr_t` 声明 HWND 是刻意的：指针与整数在 win-x64 调用约定下同布局，返回 BigInt 便于比较与传参）:

```bash
cd E:/apps/TodoDesk && node -e "
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');
const FindWindowW = user32.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)');
const hwnd = FindWindowW('Progman', null);
if (hwnd === 0n) { console.error('FAIL: Progman not found'); process.exit(1); }
console.log('OK: Progman hwnd =', hwnd);
"
```

Expected: 输出 `OK: Progman hwnd = <BigInt>`。若报类型/符号错误，在此步解决（调整 koffi 签名写法），不得带入后续任务。

- [ ] **Step 3: 配置打包解包规则**

`package.json` 的 `build` 块加（koffi 含平台 .node 二进制，asar 内无法 dlopen）：

```json
"asarUnpack": [
  "node_modules/koffi/**"
]
```

- [ ] **Step 4: 确认存量测试不受影响**

Run: `cd E:/apps/TodoDesk && npm test`
Expected: 全部通过（本任务不动代码，防环境被安装步骤破坏）。

- [ ] **Step 5: Commit**

```bash
cd E:/apps/TodoDesk && git add package.json package-lock.json && git commit -m "build: 引入 koffi（user32 绑定）并配置 asar 解包"
```

### Task 2: 桌面宿主选择纯函数 chooseHost（TDD）

**Files:**
- Create: `src/main/desktop-host.js`
- Test: `tests/desktop-host.test.js`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `chooseHost({ progman: BigInt, workerW: BigInt }) => BigInt | null`——workerW 非零返回 workerW；否则 progman 非零返回 progman；都为 0 返回 null（降级保持顶层窗口）。Task 3 的 `findDesktopHost()` 返回值直接复用其返回值语义。

- [ ] **Step 1: 写失败测试**

`tests/desktop-host.test.js`：

```js
const test = require('node:test');
const assert = require('node:assert');

// chooseHost 是纯函数，不触发 koffi 加载（desktop-host 对原生绑定惰性初始化）
const { chooseHost } = require('../src/main/desktop-host');

test('有 WorkerW → 附着它（壁纸与图标之间）', () => {
  assert.equal(chooseHost({ progman: 11n, workerW: 22n }), 22n);
});

test('无 WorkerW 但有 Progman → 降级附着 Progman', () => {
  assert.equal(chooseHost({ progman: 11n, workerW: 0n }), 11n);
});

test('两者皆无 → 返回 null，保持普通顶层窗口', () => {
  assert.equal(chooseHost({ progman: 0n, workerW: 0n }), null);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd E:/apps/TodoDesk && node --test tests/desktop-host.test.js`
Expected: FAIL——`Cannot find module '../src/main/desktop-host'`。

- [ ] **Step 3: 最小实现**

`src/main/desktop-host.js`：

```js
'use strict';
// 桌面层附着：把桌面贴 SetParent 到 WorkerW（壁纸与桌面图标之间），
// 使其不受 Win+D「显示桌面」影响（Rainmeter 式）。koffi 为 N-API，无需为 Electron rebuild。
// 所有 HWND 用 BigInt（koffi 的 intptr_t 返回 BigInt，0n 为无效）。

function chooseHost({ progman, workerW }) {
  if (workerW) return workerW; // 首选：图标层之下的 WorkerW，不遮挡桌面图标
  if (progman) return progman; // 退化：直接附 Progman（此时会浮在图标之上，罕见配置）
  return null;                 // 找不到桌面层：保持普通顶层窗口（仍会被 Win+D 波及）
}

module.exports = { chooseHost };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd E:/apps/TodoDesk && node --test tests/desktop-host.test.js`
Expected: 3 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
cd E:/apps/TodoDesk && git add src/main/desktop-host.js tests/desktop-host.test.js && git commit -m "feat: 桌面宿主选择纯函数 chooseHost"
```

### Task 3: 原生附着与自愈轮询（findDesktopHost / attachWidgetToDesktop）

**Files:**
- Modify: `src/main/desktop-host.js`
- Test: `tests/desktop-host.test.js`（追加 smoke 测试）

**Interfaces:**
- Consumes: Task 2 的 `chooseHost`；Electron `BrowserWindow`（仅用 `getNativeWindowHandle` / `isDestroyed`，不 require electron——测试环境无 Electron）。
- Produces:
  - `findDesktopHost() => BigInt | null`——返回 WorkerW/Progman 的 HWND。
  - `attachWidgetToDesktop(win, { onLost }) => { attached: boolean, stop(): void }`——Task 4 在 `widget-window.js` 里对 BrowserWindow 调用；`onLost()` 在桌面贴 HWND 被外部销毁（Explorer 重启）时回调恰好一次。

- [ ] **Step 1: 追加失败测试（smoke：真桌面会话能找到宿主）**

追加到 `tests/desktop-host.test.js` 末尾（非 win32 自动跳过；本项目仅打包 win，但测试文件保持可移植）：

```js
const { findDesktopHost } = require('../src/main/desktop-host');

test('真桌面会话能找到宿主窗口（win32 smoke）', { skip: process.platform !== 'win32' }, (t) => {
  const host = findDesktopHost();
  assert.ok(host === null || typeof host === 'bigint', '返回 null 或 BigInt');
  // 有交互桌面时必须找到 Progman；无桌面会话（SSH/服务）时才允许 null
  if (process.env.SESSIONNAME && !process.env.SESSIONNAME.includes('Service')) {
    assert.ok(typeof host === 'bigint' && host !== 0n, '桌面会话中 Progman 必然存在');
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd E:/apps/TodoDesk && node --test tests/desktop-host.test.js`
Expected: FAIL——`findDesktopHost is not a function`（或 undefined）。

- [ ] **Step 3: 实现原生绑定 + 附着 + 轮询**

在 `src/main/desktop-host.js` 的 `module.exports` 之前追加（保持 `chooseHost` 在上，导出更新为三者）：

```js
const koffi = require('koffi');

const WM_SPAWN_WORKERW = 0x052c; // 让 Explorer 在壁纸与图标之间生成 WorkerW
const SMTO_NORMAL = 0x0000;
const POLL_MS = 3000; // Explorer 重启自愈检测周期

let user32 = null;
function u32() {
  // 惰性加载：require 本模块（如单测 chooseHost）不触发原生 dlopen
  if (!user32) {
    user32 = koffi.load('user32.dll');
    user32.functions = {
      FindWindowW: user32.func('intptr_t FindWindowW(const wchar_t *lpClassName, const wchar_t *lpWindowName)'),
      FindWindowExW: user32.func('intptr_t FindWindowExW(intptr_t hWndParent, intptr_t hWndChildAfter, const wchar_t *lpszClass, const wchar_t *lpszWindow)'),
      EnumWindows: user32.func('BOOL EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)'),
      SendMessageTimeoutW: user32.func('intptr_t SendMessageTimeoutW(intptr_t hWnd, UINT Msg, intptr_t wParam, intptr_t lParam, UINT fuFlags, UINT uTimeout, intptr_t *lpdwResult)'),
      SetParent: user32.func('intptr_t SetParent(intptr_t hWndChild, intptr_t hWndNewParent)'),
      IsWindow: user32.func('BOOL IsWindow(intptr_t hWnd)'),
    };
  }
  return user32.functions;
}

// SHELLDLL_DefView（桌面图标层）可能挂在 Progman 或某个 WorkerW 下，枚举顶层窗口定位其宿主
function findShellDefViewHost() {
  const { FindWindowExW, EnumWindows } = u32();
  const EnumWindowsProc = koffi.proto('BOOL EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  let host = 0n;
  const cb = koffi.register((hwnd) => {
    if (FindWindowExW(hwnd, 0n, 'SHELLDLL_DefView', null) !== 0n) host = hwnd;
    return 1; // 继续枚举
  }, EnumWindowsProc);
  try { EnumWindows(cb, 0n); } finally { koffi.unregister(cb); }
  return host;
}

function findDesktopHost() {
  const { FindWindowW, FindWindowExW, SendMessageTimeoutW } = u32();
  const progman = FindWindowW('Progman', null);
  if (progman === 0n) return null;
  const afterDefView = () => {
    const host = findShellDefViewHost();
    return host === 0n ? 0n : FindWindowExW(0n, host, 'WorkerW', null);
  };
  let workerW = afterDefView();
  if (workerW === 0n) {
    // 边缘配置（如禁用桌面图标）下没有 WorkerW：请 Explorer 生成一个再找
    const out = [0n];
    SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0n, 1n, SMTO_NORMAL, 1000, out);
    workerW = afterDefView();
  }
  return chooseHost({ progman, workerW });
}

function readHwnd(win) {
  const buf = win.getNativeWindowHandle();
  return process.arch === 'x64' ? buf.readBigUInt64LE(0) : buf.readBigUInt32LE(0);
}

// 附着桌面贴到桌面层；onLost 在 HWND 被外部销毁（Explorer 重启连带 WorkerW 销毁）时回调一次
function attachWidgetToDesktop(win, { onLost } = {}) {
  const { SetParent, IsWindow } = u32();
  const hwnd = readHwnd(win);
  let attached = false;
  const host = findDesktopHost();
  if (host) {
    try { SetParent(hwnd, host); attached = true; } catch { /* 附着失败：降级为普通顶层窗口 */ }
  }
  const timer = setInterval(() => {
    if (win.isDestroyed()) { stop(); return; }
    if (IsWindow(hwnd) === 0) { stop(); if (onLost) onLost(); }
  }, POLL_MS);
  function stop() { clearInterval(timer); }
  return { attached, stop };
}

module.exports = { chooseHost, findDesktopHost, attachWidgetToDesktop };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd E:/apps/TodoDesk && node --test tests/desktop-host.test.js`
Expected: 4 个测试 PASS（smoke 在本机 Windows 桌面会话应找到宿主）。

- [ ] **Step 5: 全量回归**

Run: `cd E:/apps/TodoDesk && npm test`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd E:/apps/TodoDesk && git add src/main/desktop-host.js tests/desktop-host.test.js && git commit -m "feat: WorkerW 原生附着与 Explorer 重启自愈轮询"
```

### Task 4: 集成到桌面贴窗口（附着 + 丢失重建）

**Files:**
- Modify: `src/main/widget-window.js:18-59`（createWidgetWindow 签名与 ready-to-show）
- Modify: `src/main/main.js:109-126`（createWidget 传 onWidgetLost）

**Interfaces:**
- Consumes: Task 3 的 `attachWidgetToDesktop(win, { onLost })`。
- Produces: `createWidgetWindow({ getSettings, onRectChanged, onWidgetLost })`——第三参数为可选回调，桌面贴 HWND 丢失时由 `attachWidgetToDesktop` 触发，`main.js` 负责重建。

- [ ] **Step 1: widget-window.js 集成附着**

`src/main/widget-window.js` 顶部 require 区加：

```js
const { attachWidgetToDesktop } = require('./desktop-host');
```

`createWidgetWindow` 签名改为 `function createWidgetWindow({ getSettings, onRectChanged, onWidgetLost })`，并把 `win.once('ready-to-show', ...)` 一行替换为（先 show 再父化：坐标原点相同无跳变，且避免透明窗口在 DWM 下的时序问题）：

```js
  win.once('ready-to-show', () => {
    win.show();
    // 钉在桌面层：父化到 WorkerW，Win+D「显示桌面」不再波及（Rainmeter 式）。
    // 附着失败（罕见）自动降级为普通顶层窗口，功能不受影响。
    attachWidgetToDesktop(win, { onLost: onWidgetLost });
  });
```

同时更新文件头注释（第 2 行）：`非置顶` 语义已变为 `钉桌面层`，改为：

```js
// 桌面贴窗口：透明/无边框/钉在桌面层（WorkerW 父化，不受 Win+D 影响）/可缩放、多屏位置恢复、矩形去抖持久化、全局快捷键。
```

并把 `alwaysOnTop: false` 行的行尾注释改为：

```js
    alwaysOnTop: false, // 层级由 WorkerW 父化决定（见 ready-to-show 中 attachWidgetToDesktop）
```

- [ ] **Step 2: main.js 加丢失重建**

`src/main/main.js` 的 `createWidget` 改为（`onWidgetLost` 是唯一重建路径；`closed` 监听只置 null 不重建，避免双触发）：

```js
function createWidget() {
  widgetWin = createWidgetWindow({
    getSettings: () => state.settings,
    onRectChanged: ({ position, size }) => {
      state.settings.widgetPosition = position;
      state.settings.widgetSize = size;
      saveStateNow();
    },
    // Explorer 重启等导致桌面贴原生窗口被销毁时的自愈：重建并重新附着
    onWidgetLost: () => {
      if (quitting) return;
      if (widgetWin && !widgetWin.isDestroyed()) {
        try { widgetWin.destroy(); } catch { /* 半死状态，忽略 */ }
      }
      widgetWin = null;
      logger.write(dataDir, '桌面贴原生窗口丢失（Explorer 重启？），已自动重建');
      createWidget();
    },
  });
  widgetWin.on('closed', () => { widgetWin = null; });
  const ok = applyHotkey(state.settings.hotkey, toggleWidget);
  if (!ok) {
    logger.write(dataDir, `快捷键注册失败：${state.settings.hotkey}`);
    try {
      new Notification({ title: 'TodoDesk', body: '全局快捷键注册失败，可在设置中修改' }).show();
    } catch { /* 忽略 */ }
  }
}
```

- [ ] **Step 3: 语法与冒烟启动**

Run: `cd E:/apps/TodoDesk && node -e "require('./src/main/widget-window.js'); require('./src/main/desktop-host.js'); console.log('syntax OK')"`
Expected: `syntax OK`（这两个模块不 require electron 本体，可直接加载验证语法）。
注：`main.js` require 了 electron，无法脱离 Electron 加载，语法由下一步覆盖。

Run: `cd E:/apps/TodoDesk && npm start`（观察 5 秒后手动关闭）
Expected: 桌面贴正常显示且立即「沉」到桌面层——打开任意窗口拖过桌面贴上方，窗口应盖住它。

- [ ] **Step 4: 全量回归**

Run: `cd E:/apps/TodoDesk && npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd E:/apps/TodoDesk && git add src/main/widget-window.js src/main/main.js && git commit -m "feat: 桌面贴钉在桌面层（Win+D 不再波及）与丢失自愈"
```

### Task 5: 手动验收 + 打包验证

**Files:**
- 无代码改动（验证任务；发现问题则回改，修复须回到对应 Task 的测试）

**Interfaces:**
- Consumes: 完整应用 + dist 打包产物。
- Produces: 验收结论（逐项记录实际结果，任何一步不符合即停并回到 Phase 1 调查）。

- [ ] **Step 1: 核心行为验收（npm start）**

逐项执行并记录：

1. `npm start` → 桌面贴显示在桌面。
2. 打开记事本 → 按 **Win+D** → 记事本最小化，**桌面贴仍在桌面**；再按 **Win+D** → 记事本恢复，桌面贴无任何变化（核心验收点）。
3. 悬停任务栏最右侧「显示桌面」按钮（Aero Peek）→ 桌面贴可见（桌面元素语义，符合预期）。
4. 拖动桌面贴标题栏 → 正常移动；拖边缘 → 正常缩放；移动到另一台显示器（若有）→ 坐标不漂移；重启应用 → 位置恢复。
5. 勾选完成、hover 操作图标、打开详情窗编辑保存 → 全部正常（详情窗是普通顶层窗口，行为不变）。
6. 任务管理器 → 重启 Windows 资源管理器（或 `taskkill /f /im explorer.exe && start explorer`）→ **3~6 秒内桌面贴自动重现**且 Win+D 验收（第 2 步）仍通过。

- [ ] **Step 2: 打包验证**

```bash
cd E:/apps/TodoDesk && npm run dist
```

Run: 启动 `dist/win-unpacked/TodoDesk.exe`，重复 Step 1 的第 2、4 步。
Expected: 打包产物中 koffi 可加载（asarUnpack 生效），行为与开发态一致。同时确认 `dist/win-unpacked/resources/app.asar.unpacked/node_modules/koffi/` 存在 .node 文件。

- [ ] **Step 3: 收尾**

- 本任务无代码改动则直接记录结果；有回改则修复后重跑相关 Task 测试 + `npm test`。

**Contingency（第 4 步拖动失效时）**：若 `-webkit-app-region: drag` 在跨进程子窗口上失效（HTCAPTION 不被系统处理），备选方案是改用主进程拖拽——`widget.js` 的 `#dragHandle` mousedown 经 IPC 报增量、主进程 `win.setPosition` 移动。此为独立后续任务，不预先实现。

---

## Self-Review 结论

1. **Spec 覆盖**：默认钉桌面无设置项（Task 3/4 直接附着，无设置开关）✓；Win+D 不波及（WorkerW 父化 + Task 5 验收）✓；Explorer 自愈（轮询 + onLost 重建，Task 3/4）✓；降级策略（chooseHost + try/catch，Task 2/3）✓。
2. **占位符扫描**：无 TBD/TODO；Contingency 段是明确的「不预先实现」决策而非欠账。
3. **类型一致性**：`chooseHost({progman: BigInt, workerW: BigInt}) → BigInt|null`（Task 2 定义、Task 3 调用）✓；`attachWidgetToDesktop(win, {onLost}) → {attached, stop}`（Task 3 定义、Task 4 调用仅用副作用，返回值未消费——保留供调试）✓；`createWidgetWindow({getSettings, onRectChanged, onWidgetLost})`（Task 4 双侧一致）✓。
4. **Review Focus 落位**：1→Task5.2；2→Task3 轮询+Task4 重建+Task5.6；3→Task2 单测三分支；4→Task5.4；5→Task5.4/5；6→Task1.3+Task5.2。

---

### Task 6: 看门狗进程（explorer 强杀自愈，计划执行期补充）

**Files:**
- Create: `src/main/watchdog.js`
- Modify: `src/main/main.js`（startWatchdog + exitApp 优雅标记）
- Test: `tests/desktop-host.test.js`（追加 decideRestart 纯函数测试）

**背景（Task 5 验收发现）**：explorer 被 TerminateProcess 强杀时，父化到 WorkerW 的桌面贴触发 UI 线程死锁，整个 Electron 进程被硬终止且无任何事件可自救。看门狗以 `ELECTRON_RUN_AS_NODE=1` 运行于同一 exe，轮询探活主进程 ppid；主进程消失时：优雅标记（30 秒内）→ 静默退出；2 分钟内已重启 ≥3 次 → 放弃（防循环风暴）；否则 → 重新拉起应用。

**Interfaces:**
- Consumes: 无（独立进程，仅依赖 node 内置模块与环境变量 TD_WATCHDOG_PPID/TD_WATCHDOG_MARK/TD_WATCHDOG_APP）
- Produces: `decideRestart({ gracefulMarkAgeMs, recentRestartTimes, now }) → 'exit' | 'restart' | 'abort'`（纯函数，watchdog.js 导出供测试）；main.js 在 bootstrap 启动看门狗、exitApp 写优雅标记

- [ ] **Step 1: 写失败测试**（tests/desktop-host.test.js 追加）

```js
const { decideRestart } = require('../src/main/watchdog');

test('优雅退出标记 30 秒内 → 不重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: 5000, recentRestartTimes: [], now: 1000000 }), 'exit');
});

test('无标记且未达循环上限 → 重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [], now: 1000000 }), 'restart');
});

test('2 分钟内已重启 3 次 → 放弃（防循环）', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [999000, 995000, 890000], now: 1000000 }), 'abort');
});

test('重启史超过 2 分钟前 → 不算循环，照常重启', () => {
  assert.equal(decideRestart({ gracefulMarkAgeMs: null, recentRestartTimes: [500000, 400000, 300000], now: 1000000 }), 'restart');
});
```

- [ ] **Step 2: RED** — `node --test tests/desktop-host.test.js`，期望 `Cannot find module '../src/main/watchdog'`
- [ ] **Step 3: GREEN** — 实现 `src/main/watchdog.js`（纯函数 + 探活循环 + 拉起逻辑，见下）

```js
'use strict';
// 看门狗：主进程被外部硬杀（explorer 强杀连带桌面贴死锁等）时自动拉起应用。
// 以 ELECTRON_RUN_AS_NODE=1 运行于同一 exe；优雅退出用标记文件区分；防循环重启。
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const GRACE_MS = 30000;    // 优雅标记有效期
const LOOP_WINDOW_MS = 120000; // 循环判定窗口
const LOOP_MAX = 3;        // 窗口内最大重启次数

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
    if (decision === 'exit') { try { fs.unlinkSync(mark); } catch {} process.exit(0); }
    if (decision === 'abort') { try { fs.unlinkSync(hist); } catch {} process.exit(0); }
    times.push(Date.now());
    try { fs.writeFileSync(hist, JSON.stringify(times)); } catch { /* 尽力 */ }
    spawn(process.execPath, [appDir], { detached: true, stdio: 'ignore', cwd: appDir }).unref();
    process.exit(0);
  }, 2000);
}
if (process.env.TD_WATCHDOG_PPID) main();
module.exports = { decideRestart };
```

- [ ] **Step 4: GREEN + 全量** — `node --test tests/desktop-host.test.js` PASS；`npm test` 全绿
- [ ] **Step 5: main.js 集成** — bootstrap 末尾 `startWatchdog()`；`exitApp()` 在 destroy 前写优雅标记：

```js
function startWatchdog() {
  const mark = path.join(dataDir, '.graceful-exit');
  try { fs.unlinkSync(mark); } catch { /* 无残留 */ }
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    TD_WATCHDOG_PPID: String(process.pid),
    TD_WATCHDOG_MARK: mark,
    TD_WATCHDOG_APP: app.getAppPath(),
  };
  spawn(path.join(__dirname, 'watchdog.js'), { env, detached: true, stdio: 'ignore' }).unref();
}
```
注：spawn 的 file 用 `process.execPath`（当前 exe，开发态 electron.exe/打包态 TodoDesk.exe），args 为 `[watchdog.js 路径]`：
`spawn(process.execPath, [path.join(__dirname, 'watchdog.js')], { env, detached: true, stdio: 'ignore' }).unref()`

exitApp 开头追加：
```js
  try { fs.writeFileSync(path.join(dataDir, '.graceful-exit'), String(Date.now())); } catch { /* 尽力 */ }
```
main.js 顶部补 `const fs = require('node:fs');`（如尚无）与 spawn import。

- [ ] **Step 6: 实测自愈** — 启动 app → `taskkill /f /im explorer.exe` → 确认 electron 死后 2-6 秒内自动回来且 widget 重新附着（扫 Progman 子树）；`start explorer` 恢复桌面
- [ ] **Step 7: 实测优雅退出不复生** — 托盘退出（或 taskkill /pid 主进程）后 10 秒内无新 electron 进程
- [ ] **Step 8: 全量回归 + Commit** — `npm test` 全绿；commit "feat: 看门狗进程兜底 explorer 强杀导致的进程死亡"
