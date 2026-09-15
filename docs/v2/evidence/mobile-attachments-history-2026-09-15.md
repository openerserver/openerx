# 移动附件与账户历史检查点

日期：2026-09-15（Asia/Shanghai）

起点：`2c052fb`，干净工作区；分支：`codex/mobile-attachments-history-20260915`。

状态：本地实现与自动化验证完成；原生设备矩阵按下文记录。

## 交付行为

### 附件

- iOS/Android 共享文件、照片、拍照入口，单次最多 10 个文件、合计 50 MB；格式复用 `supportedFileTypes`。
- 手机读取真实文件字节并计算 SHA-256，通过现有账户对象 API 的短期上传凭据完成二进制上传。令牌刷新后重试保持二进制内容不变。
- `task.start` / `session.prompt` 的加密 payload 携带文件描述符；桌面凭当前账户授权下载，检查格式、大小、摘要，再复用 File Service 解析和 Pi 文件/图片输入。附件绑定到准确的用户轮次。
- 主机能力 `attachment.upload` 用于版本兼容判断；上传或命令失败保留草稿，已成功上传的对象可在该草稿重试时复用。
- 正在生成时保持原有文字 Steer/Queue 行为，附件在回复结束后随下一轮发送。远程命令的持久去重继续生效。

### 完整历史

- 从 `/api/v2/sync/pull?limit=200` 开始分页读取账户所有已同步会话、分支、消息、附件和个人文件元数据，直到空页；与手机配对时间、当前主机及 1,000 条实时事件窗口无关。
- 服务端分页参数可选，不改变原有桌面无分页调用；游标指向本页最后一个变更。手机先保存每页再推进游标，失败可重试。
- 按父消息关系还原消息顺序，解决创建时间相同且同步顺序不同造成的问答倒序。分支按祖先和分叉点还原，历史回执不会混入其他分支。
- 搜索标题和当前阅读分支的消息，支持归档任务、历史分支、列表加载更多和更早消息；同步删除记录，避免旧事件把内容恢复回来。
- 完整缓存使用账户独立加密文件，设备密钥保存在 SecureStore；支持重启/离线读取、重新拉取损坏缓存，退出或会话撤销后清理。临时网络错误保留登录身份和可读缓存。
- 范围是账户已成功同步的产品历史。尚未上传的桌面本地数据仍需桌面完成同步；本次未增加手机本地执行器。

## 自动化证据

| 检查 | 本次结果 |
| --- | --- |
| `npm run typecheck:v2` | 全部工作区通过 |
| `npm run test:v2` | 165 个 Vitest 文件、1,065 项测试通过；2 项既有跳过；另 1 项 Node 测试通过 |
| V2 集成测试子集 | 24 个文件、119 项测试通过 |
| Electron Remote E2E | 通过；真实 Electron、Connector、账户/对象/Sync 服务与模拟模型 |
| `npm run build --workspace @openerx/mobile` | iOS、Android Hermes 导出通过 |
| `npm run check:boundaries:v2` | 473 个源文件通过 |
| `npm run check:release-graph:v2` | 327 个生产文件、48 条 workspace 边通过；Pi 导入仍隔离 |
| `npm run check:release:v2` | LOCAL OK；13 组外部发布证据仍待完成 |
| 本次修改文件 Biome / `git diff --check` | 通过 |

新增测试包括：260 个会话、1,040 条变更的完整分页与重启/离线恢复；缓存写入失败不跳游标；账户隔离；归档、删除、分支和旧事件重放；退出期间的迟到响应；上传部分失败的复用、大小变化、跨账户返回值及二进制令牌刷新。真实 HTTP 测试分别使用 iOS 与 Android 设备会话，验证新任务及继续提问的附件解析、准确轮次绑定和历史读取；设备会话参数化测试不等于原生设备操作测试。

Electron 输出标记：

```text
E2E_REMOTE_OK desktop-consent-optional-qr-e2ee-attachment-import-account-history-start-token-renewal-cursor-replay-single-charge-revoke-disable-key-vault
```

复现该 E2E（仓库根目录，先运行 `npm run dev:desktop` 并保持就绪）：

```sh
npx vite build --config apps/desktop/vite.pi-host-test.config.mts --logLevel error
npx vite build --config apps/desktop/vite.platform-alpha-test.config.mts --logLevel error
npx vite build --config apps/desktop/vite.remote-e2e.config.mts --logLevel error
node apps/desktop/.vite/build/remote-e2e.mjs
```

全量回归暴露了已有测试运行器混用：`build-info.test.mjs` 使用 `node:test`，被 Vitest 误收集。本次把它交给 Node 运行，并将桌面 Vitest worker 数量限制为 2；所有桌面测试随后通过。E2E 中旧的“页面没有任何图片”断言改为精确检查配对二维码，避免品牌图标影响验证。

补充的 `session.prompt` 下一轮附件绑定及历史读取测试随后单独复跑，2 个文件、12 项测试通过。

全仓 `npm run lint:v2` 仍报告 **22 个错误、131 个警告、11 条信息**，错误涉及 16 个未修改文件（包括构建版本脚本、RemoteSettings 和既有测试）。这些文件与起点 `2c052fb` 完全相同；本次修改文件的 Biome 检查通过。没有将全仓质量总门禁写为通过。

## 原生运行观察及边界

- 使用仓库 `npm run dev:desktop`、Expo Metro 和本地 fixture；未生成桌面安装包，也未连接付费模型。
- iPhone 17 / iOS 26.2 模拟器运行当前 Expo 代码；在手机配对前能看到“全部任务 · 55”，这些任务在手机登录前由桌面创建。重启模拟器后，登录、配对及 55 项历史再次恢复。
- 原生照片选择器已打开并显示测试图片；文件选择器已触发。照片选择器的坐标操作返回 `windowNotFoundAtPosition`，随后 Mac 锁屏使原生 UI 操作停止。**本轮未完成从原生选择器选择文件到点击发送的整段操作**；传输、桌面解析及绑定由 HTTP/Electron 测试验证。
- Android 没有连接的设备或模拟器；本次证据为共享代码、Android 设备会话的 HTTP 测试与 Hermes 导出。相机实拍、Android 原生选择器、双端真机网络切换和系统权限仍需在设备矩阵补测。

原生复测 fixture：

```sh
npx vite build --config tests/v2/vite.mobile-content-runtime.config.mts --logLevel error
node apps/desktop/.vite/build/mobile-content-runtime.mjs
# 使用上一命令打印的 baseUrl；服务保持运行。
EXPO_PUBLIC_OPENERX_PLATFORM_URL=<baseUrl> npm run start --workspace @openerx/mobile -- --port 8081 --localhost
```

该 fixture 只创建合成账户、55 项历史和模拟模型，并在自身进程内自动批准测试主机的配对申请；不得用于生产账户或发布服务。运行日志打印测试邮箱、固定验证码及测试附件路径。
