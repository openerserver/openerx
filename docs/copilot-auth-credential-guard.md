# GitHub Copilot 凭据丢失排障与防护

> 2026-03-12 — 基于一次真实事故的根因分析

---

## 1 事故时间线

| 时间 (2026-03-11) | 事件 |
|---|---|
| ≤ 10:03 | Runtime 正常使用 `github-copilot/claude-sonnet-4` 连续发请求 |
| 10:28 | `~/.local/share/opencode/auth.json` 被改写为 `{}`（空对象） |
| 10:32 | `tmp/opencode-cleanup/` 出现 DB 会话清理产物 |
| 此后 | 所有任务报 `missing required Authorization header`，runtime 无法获取 Copilot token |

## 2 排除项

| 怀疑方向 | 排查结论 |
|---|---|
| model id 错误 | ❌ `opencode.json` 中 provider 配置正常，请求已发到 GitHub Copilot 接口 |
| provider 实现损坏 | ❌ 10:03 时点仍正常工作 |
| runtime 读错目录/环境变量 | ❌ 进程 HOME/PWD 正常，无 OPENCODE_* 覆盖 |
| cleanup 脚本误删 | ❌ `scripts/opencode-cleanup.sh` 只处理 snapshot 和 DB，不碰 auth.json |

## 3 根因确认

**`auth.json` 被外部操作清空。**

### OpenCode Auth 机制（源码逆向）

```
~/.local/share/opencode/auth.json
{
  "github-copilot": {
    "type": "oauth",
    "refresh": "gho_xxx",
    "access": "gho_xxx",
    "expires": 0
  }
}
```

- `Auth.set(key, info)` — 写入/更新某个 provider 的凭据，整体 JSON.stringify 后 writeFile。
- `Auth.remove(key)` — 从对象中 `delete data[key]`，再 writeFile。若仅有一个 key，文件变为 `{}`。
- `Auth.remove` **仅**被 `opencode auth logout`（交互式 TUI）和 `opencode providers logout` 调用。
- OpenCode **不会在 token 刷新失败时自动清除凭据**——401/403 仅触发重试，不触发 remove。

### 最可能原因

1. 有人在同一时间窗口执行了 `opencode auth logout` 或 `opencode providers logout`。
2. 某段调试脚本直接写了空对象到 auth.json。
3. 某个自动化清理流程意外覆盖了凭据文件。

## 4 防护措施

### 4.1 自动备份（BFF 层）

`control-plane/web-ui-bff/src/lib/opencode-config.ts` 的 `diagnoseModelReadiness()` 函数中：

- **凭据有效时**：自动将 `auth.json` copy 到 `auth.json.bak`，静默执行、不影响正常流程。
- **凭据缺失时**：检测 `auth.json.bak` 是否可用，若可恢复则在 `recoverySuggestions` 中优先提示恢复命令。

### 4.2 巡检脚本增强

`scripts/opencode-health-check.sh` 新增 **Auth Credentials** 检查段：

- auth.json 不存在 → `[CRITICAL]`
- auth.json 为空对象 → `[CRITICAL]`，同时检查 .bak 是否可恢复
- auth.json 有 provider → `[OK]`，并自动更新 .bak 备份

### 4.3 Recovery Suggestion 新增

`runtime-recovery-contract.ts` 新增 `copilotRestoreBackup` suggestion ID，前端 UI 会自动渲染该恢复建议。

## 5 恢复手册

### 场景 A：auth.json 被清空但 .bak 存在

```bash
# 1. 确认备份有效
cat ~/.local/share/opencode/auth.json.bak

# 2. 恢复
cp ~/.local/share/opencode/auth.json.bak ~/.local/share/opencode/auth.json

# 3. 验证
~/.opencode/bin/opencode auth list
# 应显示 1 credential(s)
```

### 场景 B：auth.json 和 .bak 都不可用

```bash
# 重新登录
~/.opencode/bin/opencode auth login

# 验证
~/.opencode/bin/opencode auth list
```

### 场景 C：runtime 正在运行中

恢复凭据文件后，runtime **不需要重启**——OpenCode 每次请求都会重新读取 `auth.json`。

## 6 预防清单

- [ ] **禁止在自动化脚本中执行 `opencode auth logout`**，除非明确意图是注销。
- [ ] 任何涉及 `~/.local/share/opencode/` 目录操作的脚本，应排除 `auth.json`。
- [ ] 定期执行 `bash scripts/opencode-health-check.sh` 检查凭据状态。
- [ ] 生产环境部署时，将 auth.json 的备份纳入运维检查项。
