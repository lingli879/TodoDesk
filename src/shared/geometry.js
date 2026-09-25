'use strict';
// 窗口矩形与显示器的适配：多屏恢复、越界收回。纯函数。

const MARGIN = 16;

function intersectWorkArea(rect, workArea) {
  return rect.x < workArea.x + workArea.width
    && rect.x + rect.width > workArea.x
    && rect.y < workArea.y + workArea.height
    && rect.y + rect.height > workArea.y;
}

function fitInto(rect, workArea) {
  const width = Math.min(rect.width, workArea.width);
  const height = Math.min(rect.height, workArea.height);
  const x = Math.min(Math.max(rect.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(rect.y, workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

function fitRectToDisplays(rect, displays) {
  const target = displays.find((d) => intersectWorkArea(rect, d.workArea));
  if (target) return fitInto(rect, target.workArea);
  // 不与任何显示器相交（拔屏/改排列）→ 主屏（无主屏则第一个）工作区右下角。
  const wa = (displays.find((d) => d.primary) || displays[0]).workArea;
  const width = Math.min(rect.width, wa.width);
  const height = Math.min(rect.height, wa.height);
  return {
    x: wa.x + wa.width - width - MARGIN,
    y: wa.y + wa.height - height - MARGIN,
    width,
    height,
  };
}

module.exports = { fitRectToDisplays, MARGIN };
