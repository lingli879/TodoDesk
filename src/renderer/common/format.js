// 时间格式化：ISO(UTC) 存储 ↔ 本地显示/输入。渲染层共享。
const p = (n) => String(n).padStart(2, '0');

export function fmtTime(iso) {
  const d = new Date(iso);
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDateTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

export function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function localInputToIso(str) {
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// 耗时（小时，0.5 步进四舍五入）：与主进程 computeDurationHours（shared/model.js）语义一致；
// 渲染层为 ESM 无法直接复用 CJS 模块，两处需同步维护。时间缺失/倒挂 → null。
export function durationHoursBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0) return null;
  return Math.round(ms / 1800000) / 2;
}

export function fmtHours(v) {
  return v == null ? '—' : `${v}h`;
}
