# OpenERX Browser Computer-Use 重构方案

- 状态：`ACCEPTED / BCU-003 MACOS AX + WINDOWS EDGE/CHROME UIA LIVE PASS / BRIDGE SIGNED TRANSPORT PENDING`
- 日期：2026-08-27；live gate 更新于 2026-08-29（Asia/Shanghai）
- 范围：桌面端 Browser Capability；BCU-003 已接通 macOS 系统默认浏览器本地 AX 纵向切片、原生
  动作矩阵、用户输入暂停后端和可信工具中心接管/恢复 UI；真实物理输入与原生 Tool Center runners
  已在解锁机器 PASS；Bridge 协议、一次性标签页授权状态机和 Adapter 接入已实现，MV3 扩展、Native
  Messaging Host、可信连接 UI、签名安装门禁和托管 Chromium 尚未完成；2026-08-29 当前 Windows 11
  默认 Edge 与默认 Chrome 的 UIA/原生输入/截图/接管 monitor/关窗纵向切片及未签名 x64 包已 PASS，
  不改变签名发布状态
- 最新产品决定：浏览器必须是独立可见的操作面，不嵌入聊天页面；默认优先使用机器上的系统默认
  浏览器以复用用户已有账号状态，用户可切换到 Electron 自带 Chromium 的托管浏览器以提高隔离和
  安全等级；两种后端都采用“语义优先 -> 视觉验证 -> 坐标兜底”的混合 computer-use，不向模型暴露
  网页 DOM selector 或任意脚本执行能力

## 1. 结论

推荐把现有 `openerx_browser` 重构为统一的 **Browser Computer-Use Host**，下接两个可替换后端：

1. 每个 Browser Session 使用一个可单独移动、关闭和接管的系统顶层窗口；聊天 Renderer 只展示
   进度、截图缩略图、授权卡、后端标识和接管入口，不承载远程网页。
2. 默认后端为 `system_default`：打开机器当前的默认浏览器；有用户连接的可信 Browser Bridge 时绑定
   精确标签页，否则绑定一个供本次任务使用的专用窗口。该后端复用浏览器已有的 Cookie、密码管理器、
   扩展和登录态，但 OpenERX 不导入、复制、枚举或导出这些数据。
3. 安全增强后端为 `managed_chromium`：使用 Electron 随应用交付的 Chromium 和 OpenERX 管理的
   独立 Profile，不继承用户日常 Chrome、Edge、Safari 或 Firefox 的 Cookie、扩展、密码和登录态。
4. Pi 优先通过过滤后的浏览器语义快照/可访问性树和窗口元数据观察页面，并用短期 element reference
   执行 `focus`、`setValue`、`invoke`、`select`、滚动和按键；截图用于基线、异常判断、坐标 fallback
   和结果验证，而不是唯一控制通道。
5. 模型合同删除 CSS/XPath selector 和任意脚本。可信 Host Adapter 可以使用受约束的 Browser Bridge、
   Chromium Accessibility、OS Accessibility 或浏览器原生语义接口，但不得接受模型提供的 selector/
   JavaScript、读取隐藏 DOM/Cookie/密码，或操作 observation 中不可见、不可交互的元素。
6. Pi 继续是唯一 Agent Loop，App Service 的 Capability Broker 继续拥有后端选择策略、Scope、
   审批、审计、取消和幂等；Browser Host 只负责观察和执行，不增加第二套规划器。
7. 桌面优先：macOS 系统默认浏览器与当前 Windows 11 默认 Edge/Chrome 纵向切片已完成，再推进托管
   Chromium；Windows 其他浏览器/OS/DPI/多屏组合在原生捕获/UI Automation 支持矩阵完成前
   fail-closed，不用脚本注入作为降级路径。

即使选择系统默认浏览器，也仍通过独立的 `openerx_browser` capability 和
`SystemDefaultBrowserAdapter` 执行，而不是让通用 `openerx_desktop` 任意操作浏览器。Browser
Capability 负责 URL 校验、浏览器后端选择、精确窗口绑定、域名 Scope、接管、文件和生命周期策略，
底层只复用 Desktop Computer-Use 的窗口观察与输入内核。

任何后端都不得静默降低安全等级：托管 Chromium 不可用时，不能自动切换到用户默认浏览器；系统
默认浏览器无法精确绑定标签页或专用窗口时，也不能退化为整屏点击或操作任意现有标签页。

## 2. 当前实现与差距

M5 的 Electron `BrowserWindow` + selector 实现仍以 `legacy_dom_v1` 冻结保留，并可通过
`OPENERX_BROWSER_COMPUTER_USE_V2=0|false` 显式回滚；它不再是默认 Pi Browser ToolDefinition。

2026-08-27 已实现的默认 V2 路径包括：

- Pi -> App Service -> Capability Broker -> Electron Main 的唯一工具链保持不变；Pi 投影和 Main Host
  已使用严格 `browser_computer_use_v2`，不向模型暴露 selector、DOM、脚本或 DevTools 命令。
- macOS 识别系统 HTTP(S) 默认浏览器，为任务创建独立顶层窗口，并以 bundle ID、PID、原生
  `CGWindowID` 和 bounds 精确绑定；无法唯一绑定立即 fail-closed。
- 原生 Swift AX helper 从目标 `AXWebArea` 产生过滤语义元素，以短期 `elementRef` 执行语义动作；
  Electron 只捕获该窗口并裁剪到 Web surface，敏感矩形在输出 PNG 前完成像素遮罩。
- 动作仍按 semantic -> native AX hit-test -> current visual coordinate 分层，旧 observation 在动作、
  导航、失联、取消或接管后失效。
- 真实默认 Chrome 已完成 `setValue("phonescloud")` + 语义 `invoke("百度一下")`，最终 URL、语义元素、
  surface 截图和 `closeState=closed` 均有日期化证据。
