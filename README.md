# TodoDesk — 透明桌面待办清单

Windows 桌面待办事项软件，两个窗口：

- **桌面贴**：透明、置顶、半透明的悬浮清单。点空白处直接打字新建、点标题改名、点勾选完成；⠿ 手柄拖动排序；右键菜单更多操作。全局快捷键（默认 `Ctrl+Alt+T`）显示/隐藏。
- **主程序**：全功能管理——待办管理（按状态/分类/日期筛选，历史完成查看）、分类管理与桌面贴展示配置、设置。

每个待办有三个时间：**开始**（默认=创建时刻）、**完成**（默认=勾选完成的时刻）、**截止**（可选），均可在详情面板或主程序里人工调整。

## 数据与迁移

- 数据存放在**软件目录下的 `data\`**（`data.json` + 自动备份 `data.json.bak`），便携式设计
- **迁移/备份 = 拷贝整个软件目录**
- 不要把软件放在 `C:\Program Files` 等无写权限目录（启动会明确报错）
- 运行日志在 `data\log.txt`

## 界面主题

跟随 Windows 明暗主题自动切换（浅色「清新薄荷」/ 深色「夜杉绿」），无需设置。

## 开发

```bash
npm install          # 安装依赖（electron 二进制下载慢时：export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/）
npm start            # 开发运行
npm test             # 单元测试（数据层）
npm run dist         # 打包目录版便携应用 → dist/win-unpacked/
```

- 技术栈：Electron（无前端框架、无构建步骤，原生 ES Modules）
- 架构：主进程持有数据与业务逻辑（`src/shared/model.js` 纯函数 + `store.js` 文件层），两个渲染窗口通过 contextBridge 受控 IPC 读写
- 设计文档：`docs/superpowers/specs/2026-09-25-tododesk-design.md`；实施计划：`docs/superpowers/plans/2026-09-25-tododesk.md`
