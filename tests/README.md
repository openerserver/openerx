# 测试目录约定

仓库内的自动化测试统一放在根目录 tests 下，不再分散到各子包自己的 tests 或 src 目录。

当前结构：

- service：Control Plane 服务端 Bun 测试
- web-ui-bff：BFF Bun 测试
- web-ui：前端 Vitest 测试

约定：

- 新增测试时，优先放到对应子目录下。
- 运行测试仍通过各子包脚本或根目录聚合脚本触发，不直接把测试源码放回业务源码目录。
- 前端单文件测试从根目录触发时，使用 bun run test:ui:file -- ../../tests/web-ui/Settings.test.ts 这类入口，让测试在 control-plane/web-ui 的 Vitest 上下文中执行。
- Phase 2 实时链路回归可直接运行 bun run test:bff:realtime-regression；它会顺序执行 BFF 侧 realtime 单测、completion-sync 集成和 hooks 集成，避免 Bun 跨文件 mock 串扰。
- 付费执行治理相关的强 mock BFF 回归可直接运行 bun run test:bff:paid-execution-regression；它会按单文件顺序执行 lifecycle hooks、realtime pipeline、project preflight、integration guard 与 judge usage 几组用例，避免 Bun 在同一进程里复用模块 mock 导致串扰。
- BFF 默认全量测试 bun run test:bff 或 bun run test:all 不包含 RUN_EXECUTION_INTEGRATION 门控的真实执行集成用例；这些用例依赖运行中的 runtime、BFF、鉴权和可达模型，不适合并入默认快速回归。
- 如需运行完整的 BFF 执行集成通道，使用 bun run test:bff:execution-integration；它会顺序执行 identity execute、completion sync、hooks integration、workflow evaluation 四组真实执行用例。
- 如需只跑某一组真实执行用例，可在 control-plane/web-ui-bff 下分别运行 bun run test:integration:identity-execute、bun run test:integration:completion-sync、bun run test:integration:hooks、bun run test:integration:workflow-evaluation。
- 这组真实执行用例默认只要求 RUN_EXECUTION_INTEGRATION=1，并会统一从设置页的测试模型策略读取受控模型；当前强制允许的测试模型只有 github-copilot:gpt-5-mini 和 github-copilot:gpt-4o。
- 如需手动切回付费模型验证 paid guard 路径，才需要额外显式设置 ALLOW_PAID_MODEL_EXECUTION=1，并满足对应租约或审批要求；否则 BFF 会在创建 runtime session 前直接拒绝。
- 这类执行集成用例已改为在建任务时优先选择可用的 GitHub Copilot 模型，避免回落到本地 runtime 默认模型后因为 provider 不可达而误报失败。
- Chat Settings 回归分组可直接运行 bun run test:chat-settings:regression；它会顺序执行 BFF chat/apply 集成测试和前端 ChatSettings 页面回归。
- 浏览器级 Chat Settings 管理员回归可运行 bun run test:e2e:chat-settings；该用例通过 Playwright 覆盖登录、侧边栏导航、发送按钮和应用按钮，并在浏览器层 mock API，适合纳入 CI。
- 受控 live backend 浏览器回归可运行 bun run test:e2e:live-controlled；当前先收录 runtime burst 状态链路验证，要求本地已有可用的 runtime、service、BFF，并通过 dev-only realtime 注入端点把 session.status 送入同一条 BFF/WS/UI 管道，确认 Task Detail 能看到 warning、paused-approval 与 cooldown。
- 如需单独跑 runtime burst 这条 live 用例，可继续使用 bun run test:e2e:runtime-burst；它当前只是上述受控 live 回归分组的别名。
- 如需一次跑完整的 Chat Settings CI 过滤组，使用 bun run test:chat-settings:ci。
- 根目录可用 bun run typecheck 做三端类型检查，bun run check:all 做 lint、类型检查和默认测试全量校验。
- 如需共享测试工具，优先在 tests 下新增公共辅助文件，而不是放进业务模块。