- 本地回环夹具已完成代表性 `Backspace`、`scroll`、`back`、`forward`、`reload` 的真实动作矩阵；
  每个动作均返回 fresh Observation，滚动以截图变化、刷新以服务端请求计数验证，最后只关闭专用窗口。
- macOS 已增加只监听“是否发生输入”的一次性原生 monitor：指针/滚轮按精确顶层 `CGWindowID`
  判断，键盘按前台 PID + 精确 AX focused window 判断；不记录键值、文本或坐标。命中后立即进入
  `paused_for_user`，旧 Observation 失效，后续 fallback 停止；monitor 丢失则会话 fail-closed。
- Host 内部恢复原语会重新校验相同 surface、重启 monitor 并生成 fresh baseline，只允许可信 UI
  通过窄 IPC 调用，不把 `resume` 暴露成模型动作。确定性跨层测试已通过；真人接管 runner 已加入。
  2026-08-28 已确认 Computer Use 的 AX/合成点击和按键不会进入只读 `CGEventTap`，因此不能用 Agent
  自己的动作伪造用户接管；同日物理点击已通过精确窗口暂停、暂停期拒绝、fresh-baseline 恢复、
  旧 Observation 拒绝和专用窗口关闭门禁。
- 工具中心通过受信 Main/Preload IPC 按不透明 `sessionId` 列出、暂停和恢复独立会话，只显示浏览器、
  backend、control path 和状态；不加载网页，也不接收 URL、标题、截图、语义元素或 Observation。
- Chrome-first Browser Bridge 安全基础已实现：固定扩展 origin + Main 启动 nonce 双重认证、严格消息
  schema、五分钟内一次性 `browserContextRef`、精确 URL claim、`browserWindowId + tabId + documentId +
  origin` 与受信原生窗口身份组合绑定、递增序列防重放、同源导航 Observation 失效、跨域/换页/断连
  整体撤销，以及只允许版本化语义/浏览器动作。Pi 结果中不出现 tab ID 或浏览器窗口 ID；敏感字段在
  命令发往 Bridge 前进入用户接管。

当前差距仍然明确：

- Bridge 安全状态机和 `SystemDefaultBrowserAdapter` 可注入路径已经存在，但尚无可安装 MV3 扩展、
  Native Messaging Host、Main owner-only 本地传输、原生窗口关联和可信连接/撤销 UI；因此实际产品
  仍只走独占窗口 AX 路径，不能把确定性 Bridge fixture 视为真实 Browser Bridge 可用。
- 用户输入 monitor、自动暂停和可信 Renderer 接管/恢复 UI 已实现并通过确定性测试，真实物理输入
  与原生 UI-to-browser 门禁也已 PASS；signed-app 权限保持仍未验证。真实通用 key 只覆盖代表性
  `Backspace`，其余允许列表由合同/单元测试覆盖；上传、下载、登录和浏览器权限提示仍要求用户
  接管，drag 明确拒绝。
- readiness 已检查平台、Screen Recording、Accessibility 和 OS automation，但尚未在展示工具前探测
  helper 可执行性与默认浏览器 bundle 支持；实际 open 会再次校验并 fail-closed。
- 托管 Chromium 和隔离 Profile 未实现。Firefox 当前明确不支持；如果 Firefox 或其他未支持浏览器是
  Windows 系统默认浏览器，Browser Capability 必须 fail-closed，不得退化为整屏坐标点击或改为控制
  其他浏览器窗口。Windows 当前仅完成本机 Windows 11 x64 默认 Edge 与默认 Chrome 的 UIA 纵向切片、
  原生动作矩阵及未签名包，不能外推到其他 Windows/DPI/多屏矩阵或签名安装生命周期。证据见
  [公共测试说明](../TESTING.md)。

本轮完成证据见 [公共测试说明](../TESTING.md)、
[公共测试说明](../TESTING.md) 与
[公共测试说明](../TESTING.md)。

## 3. 目标边界

### 3.1 双后端与独立浏览器操作面

```text
Browser Computer-Use Host
  ├─ SystemDefaultBrowserAdapter
  │    ├─ 校验 HTTP(S) URL
  │    ├─ 识别 OS 当前默认浏览器及支持状态
  │    ├─ 已连接 Browser Bridge：绑定精确 tabId，获取过滤语义并执行语义动作
  │    └─ 无 Bridge：shell.openExternal + 专用窗口 + OS Accessibility / Native Input
  └─ ManagedChromiumAdapter
       ├─ 创建独立 Electron BrowserWindow
       ├─ 使用临时或受管持久 Session/Profile
       ├─ Chromium Accessibility / 受约束语义动作
       └─ 应用独立权限、导航、Capture、Native Input、上传和下载策略
```

Electron 官方 [`shell.openExternal()`](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options)
只能保证由系统以默认方式打开 URL，不能单独证明创建了新窗口或返回可操作窗口身份。因此系统浏览器
优先使用用户明确连接、按标签页授权的 Browser Bridge；没有 Bridge 时，Adapter 必须在调用前后比对
应用、PID、原生窗口和可访问性状态，再绑定一个专用窗口。若 URL 只进入无法隔离的既有多标签窗口，
应暂停并要求用户把页面移到新窗口，连接 Browser Bridge，或显式切换到托管 Chromium。

两个后端共同满足：

- 页面位于系统顶层窗口，不是 iframe、WebView、Renderer 子路由或右侧内嵌面板。
- 有独立 Session ID、后端类型、control path、应用身份、surface kind/ID、窗口所有权和能力清单。
- 系统浏览器在可信 Bridge 下可绑定用户明确授权的精确标签页；无 Bridge 时使用专用窗口。两种路径都
  共享该浏览器原有 Profile，且不得操作未授权标签页或其他窗口。
