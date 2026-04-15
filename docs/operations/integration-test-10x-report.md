# 集成测试稳定性报告（10 次连续运行）

> 状态说明：本文记录的是 2026-03 基于外部 OpenCode `:4096` 多进程拓扑的历史集成测试报告，可作为旧链路稳定性基线，不代表今天默认 `pi-mono` runtime backend 的主链验证结果。

**日期**: 2026-03-11  
**测试环境**: macOS, Bun v1.3.6  
**服务配置**:
- OpenCode Runtime: `127.0.0.1:4096`（历史多进程测试拓扑）
- Control-Plane Service: `127.0.0.1:4097`
- BFF: `127.0.0.1:4098`（`OPENCODE_MIN_ACTIVE_BEFORE_PAUSE_MS=500`）

说明：本报告记录的是当时基于多进程拓扑的真实集成测试结果，主要用于回看旧 OpenCode 联调链路的稳定性；如果要理解当前默认 `pi-mono` backend 的实现边界，应优先参考 [runtime/current-implementation-index.md](../runtime/current-implementation-index.md)。数据库主路径现已切到 PostgreSQL，但这组测试对应的 runtime 形态并不是今天的默认主链。

## 测试文件

| 文件 | 说明 |
|------|------|
| `tests/web-ui-bff/identity-binding.test.ts` | 身份绑定 & credential 回退 |
| `tests/web-ui-bff/opencode-completion-sync.test.ts` | OpenCode 完成同步（pause/resume 流程 + 直接执行） |
| `tests/web-ui-bff/hooks-integration.test.ts` | 生命周期钩子集成 |

## 运行命令

```bash
RUN_EXECUTION_INTEGRATION=1 \
OPENCODE_MIN_ACTIVE_BEFORE_PAUSE_MS=500 \
TEST_BFF_URL=http://127.0.0.1:4098 \
bun test \
  tests/web-ui-bff/identity-binding.test.ts \
  tests/web-ui-bff/opencode-completion-sync.test.ts \
  tests/web-ui-bff/hooks-integration.test.ts \
  --timeout 120000
```

## 结果汇总

| 运行次数 | 结果 | 通过 | 失败 | 断言数 | 耗时 (ms) |
|----------|------|------|------|--------|-----------|
| 1 | ✅ PASS | 17 | 0 | 80 | 28,604 |
| 2 | ✅ PASS | 17 | 0 | 80 | 29,609 |
| 3 | ✅ PASS | 17 | 0 | 80 | 26,663 |
| 4 | ✅ PASS | 17 | 0 | 80 | 29,428 |
| 5 | ✅ PASS | 17 | 0 | 80 | 29,431 |
| 6 | ✅ PASS | 17 | 0 | 80 | 27,379 |
| 7 | ✅ PASS | 17 | 0 | 80 | 36,384 |
| 8 | ✅ PASS | 17 | 0 | 80 | 33,226 |
| 9 | ✅ PASS | 17 | 0 | 80 | 34,228 |
| 10 | ✅ PASS | 17 | 0 | 80 | 41,284 |

## 统计

- **通过率**: 10 / 10（100%）
- **总测试用例**: 17 × 10 = 170 次执行，全部通过
- **总断言**: 80 × 10 = 800 次断言，全部通过
- **平均耗时**: 31,624 ms（~31.6 秒）
- **最快**: 26,663 ms（Run 3）
- **最慢**: 41,284 ms（Run 10）
- **中位耗时**: 29,520 ms

## 结论

三个集成测试文件在 10 次连续运行中保持 **100% 稳定通过**，未出现 flaky 行为。耗时波动在 26–41 秒之间，后半段略有增长，可能与当时 OpenCode Runtime 的 session 累积有关，但均在合理范围内。
