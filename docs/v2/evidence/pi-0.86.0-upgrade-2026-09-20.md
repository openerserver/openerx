# Pi 0.86.0 配对升级验证（2026-09-20）

- 日期：2026-09-20，Asia/Shanghai。
- 范围：openerx 与 UWA（`openerx-advanced/core`）的内置 Pi 依赖，从 0.84.4 升级到 0.86.0。
- 状态：源码、依赖安装、开发构建和本地 Electron 行为验证通过；没有生成安装包、替换已安装应用或发布远程 Runtime。
- 上游：[v0.86.0](https://github.com/earendil-works/pi/releases/tag/v0.86.0)，提交 `ecac0a9c4edad3dac5d9f8b40e0c7db7a56471fc`。npm 发布时间为 2026-09-20 07:14:16（北京时间）。官方版本为 `0.86.0`，npm 没有本次请求中提到的 `0.8.6`。

## 变更

1. 两版根工作区、Desktop、Pi Host 的直接依赖精确锁定到 0.86.0。更新 openerx npm/pnpm 锁、UWA npm/pnpm 锁，以及 core 独立 npm 锁。三个 npm 锁中的 8 个 Pi/chord 运行时节点均为 0.86.0。
2. 适配上游 `TranscriptContext`：Pi Host 使用 `getCurrentSystemPrompt()` 和 `getCurrentTools()` 重放系统消息中的提示词、命名段落和工具增删，然后转换为现有网关的独立 prompt/tools 字段。去掉已重放的系统消息后，执行路径脱敏和请求去重散列；原始 Pi 会话不被修改。
3. 工具参数通过 JSON 序列化结果交给 Pi，满足新版 JSON-compatible 参数约束。更新直接调用 Provider 的测试和桌面夹具，明确区分系统消息与用户/助手对话计数。
4. 新 Run 元数据记录 0.86.0；历史 Run fixture 保留原版本，验证历史读取兼容性。当前架构说明随依赖更新，2026-08-30 的历史升级证据保留。
5. 共用桌面回归加入平台 Provider、BYOK、会话恢复和十轮聊天 Golden。新增的 Provider 回归覆盖系统段落替换/移除、工具替换/全部移除、路径脱敏、输入不变性和去重键变化。
6. 保留 UWA 品牌 Provider 文案、合成 BYOK 测试扩展、手机就绪探测测试、中央账号扩展及 `OpenerX-Enterprise` 数据目录。

## 验证结果

验证使用 Node 24.19.0、npm 11.3.0，macOS arm64 / Electron 44.0.0。

| 检查 | openerx | UWA |
| --- | --- | --- |
| Pi Host 全包（含实际 `VERSION === "0.86.0"`） | 17 files / 75 tests PASS | 17 files / 75 tests PASS |
| `test:desktop-common` 桌面部分 | 29 files / 332 tests PASS | 30 files / 347 tests PASS |
| `test:desktop-common` 共用服务和 Pi 部分 | 23 files / 194 tests PASS | 23 files / 194 tests PASS |
| 全工作区 TypeScript | `typecheck:v2` PASS | `typecheck` PASS |
| `npm run dev:desktop` | 主进程、Pi Host、App Service、Remote Host 构建并启动 PASS | 品牌及中央账号扩展构建并启动 PASS |
| Electron `e2e-chat.mjs` | PASS | PASS |

Electron E2E 使用临时测试数据目录和 Pi faux Provider，不调用付费模型，覆盖新会话、流式响应、上下文、停止、服务崩溃恢复、分支、重启、Markdown 和搜索，输出均为：

```text
E2E_CHAT_OK new-stream-context-stop-crash-branch-restart-markdown-search
```

其他验证：

- openerx V2 boundary：493 个源码文件通过；release graph：337 个生产文件、18 个 Pi import 仅位于 Pi Host、48 个 workspace edge。
- openerx 十轮聊天 Golden 和历史 Storage 用例：3 files / 21 tests PASS。
- 两版定向格式检查及 `git diff --check` 通过。
- UWA parity 对当前 openerx checkout 校验通过：459 shared files、121 reviewed overlays；逐项复核改动后更新基线，未增加或删除 edition overlay。
- 开发启动使用 `OPENERX_NODE_INCLUDE_DIR=/opt/homebrew/include/node`，为独立 Node 运行时指定本机已有 Node-API 头文件。开发服务保留在 5173（openerx）和 5174（UWA）。

## Git 检查点与边界

- 升级前：openerx `efc624f`；UWA core `5c17e5cc`；UWA 外层 `3585d71`。开始时三个工作区均干净。
- 升级代码：openerx `c6d1d7a`；UWA core `7bc5a7ef`；UWA 外层及 parity `3e1d08b`。
- 本地分支：`codex/pi-0.86.0-20260920`；没有 push 或发布。
- 本次结论限于内置依赖和本地开发运行时。没有验证付费模型真实网络请求、签名安装包、跨平台发行或远程 Runtime 更新。
