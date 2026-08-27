# P1 Codex 对齐 CX-108 Office Agent 实现证据（2026-08-27）

> 状态：`PASS / LOCAL IMPLEMENTATION CHECKPOINT`
>
> 时间：2026-08-27 09:06（Asia/Shanghai）
>
> 基线：`HEAD 8561cdab1132e11e56dbf5fee2957d4fcfaafdba` 加当前未提交的 P0、CX-101 至 CX-108 实现
>
> 范围：`docs/v2/16-codex-aligned-implementation-assessment.md` 中的 CX-108

## 1. 结论

CX-108 已在当前工作树形成可运行的本地实现检查点：用户通过 Documents、Spreadsheets、Presentations 或 PDF Skill 发起自然语言 Turn，Pi 使用独立的 `openerx_office_artifact` 工具创建或修改真实 DOCX、XLSX、PPTX、PDF 二进制文件；成果进入受控内容库并以不可变 ArtifactVersion 保存。每个页面、工作表或幻灯片都会生成客户端 SVG 预览和供模型视觉检查的真实 PNG，客户端不再只显示 parsed text。

本轮还用 LibreOfficeDev 和 Poppler 实际打开、分页并渲染了四种生成文件，逐张检查了中英文、公式结果、尺寸和溢出。完整 `npm run check:v2` 通过。

这不是整个 P1 或发布级 FILE-05 完成声明：自然语言 E2E 使用确定性的 Pi Host 测试替身，不是 live Provider；原生打开证据来自当前 macOS 开发机的 LibreOfficeDev/Poppler，不等于 Windows Microsoft Office、签名双平台包或任意第三方 Office 文件预览。CX-109、CX-110 和 12 组外部发布证据仍保留。

## 2. 实现与证据映射

| 边界 | 关键实现 | 自动化证据 |
| --- | --- | --- |
| 类型化生产合同 | `OfficeArtifactSpec` 按 DOCX/PDF 页面、XLSX 工作表/单元格/公式、PPTX 幻灯片建立有界的 discriminated union；`artifact.office.write` 同时支持创建和传入稳定 `artifactId` 修改。 | Contracts 测试验证四种请求和双预览载荷；非法页数、重复工作表名、外部 URL、外部工作簿/DDE 和高风险公式函数被拒绝。 |
| 真实二进制与版本 | File Service 直接生成合法 OOXML/PDF bytes；DOCX、XLSX、PPTX 不是改扩展名的文本，PDF 是 PDF 1.7。创建后进入受控对象库；编辑追加不可变版本，旧版本保留。 | File Service 把四种 bytes 写盘后重新交给 `MultiFormatParser` 解析；测试验证四种格式、两画布、PNG magic、PPTX `currentVersion: 2` 和两条版本记录。 |
| 全画布视觉输入 | 同一受控规格生成每页/表/幻灯片 SVG；`@resvg/resvg-js` 将每张 SVG 栅格化为 PNG。客户端使用 SVG，Pi 工具结果使用模型网关支持的 `image/png`；Base64 字段从结构化详情剥离。 | Pi Host 测试验证每张画布都作为独立 PNG image content 返回，且结果详情不泄漏 SVG/PNG data URL。 |
| Office Skills | 新增 Documents、Spreadsheets、Presentations、PDF 四个内置 Skill，均声明 `openerx_office_artifact`；要求检查返回的每张画布，遇到拥挤或溢出时修订。 | Skill 测试验证五个内置包可重复 seed、挂载和自动调用；App Service E2E 验证四个 Office Skill 的工具初始激活。 |
| Agent Turn | `chat.send` 先建立持久 Run，再由 Pi 发起 `artifact.office.write`；更新既有 Documents/Spreadsheets/Presentations/PDF 的中英文路由会初始激活 Office 工具。 | 确定性 Agent Harness 从 8 个自然语言 Turn 开始：四次创建、同一四个会话各一次修改；最终四个 Artifact 均为版本 2、每个有两个可见画布。 |
| 客户端预览 | Artifact 预览面板按顺序展示全部页面、工作表或幻灯片，而不是存在画布时仍回退到 parsed text。 | Desktop 测试验证多画布 gallery、标签和 parsed-text fallback 边界。 |

## 3. 可复现成果

生成命令：

```text
npx vite build --config scripts/cx108/vite.office-evidence.config.mts --logLevel error
node .vite/cx108-office-evidence/generate-office-evidence.mjs
```

输出目录：`tmp/cx108-office-workflow/`。`manifest.json` 记录实际 bytes、SHA-256、解析字符数、引用数，以及每张客户端 SVG 和模型 PNG：

| 格式 | 实际文件 | bytes | SHA-256 | 解析字符 | 画布 |
| --- | --- | ---: | --- | ---: | ---: |
| DOCX | `agent-output.docx` | 3598 | `09298d7af8f9dbc40c89d6acfd6f1bfc6ef610eb3f64d2d507612c09e22e0b66` | 181 | 2 页 |
| XLSX | `agent-output.xlsx` | 4506 | `2ff88f79f4f26ea1f9d41b69e8fcd55d341029151be680ad7ef4a18bcb575327` | 209 | 2 表 |
| PPTX | `agent-output.pptx` | 8626 | `6ba518eac15ebb7314d663fadf99897c1201019e86f5cb155d3d8e4cb3800408` | 131 | 2 张 |
| PDF | `agent-output.pdf` | 3089 | `4ccf8f12fd0814028157822f40a3297ffee7e59542ebcfc67d9b9ca1df176b0a` | 249 | 2 页 |

