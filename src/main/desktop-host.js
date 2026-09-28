'use strict';
// 桌面层附着：把桌面贴 SetParent 到 WorkerW（壁纸与桌面图标之间），
// 使其不受 Win+D「显示桌面」影响（Rainmeter 式）。koffi 为 N-API，无需为 Electron rebuild。
// 句柄统一为 number（koffi 的 intptr_t 返回值），有效性用 truthiness 判断（0 为无效）。

function chooseHost({ progman, workerW }) {
  if (workerW) return workerW; // 首选：图标层之下的 WorkerW，不遮挡桌面图标
  if (progman) return progman; // 退化：直接附 Progman（此时会浮在图标之上，罕见配置）
  return null;                 // 找不到桌面层：保持普通顶层窗口（仍会被 Win+D 波及）
}

module.exports = { chooseHost };
