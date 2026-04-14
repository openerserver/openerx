# 测试目录约定

仓库内的自动化测试统一放在根目录 tests 下，不再分散到各子包自己的 tests 或 src 目录。

当前结构：

- service：Control Plane 服务端 Bun 测试
- web-ui-bff：BFF Bun 测试
- web-ui：前端 Vitest 测试

约定：

- 新增测试时，优先放到对应子目录下。
- 运行测试仍通过各子包脚本或根目录聚合脚本触发，不直接把测试源码放回业务源码目录。
- 前端单文件测试从根目录触发时，使用 bun run test:ui:file -- tests/web-ui/Settings.test.ts 这类入口，让测试在 control-plane/web-ui 的 Vitest 上下文中执行。
- 不要直接运行 bun test tests/web-ui/...；那会调用 Bun 原生测试器，而不是 web-ui 的 Vitest，上下文和模块解析都可能不一致。
- test:ui:file 兼容旧写法 ../../tests/web-ui/...，但新命令统一使用根目录相对路径 tests/web-ui/....
- Phase 2 实时链路回归可直接运行 bun run test:bff:realtime-regression；它会顺序执行 BFF 侧 realtime 单测、completion-sync 集成和 hooks 集成，避免 Bun 跨文件 mock 串扰。
- 付费执行治理相关的强 mock BFF 回归可直接运行 bun run test:bff:paid-execution-regression；它会按单文件顺序执行 lifecycle hooks、realtime pipeline、project preflight、integration guard 与 judge usage 几组用例，避免 Bun 在同一进程里复用模块 mock 导致串扰。
- BFF 默认全量测试 bun run test:bff 或 bun run test:all 会按单文件顺序执行 tests/web-ui-bff 下的 Bun 测试，避免跨文件 mock 串扰和 Bun 并发导致的 137 假性卡死；它仍不包含 RUN_EXECUTION_INTEGRATION 门控的真实执行集成用例。
- 如需运行完整的 BFF 执行集成通道，使用 bun run test:bff:execution-integration；它会顺序执行 identity execute、completion sync、hooks integration、workflow evaluation 四组真实执行用例。
- 如需只跑某一组真实执行用例，可在 control-plane/web-ui-bff 下分别运行 bun run test:integration:identity-execute、bun run test:integration:completion-sync、bun run test:integration:hooks、bun run test:integration:workflow-evaluation。
- 这组真实执行用例默认只要求 RUN_EXECUTION_INTEGRATION=1，并会统一从设置页的测试模型策略读取受控模型；当前强制允许的测试模型只有 github-copilot:gpt-5-mini 和 github-copilot:gpt-4o。
- 不再使用额外的 ALLOW_PAID_MODEL_EXECUTION 测试门控；付费执行降级/拦截路径统一通过强 mock 的 fund/guard 回归覆盖，真实执行集成只验证受控模型下的链路可用性。
- 这类执行集成用例已改为在建任务时优先选择可用的 GitHub Copilot 模型，避免回落到本地 runtime 默认模型后因为 provider 不可达而误报失败。
- Chat Settings 回归分组可直接运行 bun run test:chat-settings:regression；它会顺序执行 BFF chat/apply 集成测试和前端 ChatSettings 页面回归。
- 浏览器级 Chat Settings 管理员回归可运行 bun run test:e2e:chat-settings；该用例通过 Playwright 覆盖登录、侧边栏导航、发送按钮和应用按钮，并在浏览器层 mock API，适合纳入 CI。
- 受控 live backend 浏览器回归可运行 bun run test:e2e:live-controlled；当前先收录 runtime burst 状态链路验证，要求本地已有可用的 runtime、service、BFF，并通过 dev-only realtime 注入端点把 session.status 送入同一条 BFF/WS/UI 管道，确认 Task Detail 能看到 warning、paused-approval 与 cooldown。
- 如需单独跑 runtime burst 这条 live 用例，可继续使用 bun run test:e2e:runtime-burst；它当前只是上述受控 live 回归分组的别名。
- 如需一次跑完整的 Chat Settings CI 过滤组，使用 bun run test:chat-settings:ci。
- 根目录可用 bun run typecheck 做三端类型检查，bun run check:all 做 lint、类型检查和默认测试全量校验。
- 如需共享测试工具，优先在 tests 下新增公共辅助文件，而不是放进业务模块。

命名约定：

