# 项目侧栏展开 · 2026-09-11

点击左侧项目名称会展开或收起项目对话，并保留右侧当前页面。子对话以缩进、层级线和单行标题显示；长标题省略，悬停可查看完整标题。点击子对话直接进入对话并高亮选中项。

每个项目独立展开。进入项目概览、项目新对话或已有项目对话时，自动展开所属项目；停留在当前页面时，用户仍可手动收起。项目行悬停或键盘聚焦时显示概览和新建入口，归档项目隐藏新建入口。对话归档筛选沿用侧栏现有开关。子列表复用历史查询，避免逐个项目重复读取全部对话。

## 验证

- 桌面 UI 测试：`npm run test --workspace @openerx/desktop -- tests/chat-ui.test.tsx`，80 项通过。
- 项目 Electron 端到端测试通过，覆盖项目展开/收起、Enter 操作、对话选中、项目内新建与返回原对话，以及原有目录设置、服务崩溃恢复、重启、归档和恢复流程。
- Desktop TypeScript、V2 源码边界检查、`git diff --check` 通过；相关文件 Biome 检查无错误，App.tsx 保留此前的一项 warning 和一项 info。
- macOS arm64 应用已构建并更新到本机原运行路径，`codesign --verify --deep --strict` 通过。
- 实际窗口已显示“外贸网站测试”及其下属对话。用户在核对期间继续操作了窗口，因此后续只读观察，未继续切换其页面。
- 此次本机启动最初记录 `APP_SERVICE_START_TIMEOUT`，自动重试后于 `2026-09-11T09:19:57.099Z` 记录 `service.ready`。最终项目列表及模型配置正常载入；未据此声称启动过程没有重试，也未修改服务启动逻辑。
- 与更新前 SQLite 备份逐行比较，11 个对话、51 条消息、1 个项目、14 个成果及14个成果版本均一致。

![实际侧栏](/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/project-sidebar-20260911-170842/sidebar-after.png)

## 恢复证据

检查点：`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/project-sidebar-20260911-170842/`。

包含工作树归档与补丁、旧应用、SQLite 备份、独立构建、端到端日志与截图、实际窗口前后截图、运行核对 JSON 和交付时 Git 状态。`sidebar-only.patch` 保存本次五个代码/样式/测试文件相对于开始时工作树的增量。交付核对时，开始前已有的其他未提交文件逐字节保持一致，Git 暂存区为空。此次 Git 提交仅包含上述侧栏增量及本记录；同一文件中已有的其他修改保留在工作区。
