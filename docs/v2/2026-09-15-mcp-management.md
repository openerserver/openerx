# MCP 添加与管理

日期：2026-09-15（Asia/Shanghai）

## 使用入口

**设置 → 工具 → 添加工具** 提供手动填写和 JSON 导入两种方式。

- 本机进程：填写命令、启动参数、环境变量与可选工作目录。参数每行一项，也可填写 JSON 字符串数组；含空格的路径保持为一个参数。工作目录留空时使用用户主目录。
- 网络服务：填写 Streamable HTTP 地址，可选 Bearer、OAuth 授权码（PKCE）或自定义请求头。
- 已添加服务：在列表中启停；点击 **设置 → 编辑配置** 修改现有服务；点击 **测试连接** 查看连接结果与工具清单；点击 **移除工具** 删除配置和凭证引用。
- 测试连接进行协议握手和工具发现。发现的启用工具会进入已有对话工具执行链路，沿用现有权限与审批规则。

## 快捷配置与两版同步

openerx 与 UWA 共用管理、凭据保存、连接测试和快捷配置编辑器。点击模板自动填入配置，检查并补齐所需字段后点击 **添加工具**；选择模板本身不会保存或建立连接。

| 模板 | 默认配置 | 用户填写 |
| --- | --- | --- |
| Context7（两版） | `https://mcp.context7.com/mcp`，匿名访问 | 可直接试用；需要 API Key 时选择 Bearer 并填写密钥 |
| GitHub（两版） | `https://api.githubcopilot.com/mcp/readonly`，Bearer | 具有目标仓库读取权限的个人访问令牌（PAT） |
| 企业内网服务（UWA） | Streamable HTTP、Bearer，地址留空 | 管理员提供的内网 MCP 地址与认证信息；支持改为 OAuth 或自定义请求头 |

配置依据（2026-09-15 核验）：[Context7 官方客户端配置](https://context7.com/docs/resources/all-clients)、[GitHub 官方远程 MCP](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md)。GitHub 使用官方只读 URL 限制工具范围。没有为 GitHub 配置专用 OAuth 客户端，因此模板使用 PAT。

切换模板会清空暂填的令牌、请求头及 OAuth 字段。保存后仍可使用 **编辑配置** 修改名称或连接设置，并使用 **测试连接** 验证。两版各自保存本机服务配置与凭据；源码同步不会复制用户密钥。

UWA 的内网模板由外层 `packages/central-desktop/src/mcp-presets.ts` 通过桌面扩展注入。内网地址没有预设真实企业地址，不需要修改共享代码；正式使用需要电脑可访问目标内网/VPN 及有效凭据。

## JSON 示例

支持 `mcpServers` 对象、以服务名为键的对象，以及包含 `command` 或 `url` 的单个服务对象。每次最多导入 50 个服务。
结构参考 [MCP 官方本机服务连接文档](https://modelcontextprotocol.io/docs/develop/connect-local-servers)。

```json
{
  "mcpServers": {
    "local-tools": {
      "command": "node",
      "args": ["/absolute/path/to/my server.mjs"],
      "env": {
        "API_KEY": "replace-with-your-key"
      }
    },
    "remote-tools": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "X-API-Key": "replace-with-your-key"
      }
    }
  }
}
```

示例命令、路径与地址需要替换成实际服务配置。`type` / `transport` 接受 `stdio`、`http`、`streamable-http`、`streamable_http`。
`disabled: true` 或 `enabled: false` 可让服务在导入后保持停用；`enabledTools` 可保留已有工具白名单。
旧式 SSE 传输、不支持的字段、字段类型错误、矛盾字段和重名会显示错误。

导入前预览服务清单并验证全部条目。若保存中途失败，已成功的条目标记为“已导入”，重试只处理剩余条目。

## 凭证与编辑

- 环境变量和自定义请求头支持每行 `KEY=value` 或 JSON 字符串对象；值通过已有 Electron 凭证库加密保存。普通服务配置只保留名称列表和引用。
- 编辑时环境变量、请求头、Bearer 留空会保留已有值；环境变量和请求头填写新值会替换全部，填写 `{}` 清空。
- 修改服务名称或启停 OAuth 服务会保留授权。OAuth Client ID 和 Scope 均留空时保留已有授权配置；修改任一项时需要完整填写并重新授权。
- Bearer 服务更换地址后需要重新填写令牌，避免沿用原服务的认证值。
- 新凭证先暂存，再更新服务配置；配置保存失败时清理暂存凭证，保留原配置引用。
- 更新配置会关闭旧连接；移除服务时清理配置及其凭证。连接失败返回中文诊断，不回显服务的原始错误或凭证值。

## 实现边界

链路：Renderer → Preload Bridge → Main IPC → App Service → MCP adapter。

- `mcp.server.test` 是独立的服务连接测试命令，最长等待约 15 秒；停用服务不会启动测试。
- 连接创建按服务合并；配置变化会取消旧连接；失败或停止时关闭连接与进程。
- 工具发现支持分页，最多读取 1,000 个工具；连接失败与“已连接但没有工具”分别展示。
- 复用现有配置 JSON 存储，不新增数据库迁移。
- 本次验证范围为 macOS 开发实例和本机测试服务器，未验证打包应用、Windows 实机或第三方生产 OAuth 服务。

## 验证

- 快捷配置新增验证：openerx 共同桌面回归 133 项、UWA core 共同回归 134 项通过；UWA 聊天/契约/App Service 回归 213 项、中央桌面扩展 93 项通过。
- openerx 实际 Electron 验证快捷配置预填、GitHub 空令牌校验、切换模板清空凭据、取消不保存，以及下列完整管理流程。
- 15:51（Asia/Shanghai）通过桌面 Bridge 实际连接 Context7 官方匿名端点，成功发现 `resolve-library-id` 和 `query-docs` 两个工具。未使用用户 API Key；临时配置验证后已删除。
- `npm run typecheck:v2`：全工作区通过。
- `npm run check:boundaries:v2`：通过。
- 相关 Contracts、App Service、MCP adapter、编辑器与完整 Chat UI 回归：235 项通过。
- 实际 Electron + 本机 MCP / HTTP MCP 端到端流程：通过。验证参数与环境变量到达进程、加密请求头到达 HTTP 服务、配置重载、启停、工具进入运行时、错误反馈和移除。
- 慢服务实测：15,010 ms 返回中文连接超时诊断；IPC 留出 20 秒，允许连接层完成清理并返回具体错误。
- 截图与机器结果：`apps/desktop/.vite/mcp-evidence/`。这是固定的本地验证目录，后续 Forge 清理缓存时可能重新生成。

### 重跑桌面端到端验证

在仓库根目录，用独立临时配置启动开发实例：

```bash
OPENERX_E2E=1 OPENERX_E2E_PROFILE_DIR="$(mktemp -d /tmp/openerx-mcp-e2e.XXXXXX)" \
  npm run dev:desktop -- -- -- --remote-debugging-port=19327
```

等待开发实例就绪，在另一个终端从仓库根目录执行（Forge 首次启动会清理 `.vite/build`，所以在就绪后生成测试模型宿主）：

```bash
npm exec --workspace @openerx/desktop -- vite build --config vite.pi-host-test.config.mts --logLevel error
OPENERX_MCP_CDP_URL=http://127.0.0.1:19327 node apps/desktop/scripts/e2e-mcp.mjs
```

脚本只移除本次创建的 MCP 测试配置，并保持开发实例运行。无需打包或复制 Electron 应用。