表中 SHA-256 对应 2026-08-27 09:00 的本次运行；OOXML core properties 包含实际生成时间，重新执行时 DOCX/XLSX/PPTX 的哈希会随时间戳变化，应以同次生成的 `manifest.json` 为准。

每个 `*.model.png` 都解码为有效 PNG：DOCX/PDF 为 794×1123，PPTX 为 1280×720，XLSX 为 720×360。客户端 SVG 和模型 PNG 来自同一画布；最新 XLSX 汇总页完整显示 `COUNTIF`、`SUM` 公式及缓存结果，没有截断公式文本。

## 4. 原生打开与视觉检查

开发机工具：LibreOfficeDev `26.8.0.0.alpha0`、Poppler `25.12.0`。OOXML 通过 `soffice --headless --convert-to pdf` 实际打开并输出 PDF；四种 PDF 再由 `pdfinfo` 和 `pdftoppm` 分页。该打包运行时在 macOS 需要显式使用系统 Fontconfig，复现时设置：

```text
FONTCONFIG_FILE=/opt/homebrew/etc/fonts/fonts.conf soffice --headless --convert-to pdf ...
pdfinfo <rendered.pdf>
pdftoppm -png <rendered.pdf> page
```

实际结果：

| 源格式 | 原生渲染结果 | 页面尺寸 | 人工视觉结论 |
| --- | --- | --- | --- |
| DOCX | 2 页 PDF 1.7 | A4 | 两页中英文正常，无方框字或溢出。 |
| XLSX | 2 页 PDF 1.7 | A4 | 两张工作表正常，公式缓存结果 `4`、`8` 可见，无溢出。 |
| PPTX | 2 页 PDF 1.7 | 960×540 pt | 两张 16:9 幻灯片正常，中英文和项目符号完整。 |
| PDF | 2 页 PDF 1.7 | A4 | Type0 中文与 Helvetica 拉丁文本正常，无 BOM 方框或异常字宽。 |

渲染证据位于 `tmp/cx108-office-native-render-v5/`（DOCX/XLSX/PPTX）和 `tmp/cx108-office-native-render-v7/pdf/`（PDF）。这些目录是可再生的本机证据，不作为跨平台发布资产。

## 5. 负向与安全边界

- 页/表/幻灯片、文本、行列和 data URL 均有 Schema 上限，不允许模型提交任意本机路径、模板、宏或外部 relationship。
- 页面或幻灯片布局无法容纳内容时，编译在保存 bytes 前返回 `OFFICE_PAGE_OVERFLOW` 或 `OFFICE_SLIDE_OVERFLOW`，不静默裁切。
- XLSX 工作表名大小写不敏感地保持唯一；非法字符和超长名称被拒绝。
- XLSX 公式禁止外部工作簿引用、DDE 管道、网络/文件 URL，以及 `CALL`、`EXEC`、`FILTERXML`、`HYPERLINK`、`REGISTER.ID`、`RTD`、`SHELL`、`WEBSERVICE` 等外部副作用函数。
- Pi 只收到 PNG image content；SVG/PNG Base64 不进入文本详情，避免模型上下文膨胀。
- 创建和修改都只写受控 Artifact，不覆盖用户原文件；修改必须使用稳定 Artifact ID，并形成新版本。

## 6. 完整门禁结果

执行 `npm run check:v2`，结果 `exit 0`：

- V2 boundaries：208 个源文件，PASS。
- Release graph：155 个 production 文件、12 个 Pi imports 仅位于 `packages/pi-host`、44 条 workspace edges，PASS。
- Local release readiness：PASS；仍明确保留 12 组外部证据。
- Biome：304 个文件，PASS。
- TypeScript：全部 workspace，PASS。
- Tests：workspace 221 个测试加根目录 61 个测试，合计 282 个，PASS。
- Build：Contracts、Release、Mobile iOS/Android 和 Desktop production bundle，PASS。
- Package：Darwin arm64/x64 与 Windows x64 Fuse 检查，PASS；新增 PNG 栅格化生产依赖进入桌面打包流程。
- Release artifact：`app.asar` 版本和 update boundary，PASS。
- Native signature：三平台本地包仍按预期为 `LOCAL UNSIGNED`，不作为签名发布证据。

本次完整门禁已包含 XLSX 外部 URL、外部工作簿/DDE 与高风险函数负向检查；Contracts 17 个测试和 File Service 13 个测试均通过。

## 7. 明确限制与下一任务

- 当前生产工具是有界、类型化的报告/表格/演示/PDF 规格，不是 Word、Excel、PowerPoint 任意对象模型，也不支持宏、外部模板或任意 OOXML 注入。
- 客户端对 OpenerX 生成成果展示由同一规范生成的确定性 SVG；二进制编译器与预览的一致性已用本机原生打开抽查。任意第三方 Office 文件仍可能只有解析文本，不据此宣称 FILE-05 发布级全覆盖。
- 自然语言创建/修改测试使用确定性的 Pi Host 替身，证明产品 Turn、Skill、工具、Artifact 和预览链路，但不证明 live 模型一定选择正确工具；live Provider 属于 CX-110。
- macOS LibreOfficeDev/Poppler 的本机结果不代替 Windows Microsoft Office、签名/公证包和真实双平台 UI 矩阵；这些仍属于 CX-110。
- 下一任务是 CX-109：持久化 Plan、Reasoning、Command、Diff、Approval、Compaction 等丰富 Item，并按 Run 在 UI 回放。
