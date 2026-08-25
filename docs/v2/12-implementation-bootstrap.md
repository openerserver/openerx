# V2 实施启动记录

> 状态：`IMPLEMENTATION_BOOTSTRAP_COMPLETE`
>
> 日期：2026-08-25（Asia/Shanghai）
>
> 授权：用户已明确要求“根据 V2 文档开始准备实现”

## 1. 本轮目标

本轮只完成 V2 实施前的仓库整理和可回滚提交，不提前实现业务功能。目标是把新产品主线与旧控制平面放在清晰、可并行演进的目录边界中。

## 2. 新主线目录

```text
apps/
  desktop/
    src/main/       # Electron Main：窗口、生命周期、原生能力编排
    src/preload/    # 类型化安全 Bridge
    src/renderer/   # React + TypeScript + Vite Renderer
  app-service/      # 本地应用服务边界
  runtime-host/     # 受控 Runtime 执行边界
  sync-service/     # 本地同步队列与云同步适配边界
services/
  identity-api/
  account-sync-api/
  model-gateway/
  token-usage-store/
  pricing-service/
  billing-ledger-service/
  payment-adapter/
packages/
  domain/
  contracts/
  runtime-sdk/
  tool-sdk/
  skills/
  ui-react/
  storage/
  observability/
v1-backup/           # 旧代码、配置、测试、文档和本地运行状态
```

该结构来自 [05-platform-and-runtime-contract.md](05-platform-and-runtime-contract.md)。本轮只提交目录说明和空的源码入口，不引入 Electron、React、计费或同步实现依赖。

## 3. 旧资产边界

- 旧 `control-plane/` 已移动到 `v1-backup/control-plane/`，不再进入新主线构建。
- `opencode-fork/`、`claude-code-main/`、`pi-mono/` 已移动到 `v1-backup/`，只作为受保护参考/运行资产。
- 旧文档已移动到 `v1-backup/docs/`；活跃文档只保留在 `docs/v2/`。
- 旧测试、脚本、部署配置、官网和根 workspace 配置均已归档，避免继续误用旧入口。
- 本轮不做大规模数据迁移，不修改旧数据库表来模拟 V2 领域模型。

## 4. 后续实现顺序

1. 冻结 Electron + React + Vite 的 ADR 与双平台打包基线。
2. 在 `apps/desktop` 建立 Main / Preload / Renderer 最小可运行骨架。
3. 建立 Conversation / Message 的本地存储与 Fake Runtime 流式闭环。
4. 再进入账户、同步、模型目录、Token 和计费服务。

每一步都必须有独立测试和可回滚提交；未完成的 V2 能力不得通过旧控制平面页面改名冒充完成。

完整里程碑、依赖、首个两周迭代和完成定义见 [13-development-plan.md](13-development-plan.md)。

## 5. 本轮验收

- 新主线目录可从仓库根目录直接找到。
- 旧系统在 `v1-backup/` 内保持完整相对目录结构和恢复说明。
- 文档导航能从 `docs/README.md` 进入 V2 启动记录。
- `git diff --check` 通过。
