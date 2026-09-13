# Desktop 剪贴板附件验证 — 2026-09-12

对话输入框支持通过 ⌘V / Ctrl+V 粘贴剪贴板中的图片和文件。附件显示为待发送卡片，图片有缩略图，可以移除，点击发送后才关联到消息。纯文字及从表格复制的单元格继续按文字粘贴，并保留输入框已有草稿。

支持的类型与附件选择器共用 `packages/contracts/src/file-formats.ts`：PDF、DOCX、PPTX、XLS/XLSX、CSV/TSV、PNG/JPEG/GIF/WebP，以及已有的文本、结构化数据、网页和代码格式。每次粘贴最多 100 个文件、总计 50 MiB；不支持的格式、读取失败和超限情况会显示错误。导入期间暂停发送，切换对话后的迟到结果不会追加到另一个对话。

Renderer 读取粘贴事件提供的 File 字节，经 `file.importData` 合约和可信 IPC 导入现有内容存储，复用解析、预览、引用、附件关联和模型文件工具。该入口只接受文件名与有界字节内容，不接受本地路径，也不会将剪贴板文字解释为文件系统权限。服务端再次检查类型、编码和大小，并在写入前验证整批输入。

## 验证结果

- 577 项相关测试通过：Desktop 293、AppService 92、Contracts 81、Storage 82、FileService 29。
- 以上五个工作区 TypeScript 检查通过；409 个源文件的边界检查通过；`git diff --check` 通过。
- 全仓 Biome 检查无错误，保留既有 117 条 warning 和 1 条 info；最终修改文件格式检查通过。
- Electron 原生剪贴板 E2E 通过：文字及表格单元格、PNG 图片预览、macOS 复制 XLS 文件、移除附件、混合附件发送、Pi 文件工具读取和重启持久化。测试保存并恢复原剪贴板；如果用户在测试期间复制新内容则保留新内容。
- XLS 粘贴测试通过 macOS `public.file-url` 剪贴板格式提供测试文件，实际触发 ⌘V，由 Renderer 接收 File 并导入其字节。测试删除源文件并重启后仍可读取已保存附件。
- macOS arm64 应用打包、严格签名检查和本机更新完成；恢复更新前的对话页面并确认附件按钮包含粘贴提示。
- 本机数据库逐行比对通过：12 个对话、53 条消息、12 个个人文件、12 个附件、43 个引用、1 个项目、14 个成果、14 个成果版本未改变。

测试的模型调用采用隔离 profile 和 faux provider，用于验证 Pi 文件工具及附件链路，不构成真实远程模型调用证明。Windows Ctrl+V 使用相同粘贴事件处理，但此次未在 Windows 实机验证。

日志、输入框截图、原应用及数据库备份保存在本机 `openerx-checkpoints/clipboard-attachments-20260912-095846/`。原生剪贴板测试接口参考 [Electron Clipboard 文档](https://www.electronjs.org/docs/latest/api/clipboard)。
