# 构建与发布

## 本地构建

在仓库根目录执行，先退出正在使用目标输出目录的应用：

```sh
npm ci
npm run version:check
npm run package:v2
npm run make --workspace @openerx/desktop
```

`package:v2` 生成应用包，`make` 生成对应平台的分发产物。输出固定在 `apps/desktop/out/`。开发调试使用 `npm run dev:desktop`；不要为每次调试复制应用包或整个用户配置目录。

## 验证

发布前运行公开文件检查、边界检查、类型检查、相关单元和集成测试，并在目标平台运行桌面端到端测试。应用包还需检查 Electron fuses、产物内容与原生签名：

```sh
npm run check:public-surface
npm run check:release-graph:v2
npm run check:release:v2
npm run verify:package:v2
npm run verify:release-artifacts --workspace @openerx/desktop
npm run verify:native-signature --workspace @openerx/desktop
```

本地通过不自动表示其他操作系统、签名安装、升级回滚或商店分发已经通过。项目目录、权限重连、同步冲突及远程执行也应在发布环境验证。

## CI 与签名发布

`.github/workflows/v2-ci.yml` 执行源码检查和目标平台打包；`.github/workflows/v2-release.yml` 由维护者手动触发，使用 `production-release` 环境。正式通道的 `release:gate:v2` 保留外部验收与发布批准要求。

证书、签名密码、更新公钥配置及公证凭据由发布环境提供，不能写入源码。签名和公证完成后，验证分发文件、校验值与更新清单，再提升发布通道。

## 验证数据

可执行回归、Golden 任务定义与必要的结构化样例位于 `tests/`。`tests/v2/golden/regression-map.json` 指向实际回归入口，不代表这些测试已在某次发布中运行成功。

新生成的报告与截图写入忽略的 `artifacts/`。公开仓库保留源码与必要测试夹具，不保存按任务积累的报告或演示文件。归档构建日志时应脱敏，并记录实际执行的平台和提交。
