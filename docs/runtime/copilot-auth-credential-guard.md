# GitHub Copilot 凭据防护与认证边界

> 文档类型：当前实现
> 状态：2026-04-15 已按当前实现校准
> 结论：当前 GitHub Copilot 认证主入口已经是系统配置中的 OAuth Device Flow 与 `.opencode/state/copilot-token*.json`；`~/.local/share/opencode/auth.json` 只剩 legacy 兼容与历史事故排障价值。

## 1. 文档目的

这份文档只回答两件事：

1. 当前代码里，GitHub Copilot 认证主链到底是什么。
2. 2026-03-11 那次 `auth.json` 被清空的事故，今天还应如何理解。

这里不再把“历史事故根因”和“当前认证主入口”混写。前者仍然有效，但后者已经变化。

## 2. 当前实现结论

截至 2026-04-15，当前实现应按下面这组边界理解。

### 2.1 当前主认证入口

GitHub Copilot 的主认证入口在 BFF 配置路由，而不是 `opencode auth login`：

1. `control-plane/web-ui-bff/src/modules/config/routes.ts` 提供 `POST /config/copilot/device-code`、`POST /config/copilot/poll-token`、`GET /config/copilot/status`、`GET /config/copilot/models`、`POST /config/copilot/logout`。
2. OAuth Device Flow 成功后，BFF 会把 token 写入 `.opencode/state/copilot-token.json`；多账号 provider 则写入 `copilot-token-<provider>.json`。
3. Web UI 的系统设置页已经把 GitHub Copilot 账号管理作为正式入口，而不是要求运维或开发者先用 CLI 手动登录。

因此，当前“重新登录 Copilot”的首选动作是：

1. 进入系统配置 → 模型。
2. 在对应的 GitHub Copilot provider 卡片上完成登录。
3. 用状态/模型列表确认凭据已恢复。

### 2.2 当前运行前 guard 的判定逻辑

当前运行前 guard 在 `control-plane/web-ui-bff/src/lib/model-config.ts`：

1. 优先检查 runtime state dir 与 UI state dir 下的 `copilot-token*.json`。
2. 仍保留对 `~/.local/share/opencode/auth.json` 的 legacy 兼容读取。
3. 如果主 token 文件和 legacy auth 都不存在，会抛出 `MODEL_PROVIDER_AUTH_REQUIRED`，并把恢复入口深链到系统配置 → 模型。
4. 如果检测到 `auth.json.bak`，恢复建议里会额外提示可以从备份恢复 legacy 文件。

换句话说，当前代码不是“完全不认老路径”，而是：

1. 主路径已经换成 settings OAuth + `copilot-token*.json`。
2. `auth.json` 只作为 fallback / recovery hint 被兼容。

### 2.3 当前文档失真的根因

旧版文档的问题不在于 2026-03-11 的事故判断错了，而在于它把历史事故对应的 legacy 路径继续写成了当前主链：

1. 把 `~/.local/share/opencode/auth.json` 当成当前唯一凭据源。
2. 把 `opencode auth login` 当成当前推荐恢复方式。
3. 把“恢复后一定无需重启”写成通用结论。

而当前代码事实已经变成：

1. 主入口是设置页 OAuth。
2. readiness guard 会先看 `copilot-token*.json`。
3. legacy `auth.json` 只在兼容与恢复提示里继续出现。

## 3. 2026-03-11 历史事故仍然成立的部分

下面这段事实链依然成立，但它描述的是一次 legacy 凭据事故，而不是当前主认证链。

### 3.1 事故时间线

| 时间 (2026-03-11) | 事件 |
| --- | --- |
| ≤ 10:03 | Runtime 正常使用 `github-copilot/claude-sonnet-4` 连续发请求 |
| 10:28 | `~/.local/share/opencode/auth.json` 被改写为 `{}` |
| 10:32 | `tmp/opencode-cleanup/` 出现 DB 会话清理产物 |
| 此后 | 任务报 `missing required Authorization header`，当时的 runtime 无法获取可用 Copilot 凭据 |

### 3.2 当时的根因

那次事故的根因仍然可以表述为：

**legacy `auth.json` 被外部操作清空。**

