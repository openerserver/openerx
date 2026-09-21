# 构建与发布

## 本地构建

在仓库根目录执行，先退出正在使用目标输出目录的应用：

```sh
npm ci
npm run check:local
npm run package:v2
npm run make --workspace @openerx/desktop
```

`package:v2` 生成应用包，`make` 生成对应平台的分发产物。输出固定在 `apps/desktop/out/`。开发调试使用 `npm run dev:desktop`；不要为每次调试复制应用包或整个用户配置目录。

## 验证

发布前运行公开文件检查、边界检查、类型检查、相关单元和集成测试，并在目标平台运行桌面端到端测试。应用包还需检查 Electron fuses、产物内容与原生签名：

```sh
npm run test:e2e:v2
npm run verify:package:v2
npm run verify:release-artifacts --workspace @openerx/desktop
npm run verify:native-signature --workspace @openerx/desktop
```

本地通过不自动表示其他操作系统、签名安装、升级回滚或商店分发已经通过。项目目录、权限重连、同步冲突及远程执行也应在发布环境验证。

## 本地签名与上传发布

GitHub 仅托管源码和上传的 Release 文件，不运行检查或构建；自动 CI 和手动发布工作流均已移除，仓库 Actions 已停用。Windows 安装包及端到端测试需要本地 Windows 机器或 Windows 虚拟机；macOS 包在对应架构的 Mac 环境构建并验证。不要将 Mac 的检查结果当作 Windows 验证结果。

证书、签名密码、更新公钥配置及公证凭据由本地发布环境提供，不能写入源码。正式通道先运行 `npm run release:gate:v2`，完成所要求的外部验收与发布批准。签名和公证完成后，在本地验证分发文件、校验值与更新清单，再由维护者上传 GitHub Release。发布说明记录源码提交、平台、架构、签名状态及验证结果；上传文件不会触发云端检查。

## 验证数据

可执行回归、Golden 任务定义与必要的结构化样例位于 `tests/`。`tests/v2/golden/regression-map.json` 指向实际回归入口，不代表这些测试已在某次发布中运行成功。

新生成的报告与截图写入忽略的 `artifacts/`。公开仓库保留源码与必要测试夹具，不保存按任务积累的报告或演示文件。归档构建日志时应脱敏，并记录实际执行的平台和提交。