- 托管 Chromium 模式使用 OpenERX 独立 BrowserWindow、renderer/process 和 Profile。
- 用户始终可以通过主窗口状态卡或附着在目标窗口边缘的控制条看到“由 OpenERX 操作”，并可暂停、
  接管、恢复和停止。
- 用户直接点击或输入后，自动化立即暂停，当前 observation 失效；Pi 必须重新观察后才能继续。
- Run 停止、App Service/Main 断开或 Session 超时后，两个后端都停止输入并使 observation 失效。

生命周期必须区分窗口所有权：

- `system_default` 停止时默认只解除绑定，不清理用户浏览器 Cookie/Profile，也不关闭任务开始前已
  存在的标签页或窗口。只有 OpenERX 确认创建并独占的标签页/窗口，才可在用户明确选择关闭后关闭。
- `managed_chromium` 停止时关闭受管窗口；临时 Profile 显式清理，持久 Profile 按用户设置保留。
- 任一后端无法确认目标标签页/窗口身份时立即 fail-closed，不对整屏或当前前台窗口继续操作。

### 3.2 混合 Computer-Use 观察/动作闭环

[OpenAI 官方 Computer Use 文档](https://developers.openai.com/api/docs/guides/tools-computer-use)
把“内置截图循环”“自定义 automation harness”和“视觉/程序化混合的 code-execution harness”列为
不同路径。本方案选择自定义混合 harness：不把纯截图循环当成唯一实现，也不把任意网页脚本暴露给
模型。

```text
用户请求
  -> Pi AgentSession 选择 openerx_browser
  -> App Service Capability Broker 解析用户后端设置与本次请求
  -> Broker 校验 Scope / 风险 / 精确 payload，得出 effectiveBackend
  -> Main Browser Computer-Use Host 分派到对应 Adapter
       -> 校验 Session、应用与 tab/window surface 身份
       -> Semantic Observe：URL/标题/尺寸 + 过滤后的可见元素语义/状态/边界
       -> Visual Observe：按策略捕获精确 surface 截图或裁剪
       -> Observation Registry：短期 observationId / semanticSnapshotId / elementRef / TTL
  <- semantic snapshot/diff + optional typed image + session descriptor + observationId
  -> Pi 选择一个动作
  -> Broker 在动作发生前完成所需审批
  -> Host 校验 observationId、后端、surface、页面与元素引用没有过期
  -> 按 semantic action -> native input -> coordinate fallback 顺序执行一个逻辑动作
  -> 返回新的语义 Observation；策略要求时同时返回新截图，旧引用立即失效
```

核心规则：

- 每次动作只操作一个精确 surface；绝不回退到整屏、同名窗口或“当前浏览器”。
- 系统浏览器使用 Bridge 时绑定 browser identity + tabId + nativeWindowId；无 Bridge 时绑定应用 ID、
  PID、原生窗口 ID 和前台页面证据。托管 Chromium 还要绑定 WebContents/renderer 身份。
- elementRef 只能由可信 Adapter 从当前可见语义快照生成，并且只在该 observation 中有效。模型不能
  构造 selector，也不能要求 Host 查找隐藏、不可见或 disabled 元素。
- 动作优先使用受约束的 `focus`、`setValue`、`invoke`、`select`、`scroll` 等语义操作；语义能力不足时
  使用原生键鼠，最后才使用截图坐标。
- 坐标必须位于当前 visual observation 范围内，并绑定 surface ID、图像尺寸、缩放比例和 TTL。
- 每个逻辑动作后都生成新 observationId。Host 可把 `focus + setValue` 或规范化按键序列实现为一个
  审计原子动作，但不得跨导航、跨域、外部副作用或审批边界批处理。
- 初始页面、导航/布局突变、语义状态不完整、坐标 fallback、高影响动作前后和最终完成时必须返回
  typed `image/png`。稳定的低风险语义动作可只返回语义 diff 和 screenshot digest，不必传整张截图。
- 语义文本和图像都设数量/长度/区域上限；密码框、Token、Cookie 和隐藏元素不进入模型上下文。
- 用户接管期间不向 Pi 发送截图、可访问性快照或按键内容。
- 页面内容、第三方扩展和浏览器通知一律视为不可信输入。只有签名并由用户连接的 OpenERX Browser
  Bridge 代码属于可信控制面；它返回的网页内容仍是不可信数据，不能扩大 Scope。

### 3.3 建议合同

保留产品名 `openerx_browser`，但引入版本化的 V2 操作合同；旧操作只用于历史回放和迁移，不再向
模型暴露：

```ts
const BROWSER_COMPUTER_USE_CONTRACT_VERSION = "browser_computer_use_v2" as const;

type BrowserBackend = "system_default" | "managed_chromium";
type BrowserControlPath =
  | "connected_browser_bridge"
  | "os_accessibility"
  | "managed_chromium_semantic";

type BrowserTarget =
  | { elementRef: string }
  | { x: number; y: number; visualObservationId: string };

interface BrowserOpenRequest {
  contractVersion: typeof BROWSER_COMPUTER_USE_CONTRACT_VERSION;
  action: "open";
  url: string;
  requestedBackend?: BrowserBackend;
  browserContextRef?: string;
}

type BrowserComputerUseOperation =
  | BrowserOpenRequest
  | { action: "observe"; sessionId: string }
  | {
      action: "focus" | "invoke" | "click" | "submit";
      sessionId: string;
      observationId: string;
      target: BrowserTarget;
    }
  | {
      action: "setValue";
      sessionId: string;
      observationId: string;
      target: { elementRef: string };
      text: string;
    }
  | {
      action: "type";
      sessionId: string;
      observationId: string;
      target?: BrowserTarget;
      text: string;
    }
  | {
      action: "select";
      sessionId: string;
      observationId: string;
      target: { elementRef: string };
      option: string;
    }
  | { action: "key"; sessionId: string; observationId: string; key: string }
  | {
      action: "scroll" | "drag";
      sessionId: string;
      observationId: string;
      // bounded viewport coordinates / direction
    }
  | {
      action: "back" | "forward" | "reload";
      sessionId: string;
      observationId: string;
    }
  | { action: "upload"; sessionId: string; observationId: string; fileId: string }
  | { action: "download"; sessionId: string; observationId: string; target: BrowserTarget }
  | { action: "detach"; sessionId: string }
  | { action: "close"; sessionId: string; observationId: string };
```

`requestedBackend` 只是偏好：Broker 必须应用用户在可信设置界面配置的安全下限，模型和网页不能把
`managed_chromium` 降级为 `system_default`。`browserContextRef` 是由可信 UI 创建或选中的不透明引用，
不能让模型枚举本机浏览器 Profile 或账号。

`open` 和每个交互动作都返回一份新 `BrowserObservation`：

```ts
interface BrowserSessionDescriptor {
  contractVersion: typeof BROWSER_COMPUTER_USE_CONTRACT_VERSION;
  sessionId: string;
  backend: BrowserBackend;
  controlPath: BrowserControlPath;
  applicationId: string;
  nativeProcessId: number;
  nativeWindowId: string;
  surfaceKind: "tab" | "window";
  surfaceId: string;
  ownership: "external_user" | "external_openerx" | "openerx_managed";
  profilePersistence: "browser_owned" | "ephemeral" | "managed_persistent";
  state: "opening" | "active" | "paused_for_user" | "detached" | "closing" | "closed" | "failed";
  capabilities: {
    semanticObserve: boolean;
    semanticAction: boolean;
    visualCapture: boolean;
    coordinateFallback: boolean;
    controlledUpload: boolean;
    controlledDownload: boolean;
    clearProfileData: boolean;
    closeOwnedWindow: boolean;
  };
}

interface BrowserObservation extends BrowserSessionDescriptor {
  observationId: string;
  previousObservationId: string | null;
  semanticSnapshotId: string;
  visualObservationId: string | null;
  actionPath: "semantic" | "native_input" | "visual_coordinate" | null;
  url: string;
  title: string;
  viewport: { width: number; height: number; scaleFactor: number };
  elements: BrowserSemanticElement[];
  semanticDiff?: BrowserSemanticDiff;
  image?: ToolResultImageContent;
  imageReason?: "baseline" | "layout_change" | "uncertain" | "coordinate" | "risk" | "final";
  screenshotDigest: string;
  capturedAt: string;
  expiresAt: string;
}
```

V2 模型合同不再包含 `selector`、原始 DOM/HTML、本机 `path` 或任意 JavaScript。不要依赖 Codex
私有的 `@oai/sky` 包；项目只借鉴其交互语义，在 OpenERX 合同和 Host 内实现可维护的等价接口。

可信 Adapter 内部允许与禁止的边界：

| 允许 | 禁止 |
| --- | --- |
| URL、标题、viewport、tab/window identity 等控制面元数据 | 把 Cookie、密码、Token、历史或完整 DOM/HTML 返回 Pi |
| Chromium/OS Accessibility 或签名 Browser Bridge 提供的可见 role/name/value/state/bounds | 接受模型或网页提供的 CSS/XPath selector、JavaScript 或 DevTools 命令 |
| 对 observation 内可见且 enabled 的元素执行 focus/setValue/invoke/select/scroll | 点击隐藏、detached、disabled、被遮挡且未验证的元素 |
| 受控 Browser Bridge 内部用版本化 content script 生成语义快照和执行语义动作 | 通用 evaluate/executeJavaScript、任意脚本注入或绕过网页/浏览器安全提示 |
| 在必要节点截图并验证动作结果 | 只凭内部 API 返回成功就宣称用户目标完成 |

## 4. 模式、权限、确认与接管

| 行为 | 默认风险 | 要求 |
| --- | --- | --- |
| 首次启用系统默认浏览器模式 | L3 | 明示会使用现有登录态、扩展和浏览器数据；用户确认后写入本地设置 |
| 连接 OpenERX Browser Bridge | L3 | 用户显式安装/连接；按标签页授权；显示可访问域名和撤销入口 |
| 系统浏览器打开/观察 | L2/L3 | 校验 HTTP(S) URL，绑定精确标签页或专用窗口并显示 control path；跨域重新判断 |
| 托管 Chromium 打开/观察 | L2 | 使用独立 Profile；首次按域名/会话授权 |
| 普通语义动作、点击、滚动、前进/后退 | L2 | 绑定当前 Session、后端、surface、control path 和新鲜 Observation |
| 输入普通搜索词 | L2 | 授权卡显示目标域名和文本摘要；不得包含秘密 |
| 系统浏览器上传/下载 | 用户接管（首版） | 由用户操作原生文件选择器/浏览器下载；不得宣称已导入 PersonalFile |
| 托管 Chromium 下载 | L3 | 进入受控文件存储；返回 PersonalFile ID，不返回本机路径 |
| 托管 Chromium 上传或输入敏感数据 | L4 | 精确文件/数据、目标域名逐次确认，不提供“始终允许” |
| 提交、发送、删除、修改远端记录 | L4/L5 | 动作发生前逐次确认；授权绑定后端、语义/视觉目标和 payload digest |
| 密码、Passkey、2FA、付款、改密码、CAPTCHA/安全警告 | 用户接管 | Agent 暂停，用户在独立浏览器窗口完成后显式恢复 |

授权卡应展示：后端、浏览器应用、control path、域名、动作、目标元素名称或截图裁剪、将要输入/上传
的数据摘要、是否产生外部副作用，以及“仅本次允许 / 拒绝 / 我来接管”。网页、第三方扩展和浏览器
通知均不能触发或接受授权。

设置界面提供：

- 默认模式：`系统默认浏览器（兼容优先）`，复用已有账号状态。
- 可选模式：`OpenERX 安全浏览器（Electron Chromium）`，使用隔离 Profile。
- 系统浏览器显示 `已连接标签页 / 系统辅助功能 / 视觉兜底`；Browser Bridge 必须有连接、按标签页授权
  和撤销入口，且不会把标签页清单或网页秘密暴露给 Pi。
- 每次任务可从可信 UI 临时提高到安全浏览器；从安全浏览器降级到系统浏览器必须再次确认。
- 若实际默认浏览器不在当前支持矩阵，且既无可信 Bridge 又无法绑定专用窗口，显示原因并建议连接
  Bridge 或切换到安全浏览器，不静默 fallback。

## 5. 上传、下载、账号和 Profile 边界

### 5.1 系统默认浏览器

- 账号、密码、Passkey、Cookie、扩展和登录状态由用户现有浏览器拥有；OpenERX 只通过按标签页授权的
  Browser Bridge，或可见 UI/OS Accessibility 操作已绑定 surface，不读取 Cookie 数据库、密码库或
  第三方扩展存储。
- Browser Bridge 只能向 Host 返回当前授权标签页的过滤语义、可见状态和动作结果；标签页列表只在
  可信 UI 中供用户选择，不能进入 Pi 上下文。断开连接或切换标签页后旧 observation 立即失效。
- 用户没有登录时，由用户接管窗口完成登录。接管期间不截图、不记录按键、不把秘密返回 Pi。
- 登录状态是否持续、何时过期、如何退出和清除，遵循用户浏览器本身的设置；OpenERX 停止任务不会
  自动清除，也不能承诺替用户彻底退出账号。
- 首版上传、下载、站点权限、密码管理器弹窗和系统认证提示都由用户接管。未取得受控文件 ID 前，
  OpenERX 不得把浏览器提示“下载完成”当作文件成果。
- OpenERX 不导入或复制整个用户浏览器 Profile，不向 Pi 枚举其他标签页，不修改默认浏览器、主页、
  第三方扩展或同步设置。

### 5.2 托管 Chromium

- 默认使用每 Session 临时 Profile，不继承任何系统浏览器登录态。
- 使用 Chromium Accessibility 和受约束语义 Adapter 获取当前可见元素并执行语义动作；允许内部使用
  版本化、最小权限的自动化接口，但不允许模型提供 selector/脚本，也不返回完整 DOM/HTML。
- 下载由 Browser Host 接收到受控目录，App Service 立即导入 M4 文件存储并清理私有路径。
- 上传不得接受模型提供的 DOM/selector 或任意 CDP 注入；在用户批准 fileId 后，通过受控原生文件
  选择器或受控拖放桥完成，Pi 和网页都看不到任意本机路径。
- 密码、Passkey、验证码、CAPTCHA、支付确认和浏览器安全警告仍由用户接管；安全浏览器不等于允许
  Agent 获得秘密或绕过警告。
- 受管持久 Profile 作为后续独立工作项；启用前必须有 ADR 明确 OS 加密边界、Profile 目录权限、
  退出登录、按站点清除、删除、同步禁用和跨版本恢复。

## 6. 代码边界与建议拆分

| 位置 | 计划变化 |
| --- | --- |
| `packages/contracts/src/tool.ts` | 增加后端、control path、surface、SemanticObservation/Action 合同，移除模型可见 selector/DOM/path |
| `packages/pi-host/src/capability-tools.ts` | 工具说明改为 semantic-first observe/act；声明视觉节点和坐标 fallback 条件 |
| `packages/tool-sdk/src/policy.ts` | 增加后端安全下限、observation、目标、敏感输入、接管和高影响风险映射 |
| `packages/tool-sdk/src/host-adapter.ts` | 继续解析 PersonalFile；只有支持 controlled file 的后端可接收，且不暴露模型路径 |
| `packages/app-service/src/tool-app-service.ts` | 分别汇总后端和 semantic/visual control path readiness，并由用户设置解析 effectiveBackend |
| `apps/desktop/src/main/browser-computer-use/browser-bridge-protocol.ts` | Bridge 闭合协议、消息上限、精确 tab/document 绑定和受约束动作 |
| `apps/desktop/src/main/browser-computer-use/browser-bridge-grant-registry.ts` | 扩展 origin/启动 nonce、一次性授权、TTL、防重放、撤销和断连状态机 |
| `apps/desktop/src/main/browser-computer-use/connected-browser-bridge-driver.ts` | Bridge Observation/语义动作映射、敏感字段接管和零坐标 fallback |
| `apps/desktop/src/main/browser-computer-use/system-default-browser-adapter.ts` | 默认浏览器 Bridge/Accessibility 双 control-path、detach/close 所有权策略 |
| `apps/desktop/src/main/browser-computer-use/managed-chromium-adapter.ts` | Electron BrowserWindow、Chromium 语义 Adapter、Session/Profile、导航、权限和文件桥 |
| `apps/desktop/src/main/browser-computer-use/` | 共用 Session、UIObservationRegistry、Semantic、Capture、AX、Action 和接管状态机 |
| `apps/desktop/src/main/tool-capability-host.ts` | 只做能力路由；移除模型 selector 和任意 Browser 脚本执行实现 |
| `apps/desktop/src/renderer/App.tsx` | 展示模式/control path、进度、按需视觉缩略图、审批、暂停/接管/恢复，不加载页面 |
| `apps/desktop/scripts/e2e-tools.mjs` | 覆盖双后端、语义主路径、坐标 fixture、surface 绑定、stale observation、detach 和 Profile 隔离 |

`DesktopCaptureRegistry` 的 surface 身份、TTL、语义引用和坐标边界可以抽成共享的
`UIObservationRegistry`。两个 Browser Adapter 与 Desktop 复用安全内核，但 Browser Session、域名、
surface 所有权、Profile、Bridge 和文件策略保持独立。

## 7. 分阶段实施计划

### BCU-001：冻结双后端决策和合同

实现状态（2026-08-27）：ADR-V2-017、`browser_computer_use_v2` 严格合同和 BCU-C-001 至
BCU-C-009 合同测试已经落地。该阶段验收时 Pi 投影和 Browser Host 仍保持 `legacy_dom_v1`；后续
BCU-003 已把 V2 系统浏览器 AX 路径接入运行时，当前状态以本节后续阶段和日期化证据为准。

- 新建 ADR-V2-017，supersede ADR-V2-012 中 Browser DOM 自动化部分；不改变 Pi/Broker 总体决策。
- 冻结 `system_default` / `managed_chromium`、control path、用户安全下限、SessionDescriptor、
  SemanticObservation、视觉节点、动作、错误码、surface 所有权、风险和接管状态机。
- 定义 Browser Bridge、OS Accessibility、Managed Semantic 和坐标 fallback 的支持矩阵与 fail-closed
  条件；模型不得静默切换后端或绕过优先级。
- 把当前 Browser 实现标记为 `legacy_dom_v1`，禁止继续扩展。

退出条件：合同测试覆盖未知字段、selector/DOM/path/任意脚本拒绝、后端降级拒绝、Observation TTL、
跨 surface 错配和不拥有 tab/window 时的 close 拒绝；文档明确回滚路径。

### BCU-002：共用语义 Observation 内核与精确 surface 身份

实现状态（2026-08-27）：`UIObservationRegistry`、单动作 `BrowserActionDispatcher`、精确 surface
身份、30 秒 TTL、语义快照/差异、短期引用、用户接管/断连/导航失效、敏感语义值过滤和
semantic -> native input -> visual coordinate 分层已在 Desktop Main 落地，并由确定性 Fake Adapter、
随机化 HTML 语义元素和 Canvas 坐标 fixture 覆盖。该阶段验收时内核尚未接线；后续 BCU-003 已接入
`ElectronToolCapabilityHost` 与 Pi ToolDefinition，并由系统浏览器 Adapter 验证目标窗口像素遮罩。
托管 Chromium 仍须在 BCU-004 独立验证同一合同。

- 抽取 `UIObservationRegistry`，统一 semanticSnapshotId、elementRef、visualObservationId 和 TTL。
- 实现精确 tab/window 身份、过滤语义快照/差异，以及按策略返回的 surface 截图。
- 实现 semantic action -> native input -> coordinate fallback 分层和审计记录。
- 实现用户输入导致自动暂停、Observation 失效和显式恢复。
- 增加 applicationId/PID/nativeWindowId/surfaceId/ownership 绑定，不允许整屏或前台窗口 fallback。

退出条件：只观察目标 surface；tab/window 移动、缩放、导航、切换或用户接管后旧引用全部失败；标准
HTML fixture 全程走语义 elementRef，Canvas fixture 才允许受约束坐标；无整屏回退。

### BCU-003：macOS 系统默认浏览器优先纵向切片

实现状态（2026-08-28）：`LOCAL AX LIVE GATES PASS + BRIDGE SECURITY FOUNDATION IMPLEMENTED / SIGNED TRANSPORT PENDING`。
当前默认启用
`browser_computer_use_v2`，可用 `OPENERX_BROWSER_COMPUTER_USE_V2=0|false` 回滚到冻结的
`legacy_dom_v1`。macOS 已实现默认浏览器发现、OpenERX 专用顶层窗口、PID + `CGWindowID` + bounds
精确绑定、原生 AX 语义观察/动作、精确窗口截图和敏感区域像素遮罩；Main Host 与 Pi 投影已经接通，
真实默认 Chrome 已通过“百度搜索 phonescloud”语义烟测，以及 `Backspace`、滚动、前进/后退和刷新
原生动作矩阵，并只关闭专用窗口。日期化命令、结果、截图摘要与本地包证据见
[公共测试说明](../TESTING.md)。Bridge 的闭合协议、固定 origin + 启动 nonce、
一次性五分钟授权引用、精确标签页/文档/原生窗口组合绑定、单调序列、断连/跨域撤销、敏感字段接管、
无 selector/DOM/脚本动作以及 Adapter 路由已经由确定性 fixture 覆盖，见
[公共测试说明](../TESTING.md)。

本阶段尚未完成 MV3 扩展、Native Messaging Host、Main owner-only 传输、可信连接 UI、真实 Bridge
烟测、签名安装后权限保持、Firefox 和完整 Windows 支持矩阵；当前 Windows 11 默认 Edge/Chrome 已验证
`Backspace`、滚动、刷新及语义搜索，因此
不能把本地 AX 或 Bridge 基础切片标记为 BCU-003 全部完成。

- 识别系统当前默认 HTTP(S) 浏览器和支持状态；优先连接用户授权的 Browser Bridge 并绑定精确 tabId。
- 无 Bridge 时通过 `shell.openExternal()`/OS URL handler 打开 URL，创建或确认专用顶层窗口，并绑定
  应用、PID、原生窗口和当前页面；无法绑定时请求用户处理或停止。
- 实现 open/observe/focus/setValue/invoke/select/click/type/key/scroll/back/forward/reload/detach，以及
  仅对 OpenERX 独占 surface 允许的 close。
- 首版上传、下载、登录、系统认证和浏览器权限提示进入用户接管。

退出条件：不向模型暴露 selector/DOM/脚本，使用机器实际默认浏览器完成本地搜索夹具和“百度搜索
phonescloud”烟测；标准页面使用 Browser Bridge 或 Accessibility 语义路径，不读取浏览器密码/Cookie，
不操作未授权标签页/窗口；Stop 只解除控制，不破坏用户 Profile。

### BCU-004：托管 Chromium 安全增强纵向切片

- 使用独立 Electron BrowserWindow 和每 Session 临时 Profile。
- 实现 Chromium Accessibility/受约束语义 Adapter，复用同一合同完成
  open/observe/focus/setValue/invoke/select/click/type/key/scroll/back/forward/reload/close。
- elementRef 优先，原生输入其次，坐标作为受约束 fallback；每个逻辑动作返回新语义 Observation，
  只在策略节点返回完整截图。
- 验证不继承系统浏览器 Cookie、账号、扩展和密码；停止/崩溃关闭窗口并显式清理临时数据。

退出条件：同一搜索夹具与真实烟测在托管 Chromium 通过；标准 HTML fixture 不使用坐标，Canvas
fixture 可受约束 fallback；临时 Profile 隔离、清理和双后端语义/视觉合同一致性通过。

### BCU-005：Broker、模式 UI、授权卡和文件传输

- 设置默认选择 `系统默认浏览器（兼容优先）`，并提供 `OpenERX 安全浏览器`；首次启用系统模式
  显示现有账号/扩展风险说明。
- 接入后端/control path 安全下限、Browser Bridge 按标签页授权、域名 Scope、敏感输入、高影响动作
  和用户接管政策。
- 系统浏览器首版文件操作只允许用户接管；托管 Chromium 完成原生文件选择器/受控拖放上传和下载
  重新导入 PersonalFile。
- Renderer 增加后端/浏览器/surface/control path 身份、语义状态、按需视觉缩略图、暂停、接管、恢复、
  停止和 detach/close 区分。

退出条件：deny 不触达 Host；后端/control path 不会静默降级；Bridge 断开或切换 tab 后零动作；系统
浏览器无文件完成误报；托管上传/下载无私有路径泄漏；提交/发送/删除逐次确认；密码、付款、改密码、
CAPTCHA 和安全警告只能用户接管。

### BCU-006：切换、删除旧路径和发布证据

- 先以 feature flag 三轨运行：新双后端 V2、历史 `legacy_dom_v1`；进行中的 Session 不热迁移。
- 在确定性本地 E2E、双后端真实站点烟测和签名 macOS 包验证通过后，停止向模型暴露 legacy tool。
- 删除模型 selector、通用 `executeJavaScript/evaluate` 和任意 CDP DOM 操作；保留经过审计的语义
  Adapter、签名 Browser Bridge、Accessibility 接口和历史记录解析器。
- Windows 已在当前 Windows 11 x64 默认 Edge/Chrome 完成精确 HWND Capture/UI Automation 纵向切片；其他默认
  浏览器、OS/DPI/多屏和签名包矩阵通过前继续按 readiness fail-closed，不外推发布支持。

退出条件：完整 `check:v2` 通过，签名 macOS 安装态通过，回滚演练可在不迁移/损坏用户浏览器或
OpenERX 数据的情况下恢复旧版本。

### BCU-007：受管持久 Chromium Profile（后续）

- 从可信设置界面创建、命名、选择、清除和删除受管 Profile；Pi 只得到不透明 `browserContextRef`。
- 用户接管完成账号、密码、Passkey 和 2FA 登录；Agent 不得到秘密。
- 使用稳定 Profile 目录保存网站 Cookie/Storage，并实现按站点清除、全部清除、删除和退出说明。
- 完成 OS 凭证保护边界、目录权限、崩溃恢复、升级/回滚和禁用云同步的安全评审。

退出条件：应用重启后同一 Profile 可恢复测试站点登录，不同 Profile 不串号；临时 Profile 不持久；
清除/删除可验证且不会影响系统默认浏览器数据。该阶段不是 BCU-003 系统浏览器 Alpha 的前置条件。

## 8. 验收门禁

### 8.1 必须通过的确定性门禁

1. 主 Renderer、Preload 和聊天 DOM 中不存在远程网页内容、Cookie 或页面脚本。
2. 默认模式为系统默认浏览器，首次使用有风险说明；用户可从可信 UI 选择托管 Chromium。
3. 系统浏览器只在可信 Bridge 绑定精确 tabId，或 Accessibility 路径绑定 applicationId、PID、原生
   窗口和页面证据后执行；无法绑定时零输入、零点击。
4. Bridge 只能操作用户授权标签页；无 Bridge 时使用专用顶层窗口。两种路径都不读取 Cookie/密码库，
   不操作其他窗口/标签页；Stop 默认只 detach。
5. 托管 Chromium 使用独立顶层窗口和隔离 Profile，不继承系统浏览器账号状态；临时 Profile 在停止后
   被显式清理。
6. 模型合同和 ToolCall 中没有 CSS/XPath selector、原始 DOM/HTML、JavaScript 或 DevTools 命令；可信
   Adapter 只接受 elementRef 和版本化语义动作。
7. 随机化 DOM id/class 的标准 HTML fixture 必须全程通过 Browser Bridge/Accessibility elementRef
   完成，不得使用坐标；独立 Canvas fixture 必须证明 visual coordinate fallback 可用且受边界约束。
8. 初始页面、导航/布局突变、坐标 fallback、高影响动作前后和最终状态有精确 surface 截图；稳定
   低风险语义动作可只返回语义 diff，不要求每步整图。
9. 每个逻辑 act 都引用新鲜 observationId；过期、跨 control path、跨后端、跨 Session、跨 surface、
   尺寸变化、Bridge 断开和用户接管后重放均拒绝。
10. 截图只包含目标 surface；不存在整屏或其他应用内容泄漏。
11. 受审计微批处理不能跨导航、跨域、外部副作用或审批边界。
12. deny、撤销、Stop、Main/App Service/Pi Host 崩溃均不会继续输入、点击或产生外部副作用。
13. 高影响动作与上传审批绑定后端、control path、域名、语义/视觉目标、数据摘要和 payload digest；
    改变任一字段必须重批。
14. Pi 仍是唯一 Agent Loop；Browser Host 不保存或执行模型计划。

### 8.2 “百度搜索 phonescloud”双后端真实烟测

真实烟测不替代确定性 CI，但作为日期化桌面证据必须满足：

- 系统默认浏览器模式先测：记录实际浏览器 applicationId、Session ID、control path、surface kind/ID
  和原生窗口 ID；Bridge 路径只绑定用户授权标签页，无 Bridge 路径只绑定一个专用窗口。
- 托管 Chromium 模式启用前执行同一烟测：记录隔离 Profile 模式，并证明没有继承系统浏览器 Cookie。
- 每个模式都只创建一个 Browser Session；首次 Observation 包含百度首页语义快照和基线截图，输入
  前后 observationId 不同。
- 必须优先通过 elementRef 聚焦搜索框，用 `setValue` 输入 `phonescloud`，再通过明确的 Enter/搜索
  语义动作提交；只有语义快照确实缺失目标时才允许记录原因后使用坐标。
- 结果 Observation 的 URL、搜索框可见值或页面可见文本至少两项证明查询为 `phonescloud`，并用最终
  surface 截图作视觉证据；中间稳定语义动作不强制保存整图。
- 保存语义/视觉证据、后端/control path/surface 身份、工具调用序列、授权决策和完成状态；不能只以
  模型文字“搜索完成”作为证据。
- 若出现验证码、地区安全页、Bridge 断开、无法绑定 surface 或网络失败，记录为环境阻塞并停止，不
  绕过。

## 9. 迁移与回滚

- 新旧合同使用明确版本，不修改已经持久化的 ToolCall payload。
- 用户设置默认值为 `system_default`，但第一次真正控制前必须经过风险说明和确认；设置同步不得包含
  本机浏览器 Profile、账号或 Cookie。
- feature flag 分别控制 Browser Bridge、系统 Accessibility、托管 Chromium 和 legacy 新建入口；
  进行中的 Session 不跨后端/control path 热迁移。
- 任一后端失败只返回可解释错误和可选切换入口，不自动切换到另一个后端。
- 本轮不需要数据库破坏性迁移；如需记录 observation，只保存过滤语义摘要、散列、时间、截图触发
  原因和受控 artifact 引用，不把完整 DOM 或所有截图永久写入主库。
- 切换失败时停止 V2 新 Session、恢复 legacy 新建入口并保留所有 Conversation/Run/Audit 数据；不得
  修改或清理用户系统浏览器 Profile。
- BCU-001 修订了此前仅支持内嵌 BrowserWindow 的边界。公共技术规则见相关 ADR，
  当前产品范围见 [公共架构](../ARCHITECTURE.md)。旧产品合同与逐次执行报告在企业资料归档中保存，
  不能把旧结果回写成新方案的完成证据。

## 10. 非目标

- 不把 OpenERX 主界面改成浏览器壳。
- 不导入、复制、枚举或导出用户日常浏览器的 Profile、Cookie、密码、扩展数据或全局历史。
- 不自动接管任意标签页；已有标签页只能通过用户连接的签名 Browser Bridge 按 tab 授权，无 Bridge
  时必须使用可验证绑定的专用窗口。
- 不向 Pi 暴露通用浏览器扩展 API、远程调试端口、完整 DOM/HTML、CSS/XPath selector、任意
  JavaScript 或 DevTools 命令。
- 不把 Browser Bridge 作为读取 Cookie、密码、历史、未授权标签页或绕过 Broker 的通道。
- 不承诺 OpenERX 能替用户清除系统浏览器账号状态；只管理托管 Chromium 自己的数据。
- 不实现云端浏览器或移动端本地 Browser 执行；Remote 仍把命令送到在线桌面主机。
- 不建设纯截图/纯坐标引擎；视觉是验证与 fallback，不是唯一观察和控制方式。
- 不把任意 DOM 注入作为“语义或视觉操作失败时的隐藏 fallback”。
- 不自动完成 CAPTCHA、付款、改密码或绕过浏览器安全警告。
- 不在 Browser Host 中增加独立规划、重试或 Agent Loop。

## 11. 建议的下一任务

`BCU-001`、`BCU-002` 已完成，BCU-003 的本地 OS Accessibility 纵向切片、Host/Pi 接线、真实
“百度搜索 phonescloud”烟测、代表性原生动作矩阵和本地 arm64 包内 helper 验证已经完成并有日期化
证据。用户输入 monitor、自动暂停和可信 Tool Center fresh-baseline 恢复已实现并通过 live gates；
Browser Bridge 的安全协议、一次性精确标签页授权状态机、Driver 和 Adapter 路由已经完成。下一任务
仍只做 BCU-003 closure：实现最小权限 MV3 扩展、固定 `allowed_origins` 的 Native Messaging Host、
owner-only Main 本地通道与原生窗口关联、可信连接/撤销 UI，再执行真实标签页烟测和签名安装包的
Accessibility/Screen Recording/扩展权限保持验证。上述边界完成前不启动 BCU-004 托管 Chromium，
也不删除 `legacy_dom_v1` 回滚路径。
