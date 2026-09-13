# 成果与来源面板重设计 · 2026-09-11

范围：openerx Desktop 右侧的成果浏览、来源预览和运行记录。沿用现有主题、Phosphor 图标、成果快照及受控预览桥接，采用文件浏览与预览标签的工作区交互。

## 已实现

- “文件 / 来源 / 活动”分别显示计数和内容，列表独立滚动，入口与底部操作固定。
- 文件树采用紧凑单行布局，保留目录、完整路径提示和版本；搜索文件名或路径时展开命中目录，清除搜索后恢复原有目录状态。搜索中仍可折叠目录。
- 打开的成果和来源保留独立标签；相同名称甚至相同 ID 的不同对象按类型区分。来源标签显示回形针和“来源”字样。
- 预览与源码的选择按文件保留；关闭当前标签选择相邻文件，关闭最后一个回到列表。支持标签方向键、Home / End、Delete 和预览返回操作。
- 来源行直接调用 `previewFile`；管理工作区与附件另有明确入口。解析失败有独立状态。
- 列表加载、错误重试、空状态分别处理；任一分类加载失败不会阻断其他分类。成果下载继续使用原有另存接口和系统对话框。
- 面板支持加宽与收窄。加宽上限保留对话区空间，并约束对话内部网格，避免遮挡标题操作和发送区域。

## 验证

- `chat-ui.test.tsx` 与 `conversation-results.test.tsx` 共 96 项测试通过。
- Desktop TypeScript、V2 边界检查（403 个源码文件）、涉及文件 Biome 和 `git diff --check` 通过。App.tsx 原有一项 warning 和一项 info 保留；新增文件无检查问题。
- macOS arm64 应用构建完成，原路径安装后通过 `codesign --verify --deep --strict`。
- CUA 原生窗口验证：12 个成果、12 个来源、嵌套文件搜索、Markdown 与 HTML 预览、多标签切换、来源直接预览、关闭当前标签、加宽与收窄。
- SQLite `quick_check` 为 `ok`；安装前后全库 14 个成果、14 个版本的 ID、名称、版本号及内容摘要逐项相同。
- 仅进行了本机验证。没有执行远端发布或模型生成请求；没有检查 Windows、深色主题及全部小窗口断点。未声称完整无障碍合规或开发者控制台零错误。

本机重启后模型读取正在等待 macOS 系统凭据授权；SecurityAgent 已运行，CUA 明确禁止访问该系统组件。授权交由用户完成，未读取或更改凭据。面板浏览和文件预览已验证，模型入口恢复待用户授权后复核。

## 视觉迭代

1. 原面板把输出、来源和运行记录堆叠；新面板分别浏览，避免来源被长列表挤到下方。
2. 第一版预览有重复标题，压缩预览内容空间；精简为分类导航、文件标签与预览工具栏。
3. 加宽验证发现对话内部网格按内容撑开，发送区被右侧覆盖；限制宽度并使用 `minmax(0, 1fr)`，复查后标题可省略、工具入口与发送区域完整可见。

截图均在相同原生窗口通过 CUA 捕获，输出为 1162 × 768。数据副本中的模型提示和目录重连标记是隔离运行的差异，不是界面改动；安装后的原对话保留当前工作目录。

## 检查点与文件

检查点：`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/results-panel-20260911-181804/`。

- `working-tree.patch`、`staged.patch`、`working-tree-files.tar.gz`：实施前工作树备份。
- `desktop-before.app`、`desktop-replaced.app`、`profile-before-activation.sqlite`：旧应用和安装前数据库。
- `results-panel-only.patch`：相对于本次开始时文件内容的界面改动；`tests.json` / `tests.log`、`build.log`：验证记录。
- `runtime-verification.json`：安装后成果和版本不变的结构化证据。
- `before.png`、`live-files.png`：原面板与安装后的文件面板。
- `after-preview-compact.png`、`after-source-preview.png`：HTML 多标签和来源预览。
- `after-wide.png`、`after-wide-fixed.png`：加宽问题与修复后对照。

本次改动保留在工作树中，未改动暂存区。执行期间另一个任务产生提交 `4c27bbb`，该提交及实施前的其他改动均保留。
