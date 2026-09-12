# Desktop XLS 附件验证 — 2026-09-12

点击对话输入框的附件按钮时，旧版 Excel `.xls` 被文件选择器排除，后端也没有对应解析器。本次补齐原生选择、受控副本导入、内容解析、预览、模型文件工具读取和重启恢复。

## 支持的附件

| 类别 | 扩展名 |
| --- | --- |
| 文档、演示文稿 | pdf、docx、pptx |
| 表格 | xls、xlsx、csv、tsv |
| 图片 | png、jpg、jpeg、gif、webp |
| 文本、结构化数据 | txt、md、markdown、json、yaml、yml |
| 网页、矢量文件 | html、htm、svg、xml |
| 代码 | c、cpp、css、go、java、js、jsx、kt、m、mjs、php、py、rb、rs、sh、sql、swift、ts、tsx、vue |

`packages/contracts/src/file-formats.ts` 是附件扩展名与 MIME 类型的共同来源，Electron 选择器和文件服务均使用该清单。TSV 使用现有文本表格解析流程。输入框附件按钮增加格式提示。

XLS 解析按需加载，支持 BIFF 二进制工作簿、中文编码、多个工作表、日期显示格式和公式缓存值，并返回工作表/单元格范围引用。读取过程保留公式文本及已保存结果，不重新计算公式。扩展名识别不区分大小写，文件导入继续使用现有单文件 50 MiB 上限。

旧版 Excel 依赖固定为 SheetJS 0.20.3 官方 tarball，并通过锁文件校验完整性；ESM 入口显式加载旧编码表，安装方式参考 [SheetJS 官方 Node.js 文档](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/)。损坏或伪装成 XLS 的普通文本返回 `FILE_CORRUPT`；需要密码的工作簿返回 `FILE_ENCRYPTED`。

## 验证

- 文件服务：23 项测试通过，含新增 7 项附件/XLS 测试。
- 合约：81 项测试通过。
- Desktop 聊天界面：90 项测试通过。
- 文件服务、Desktop TypeScript 检查通过；V2 边界检查覆盖 407 个源文件并通过。
- 新增代码格式检查通过。现有 `App.tsx` 中另有 1 条 warning 和 1 条 info，未修改相关代码。
- Electron E2E：取消文件选择、同次添加 XLS/TSV/SQL、内容预览、随消息发送、Pi `openerx_file_read` 读取、附件卡片和重启持久化均通过。模型使用隔离测试配置和 faux provider。
- XLS 样本由独立的 xlwt 1.3.0 生成，包含“销售明细”“汇总”、中文商品、数值 0、布尔值、日期和公式缓存；生成脚本与二进制样本一起保存，运行测试无需安装 Python 依赖。
- macOS arm64 应用打包和严格签名检查通过，本机应用已更新。系统文件窗口实测选中 `.xls` 后“打开”按钮可用，随后取消选择。
- 本机数据库比对：12 个对话、53 条消息、12 个个人文件、12 个附件、43 个引用、1 个项目、14 个成果、14 个成果版本内容均未改变。

日志、原生选择窗口截图、输入框截图、原应用备份和工作区检查点位于本机 `openerx-checkpoints/xls-attachments-20260912-091547/`。

本机重启后的真实模型配置读取遇到 macOS SecurityAgent 凭据授权；系统工具不允许自动操作该窗口，已请用户手动处理。上述附件 E2E 使用隔离测试模型，不构成真实远程模型调用证明。
