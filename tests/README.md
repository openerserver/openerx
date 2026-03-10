# 测试目录约定

仓库内的自动化测试统一放在根目录 tests 下，不再分散到各子包自己的 tests 或 src 目录。

当前结构：

- service：Control Plane 服务端 Bun 测试
- web-ui-bff：BFF Bun 测试
- web-ui：前端 Vitest 测试

约定：

- 新增测试时，优先放到对应子目录下。
- 运行测试仍通过各子包脚本或根目录聚合脚本触发，不直接把测试源码放回业务源码目录。
- 根目录可用 bun run typecheck 做三端类型检查，bun run check:all 做 lint、类型检查和默认测试全量校验。
- 如需共享测试工具，优先在 tests 下新增公共辅助文件，而不是放进业务模块。
