# HTML 输出的多文件预览修复 · 2026-09-11

验证范围：本地 macOS arm64 openerx Desktop。未发布远端版本。

## 原因

此前 `ContentPreviewRenderer` 将单个 HTML 放入 `iframe.srcDoc`，没有关联网站目录。相对路径会落到 openerx 渲染器的地址，无法访问成果中的 CSS、JS、图片。保存的 CSS/JS 通用格式为 `text/plain`，也不能直接用作浏览器资源响应。旧 srcdoc 继承主界面的 CSP，且沙箱没有独立站点来源，会阻止部分脚本和 localStorage。

上一次输出归集修复验证了成果列表与源码查看，未覆盖多文件网站的视觉预览。本次补上资源加载与真实浏览器回归。

## 实现

- App Service 为 HTML 预览收集同一对话、同一工作区的成果快照，保留相对路径；导入的目录按同一文件作用域关联。独立 HTML 只包含自身，不拼入无关成果。仅 UI 预览请求构建资源包，模型工具返回值不附带整站资源。
- Desktop 通过独立的 `openerx-preview://<随机会话>/...` 协议提供快照，并按扩展名返回 HTML/CSS/JS/JSON/图片的浏览器 MIME 类型。支持相对路径、查询参数、编码文件名、CSS import/url、模块 import/fetch 和站内链接。
- 每个预览使用独立来源，允许页面脚本与该来源的 localStorage；不暴露 Node、preload 桥接或主界面 DOM。资源请求只查保存的快照映射，不读取任意本机路径。主界面 CSP 保持严格，预览使用单独的 CSP。
- 单站资源上限 256 项、50 MiB；桌面缓存最多 16 个会话、128 MiB，退出账号或切换账号时清空。相同内容复用预览地址，切换窗口触发查询刷新时不会重载页面。资源失效返回明确的过期响应。
- 补充 SVG、MJS 文件识别；CSS、SVG、MJS 可通过文件选择器导入。

## 验证

136 项相关测试通过，覆盖 File Service、Chat App Service、workspace outputs、桌面 UI、安全与文件 golden tests。Desktop 与 App Service TypeScript 检查、涉及文件 Biome、V2 模块边界和 `git diff --check` 均通过。打包应用通过本地 `codesign --verify --deep --strict`。

真实 Electron 测试在用户数据的独立副本中执行，没有发送模型请求或修改原网站：

- 原外贸网站的背景颜色为 `rgb(251, 247, 243)`，首页动态生成 3 个商品卡片、6 个 SVG 图形。
- 切换 EUR 后进入商品详情，货币选择保持；源码查看仍可使用。
- 同一成果重复请求复用相同预览地址；资源内容改变时才创建新地址，旧快照保持不变。
- 独立用例验证外部 CSS、CSS @import、PNG 图片、CSS 背景 SVG（中文/空格文件名）、MJS 模块 import、相对 JSON fetch、内联脚本和页面跳转。
- 输出按默认目录和原相对路径分层展示。新增目录回归验证 21 个文件收在同一默认目录、多级目录展开、键盘操作和预览返回保留展开状态；CSS import 用例覆盖 `css/theme/palette.css`。
- 17 次网站资源响应全部 200，页面 JavaScript 错误为 0。
- 预览内 `window.openerx`、`require`、`process` 均为 undefined；读取父页面 DOM 被浏览器阻止。

机器记录：[html-output-preview-e2e-2026-09-11.json](./html-output-preview-e2e-2026-09-11.json)。可重跑脚本：`apps/desktop/scripts/e2e-html-preview.mjs`，必须传入声明 `disposableProfile: true` 的独立数据副本配置。

本次检查点：`/Users/wanglei/Downloads/phones-cloud/openerx-checkpoints/html-preview-20260911-151226/`。保存修改前工作区归档、原应用、数据备份、新构建及桌面实测截图；既有未提交改动予以保留。

## 边界

预览展示已经保存且有关联路径的资源。单独导入一个 HTML 不会自动获得其旁边尚未导入的目录；远程资源仍取决于网络和站点限制。预览支持静态网站资源，不代替后端服务器或构建工具。此次未新增整站 ZIP 导出，HTML 的另存仍保存单个文件。
