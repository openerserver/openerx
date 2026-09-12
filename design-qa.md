# 成果与来源面板视觉检查 · 2026-09-11

Source visual truth: `/var/folders/1v/0886jgvs7hg9chd3jqlcnxfm0000gn/T/codex-clipboard-a7946b84-514d-4045-b7af-1a72edd8d446.png`，以及相同原生窗口捕获的检查点 `before.png`。目标是按用户要求重设计既有面板，文件分类、密度和标签布局的差异是有意调整。

Implementation screenshots: `/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/results-panel-20260911-181804/` 中的 `live-files.png`、`after-preview-compact.png`、`after-source-preview.png`、`after-wide-fixed.png`。

Viewport: 桌面默认窗口配置 1240 × 820；CUA 输出的基线和实现截图均为 1162 × 768。使用同一窗口与捕获通道直接比较，没有额外拉伸；没有测量浏览器 CSS viewport 或设备像素比，因此不声称逐 CSS 像素复刻。

State: 浅色主题、同一外贸网站对话；文件概览、两个成果标签、来源 README 标签和加宽阅读。预览副本缺少本机凭据，所以截图中的模型提示与原窗口不同；正式安装后的模型读取仍需系统钥匙串授权。

## 对照与修复

- Full-view comparison: 已把 `before.png` 与 `after-files.png`、`before.png` 与 `live-files.png` 放在同次图像输入中比较，确认面板密度、独立滚动区域、固定导航及对话相邻关系。
- [P2，已修复] 第一版预览标题层级冗余。证据 `after-html-preview.png` → `after-preview-compact.png`；移除预览状态的重复标题行，保留分类和文件标签，内容区向上扩展。
- [P2，已修复] 加宽状态对话网格撑开并被面板覆盖。证据 `after-wide.png` → `after-wide-fixed.png`，两张已放在同次图像输入中比较；限制加宽上限，设置对话内部单列 `minmax(0, 1fr)`。修复后标题省略、工作目录入口、输入框与发送区域均可见。
- Focused comparison: 右侧窄面板和预览工具栏在 1162 × 768 原始截图中可直接辨认，已逐项检查文件行、版本号、标签边界、关闭控件和来源徽标；没有裁切后放大来补造细节。

## 必检项目

- 字体：沿用应用字体；面板 11–13px 的功能层级、文件名单行省略、来源状态和版本次级显示。正文预览沿用原 Markdown / HTML 渲染器。
- 间距：32px 文件行、紧凑目录缩进、固定工具栏、独立内容滚动；默认与加宽状态无已知面板控件裁切。
- 颜色：沿用 `--workspace-*` 主题变量，激活下划线和悬停态延续现有中性色；键盘焦点使用现有强调色。
- 图像与图标：沿用 Phosphor 和既有内容，没有为界面生成位图或替换用户网页资产；HTML 成果的相对资源正常显示。
- 文案：文件 / 来源 / 活动、文件路径、版本、解析状态、全部成果、管理来源均对应真实数据或操作，不把运行实现细节放进界面。

## 验证范围和待完成项

96 项相关组件和聊天回归通过；原生交互覆盖搜索、文档与 HTML、多标签、来源、关闭及面板宽度。检查了启动诊断中的 `service.ready`，没有将其等同于开发者控制台检查。Windows、深色主题及所有窄窗断点未做视觉验证。

当前没有未解决的面板视觉 P0/P1/P2；完整桌面交接还等待用户完成 macOS 钥匙串授权并复核模型入口。系统限制禁止 CUA 操作 SecurityAgent，未绕过该限制。

final result: blocked

Implementation checklist: 完成系统授权后复核原有模型入口，更新运行记录和最终检查结果。
