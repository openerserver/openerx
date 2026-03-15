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
- BFF 默认全量测试 bun run test:bff 或 bun run test:all 不包含 RUN_EXECUTION_INTEGRATION 门控的真实执行集成用例；这些用例依赖运行中的 runtime、BFF、鉴权和可达模型，不适合并入默认快速回归。
- 如需运行完整的 BFF 执行集成通道，使用 bun run test:bff:execution-integration；它会顺序执行 identity execute、completion sync、hooks integration、workflow evaluation 四组真实执行用例。
- 如需只跑某一组真实执行用例，可在 control-plane/web-ui-bff 下分别运行 bun run test:integration:identity-execute、bun run test:integration:completion-sync、bun run test:integration:hooks、bun run test:integration:workflow-evaluation。
- 这类执行集成用例已改为在建任务时优先选择可用的 GitHub Copilot 模型，避免回落到本地 runtime 默认模型后因为 provider 不可达而误报失败。
- Chat Settings 回归分组可直接运行 bun run test:chat-settings:regression；它会顺序执行 BFF chat/apply 集成测试和前端 ChatSettings 页面回归。
- 浏览器级 Chat Settings 管理员回归可运行 bun run test:e2e:chat-settings；该用例通过 Playwright 覆盖登录、侧边栏导航、发送按钮和应用按钮，并在浏览器层 mock API，适合纳入 CI。
- 如需一次跑完整的 Chat Settings CI 过滤组，使用 bun run test:chat-settings:ci。
- 根目录可用 bun run typecheck 做三端类型检查，bun run check:all 做 lint、类型检查和默认测试全量校验。
- 如需共享测试工具，优先在 tests 下新增公共辅助文件，而不是放进业务模块。
