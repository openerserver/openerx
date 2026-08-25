# V2 实施启动记录

> 状态：`IMPLEMENTATION_BOOTSTRAP_IN_PROGRESS`
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
legacy/              # 旧资产保护说明；本轮不搬迁现有目录
```

该结构来自 [05-platform-and-runtime-contract.md](05-platform-and-runtime-contract.md)。本轮只提交目录说明和空的源码入口，不引入 Electron、React、计费或同步实现依赖。

## 3. 旧资产边界

- 现有 `control-plane/` 保持原路径，继续用于旧控制平面开发、回归和运行验证。
- `opencode-fork/`、`claude-code-main/`、`pi-mono/` 继续保留为受保护参考/运行资产；在 Runtime Spike 完成前不删除、不覆盖、不强行接入新主线。
- `docs/current/` 继续描述旧平台事实；V2 合同和启动记录只放在 `docs/v2/`。
- 本轮不做大规模数据迁移，不修改旧数据库表来模拟 V2 领域模型。

## 4. 后续实现顺序

1. 冻结 Electron + React + Vite 的 ADR 与双平台打包基线。
2. 在 `apps/desktop` 建立 Main / Preload / Renderer 最小可运行骨架。
3. 建立 Conversation / Message 的本地存储与 Fake Runtime 流式闭环。
4. 再进入账户、同步、模型目录、Token 和计费服务。

每一步都必须有独立测试和可回滚提交；未完成的 V2 能力不得通过旧控制平面页面改名冒充完成。

## 5. 本轮验收

- 新主线目录可从仓库根目录直接找到。
- 旧控制平面路径和工作方式不变。
- 文档导航能从 `docs/README.md` 进入 V2 启动记录。
- `git diff --check` 通过。