- `execution-trace-contract` 只用于 task/project 两条公开 execution trace route 的 contract 测试与 helper；它关注 projection-first、restricted secondary source、显式 incomplete，以及“不触碰 prompt backfill / public trace fallback”这类公开读面语义。
- `session-message-compatibility` 只用于非公开 session consumer 的 contract 测试与 helper；它关注 lineage messages、cached messages、runtime session message fallback，以及“不得误触公开 execution trace route”这类兼容读面语义。
- 若某个测试主体是 branch lineage、session preview、runtime pipeline、reconcile、adapter finalization 这类内部/非公开读面，应优先复用 `tests/web-ui-bff/session-message-compatibility-test-helpers.ts`，而不是引用 `execution-trace-contract` 术语。
- 若某个测试主体是 task/project 的 `/execution-trace` 或其公开聚合响应，应优先复用 `tests/web-ui-bff/execution-trace-contract-test-helpers.ts`，不要把它命名成 session compatibility。
- `realtime-pipeline-events.test.ts` 这类 realtime 测试可以局部包含非公开 session consumer 断言，例如 completion/finalization 读取 session messages；这类场景可以接入 `session-message-compatibility` helper，但文件整体仍应以 realtime/event emitter 语义命名。
- `realtime-routes.test.ts` 这类 dev 注入、订阅、SSE 路由测试，如果只验证事件注入、鉴权、订阅注册，不读取 session messages 或公开 trace，就不应为了“统一术语”强行接入上述两套 contract helper。

Service 集成测试 teardown checklist：

- 当前 task-domain service 收口默认直接跑 [scripts/run-service-task-domain-current-batch.sh](scripts/run-service-task-domain-current-batch.sh)；它会按单文件顺序覆盖 route/projection、project-tree storage、session/message canonical write、message projector 与 role workflow storage，避免 `bun test fileA fileB ...` 触发 Bun 的跨文件 mock/模块污染假失败。
- 路由或投影侧重构如果会触碰 project-tree / session-first 读链，默认把 [tests/service/project-tree-routes.test.ts](tests/service/project-tree-routes.test.ts) 当成回归门禁；当前它也已纳入 [scripts/run-service-task-domain-current-batch.sh](scripts/run-service-task-domain-current-batch.sh) 的顺序批次里。
- 只要测试会写入 tasks、project_tree_nodes 或 branch/session 兼容节点，就不要只写最短 cleanup；新增测试前先对照已有高覆盖样例：[tests/service/project-tree-routes.test.ts](tests/service/project-tree-routes.test.ts)、[tests/service/tree-task-aggregations.test.ts](tests/service/tree-task-aggregations.test.ts)、[tests/service/task-route-registration-smoke.test.ts](tests/service/task-route-registration-smoke.test.ts)。
- 删除顺序先清 task 从属表，再删 tasks，再删 tree nodes。最低限度先确认是否需要先删 task_domain_events、task_snapshots、task_timeline_views；如果任务还会写 conversation、task runs、workflow、ledger、audit、code_changes，也要先删这些下游表，再删 tasks。
- 若测试维护的是 task id 列表，并且 project_tree_nodes.id 与 task id 一致，仍然建议在删 project_tree_nodes 之前补一条按 tree_node_id 删除 tasks 的兜底语句，避免残留引用让 node 删除触发 FK。
- 若测试维护的是 createdNodeIds 一类独立 node 集合，或会额外创建 root/context/session/branch 节点，必须在删 project_tree_nodes 之前按整组 node ids 再扫一遍引用表；当前至少要覆盖 tasks.tree_node_id，若这组节点包含 session/branch 节点，还要覆盖 conversation_sessions.tree_node_id。
- 若 teardown 里会删 repository_credentials、workflow templates、project roots 或其他上游实体，必须放在 tasks 与 project_tree_nodes 清理之后；不要先删 credential 再删 tasks，也不要先删 project 再删它下面的 tree nodes。
- 若 tree cleanup 会改 parent_id、superseded_by、project_tree_links、project_tree_branches 或 descendants 递归删除，按现有测试风格保留这些结构清理，但不要把它们当成 task 引用清理的替代；它们解决的是树结构约束，不是 tasks 或 conversation_sessions 的 FK。
- 新增 service 集成测试时，优先复用 [tests/service/service-teardown-helpers.ts](tests/service/service-teardown-helpers.ts) 里的 building blocks，例如 `buildTaskProjectionCleanupStatements(...)`、`buildTaskNodeDefensiveCleanupStatements(...)` 和 `buildDeleteByIdsStatements(...)`；如果测试里新增了新的 task 下游表，也要同步把那张表加入 teardown 顺序，而不是等 FK 报错后再补。
- 如果 teardown 本身是 statement array、writeDb 或 safeWriteDb 风格，优先复用 [tests/service/service-teardown-helpers.ts](tests/service/service-teardown-helpers.ts) 里的共享 helper，而不是在每个文件里重复拼 task/task-tree cleanup SQL。