当时能成立的判断包括：

1. 不是 model id 配错。
2. 不是 provider 代码突然损坏。
3. 不是 cleanup 脚本直接删除了 auth 文件。
4. 最可能的是外部脚本直接覆盖了 `auth.json`，或有人执行了旧的 logout 类动作。

这个结论今天仍有价值，因为当前 guard 仍兼容 legacy `auth.json`，而某些旧环境或旧脚本仍可能碰它。

## 4. 当前恢复手册

### 4.1 首选恢复路径：系统配置 → 模型

这是当前实现的推荐恢复方式。

适用场景：

1. `MODEL_PROVIDER_AUTH_REQUIRED` 被触发。
2. Settings 中 Copilot provider 显示未认证。
3. `GET /config/copilot/models` 返回 401 或“认证已失效”。

处理方式：

1. 进入系统配置 → 模型。
2. 对目标 provider 执行 GitHub Copilot 登录。
3. 登录成功后，再次读取 provider 状态或模型列表确认恢复。

### 4.2 次选恢复路径：处理当前 token 文件

如果设置页显示已登录，但实际读取模型仍 401/失效，应优先按“当前主路径”排障，而不是先去恢复 legacy `auth.json`：

1. 在设置页对该 provider 退出登录。
2. 再重新完成一次 Device Flow 登录。
3. 重新验证状态与模型列表。

这一步针对的是 `.opencode/state/copilot-token*.json` 这一层的失效或错配。

### 4.3 Legacy 兜底恢复：`auth.json.bak`

只有在下面这类场景里，才应把 `auth.json.bak` 作为恢复主动作：

1. 你明确知道当前运行账户仍依赖 legacy `~/.local/share/opencode/auth.json`。
2. readiness guard 的恢复建议里明确给出了 `auth.json.bak`。
3. 旧环境或旧脚本尚未完全切到 settings OAuth 主链。

恢复方式：

```bash
cp ~/.local/share/opencode/auth.json.bak ~/.local/share/opencode/auth.json
```

但这里要明确：

1. 这是 legacy recovery，不是当前推荐主路径。
2. 它解决的是旧 `auth.json` 被清空的问题，不等于当前 `copilot-token*.json` 主链一定已经恢复。

### 4.4 关于“是否需要重启”

旧版文档把“恢复后无需重启”写成了通用结论，这在当前代码结构下不够严谨。

更安全的表述应当是：

1. 恢复后不要先假定一定要重启，也不要先假定一定不需要重启。
2. 应先用设置页状态、模型列表或实际任务 readiness 再验证一轮。
3. 只有在验证仍失败时，才继续沿运行账户、挂载路径和环境隔离问题往下查。

## 5. 当前防护面

当前已能直接确认的防护面如下：

1. 配置页 OAuth 登录把主凭据写入 `.opencode/state/copilot-token*.json`，不再只依赖旧 `auth.json`。
2. readiness guard 会同时检查 runtime 与 UI 两侧 state dir，减少“页面已登录、运行时不可读”的盲区。
3. legacy `auth.json` 若存在，`model-config.ts` 仍会 best-effort 备份为 `auth.json.bak`。
4. 运行时恢复错误会被深链到设置页对应的 Copilot provider 卡片，而不是只给出裸报错。

## 6. 预防清单

- [ ] 不要把 `opencode auth login` / `opencode auth logout` 继续当成当前主链运维手册。
- [ ] 不要在自动化脚本里覆盖 `.opencode/state/copilot-token*.json` 或 `~/.local/share/opencode/auth.json`。
- [ ] 如果 runtime 运行在独立账户、容器或远端环境，必须确认它能读取实际生效的 token 文件，而不是只让 UI 侧完成登录。
- [ ] 仍保留 legacy 环境时，可以保留 `auth.json.bak` 作为兜底恢复手段，但不要再把它写成唯一凭据来源。

## 7. 一句话边界

2026-03-11 的事故结论仍然成立：当时是 legacy `auth.json` 被清空；但当前实现的 GitHub Copilot 认证主链已经是 settings OAuth + `.opencode/state/copilot-token*.json`，`auth.json` 只剩兼容和恢复提示价值，不能再被写成现行主入口。
