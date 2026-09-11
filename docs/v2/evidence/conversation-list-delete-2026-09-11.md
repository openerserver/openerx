# 对话列表删除入口 · 2026-09-11

历史列表、项目侧栏中的对话以及项目概览中的对话，均可从行末的垃圾桶按钮发起删除。按钮在悬停或键盘聚焦时显示；触摸设备直接显示。链接和删除按钮是独立控件，点击删除不会先切换对话。

删除入口与原对话工具栏共用确认窗口和现有 `deleteConversation` 接口。窗口明确显示对话标题，默认保留长期记忆；用户可选择同时删除仅来源于该对话的记忆。确认前不发送删除请求。处理中禁止重复提交和关闭；失败显示提示并允许重试。取消会恢复触发按钮的焦点。

删除其他对话时保留当前页面。删除当前对话时返回其项目概览，项目外对话返回新对话页。成功后同步刷新活动/归档历史、项目对话、搜索结果及项目数量。原有删除语义不变，应用内仍不能撤销删除。

## 验证

- 桌面 UI 测试共 83 项通过，新增覆盖历史删除的取消、焦点恢复、失败重试、防重复提交和页面保持，以及项目侧栏/概览删除后的导航、列表和数量更新。
- Electron 项目端到端测试通过。在独立临时配置中创建并删除测试对话，覆盖取消、Esc 和焦点恢复、从项目概览删除、从侧栏删除当前对话、返回项目空状态及所有列表同步。另验证新增控件不会引入页面外层滚动条。
- Desktop TypeScript、401 个源码文件的 V2 边界检查、`git diff --check` 通过。相关文件 Biome 无错误；App.tsx 保留此前的一项 warning 和一项 info。
- macOS arm64 构建已更新到本机原应用路径，签名校验通过。实际窗口核对了历史列表的删除入口和带有原对话标题的确认窗口，随后通过 Esc 取消，并恢复原对话页面。
- 与更新前 SQLite 备份逐行比较，11 个对话、51 条消息、1 个项目、14 个成果及14个成果版本均保持一致；实际删除仅发生在临时端到端测试配置中。

![列表删除按钮](/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/conversation-list-delete-20260911-173944/conversation-list-delete-e2e.png)

![删除确认窗口](/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/conversation-list-delete-20260911-173944/conversation-delete-dialog-e2e.png)

## Git 与恢复证据

上一项侧栏展开功能已独立提交为 `8471eb6`。本次列表删除改动另行提交，同一工作区中此前的其他修改保留。

检查点：`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/conversation-list-delete-20260911-173944/`，包含初始工作树、旧应用、SQLite 备份、构建、端到端日志、截图及运行核对记录。`delete-only.patch` 记录本次九个代码/样式/测试文件相对于开始时工作树的增量；`delete-staging.patch` 使用更窄的上下文，供混有已有工作区修改的 App.tsx 单独暂存。其他已有未提交文件逐字节保持一致。
