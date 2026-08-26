# DeepSeek V4 Flash Vision 图片解析证据

> 日期：2026-08-26（Asia/Shanghai）
>
> 状态：`IMPLEMENTED / LIVE_PROVIDER_VERIFIED`

## 实现边界

- 模型目录新增 `platform/deepseek-v4-flash-vision-exp`，能力声明为
  `text=true / imageInput=true / tools=true`。
- JPEG、PNG、GIF 和 WebP 从内容寻址受控仓库读取，经 Pi `ImageContent` 进入当前用户消息，再转换为
  DeepSeek Chat Completions 的 `image_url` Data URL。
- 新任务和已有对话都先把选择的文件保留在输入框待发送区；用户发送后才绑定到本条用户消息，
  不会在选择时提前变成无消息归属的会话上下文。
- `platform/auto` 遇到图片时选择视觉模型；显式 Flash/Pro 遇到图片时返回
  `MODEL_CAPABILITY_UNSUPPORTED`，不静默更换模型。
- 单张及单次请求的原始图片总量限制为 32 MiB；模型 HTTP JSON 请求体边界为 48 MiB。

## Codex 式附件交互

- 交互语义参照 [Codex Image inputs](https://developers.openai.com/codex/image-inputs)：图片先附加到
  Prompt Composer，再作为该 Prompt 的视觉上下文发送。
- 选择图片后，输入框立即显示缩略图、文件名和大小，并提供单项移除按钮。
- 未发送附件不会出现在对话消息中；切换对话时会清空待发送附件，避免跨对话误带。
- 发送后，附件记录保存对应的 `messageId`，重新打开对话仍显示在原用户消息内。
- 图片预览只从内容寻址受控副本生成受限 Data URL，不向渲染进程暴露原始外部路径。

## 自动化证据

- Contracts：图片帧 canonical base64、MIME 和待绑定文件 ID。
- File Service：受控副本到模型 base64，不回读原始外部路径。
- App Service/UI：新任务与已有对话均覆盖选择、缩略图、移除、发送、消息归属回显及 Pi Prompt。
- Pi Host/Provider：图片成为 Pi 用户消息内容，自动选到图片模型并声明 `imageInput` Requirement。
- Model Gateway：视觉模型目录、自动路由、官方 `image_url` 请求结构、文本模型拒绝图片。
- Platform Alpha：模型请求可超过通用 1 MB JSON 上限，仍受 48 MiB 专用边界保护。

## 真实 DeepSeek 证据

命令：

```bash
npm run test:deepseek:vision
```

2026-08-26 21:36（Asia/Shanghai）结果：

- `ok=true`
- `selectedModelRef=platform/auto`
- `effectiveModelRef=platform/deepseek-v4-flash-vision-exp`
- 28 个 SSE delta，重建正文与终态正文一致
- 图片被识别为中国联通品牌标志
- Usage：input 139、output 28、total 167、`providerReported=true`

最终执行 `npm run check:v2` 返回 0：边界检查、发布图、Lint、全部工作区 TypeScript、243 条测试、
移动端导出、桌面打包、Fuse 与发布产物检查均通过；本地签名检查按当前开发配置报告
`LOCAL UNSIGNED`。

该证据证明真实供应商已经接收并解析图片；它不替代大图片、多图片、断网、供应商失败和长期稳定性
Beta 门禁。
