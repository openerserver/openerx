# OpenCode Snapshot 运维方案

> 基于 2026-03-11 实际排查结论。当前环境：macOS arm64 / 24GB RAM / Bun 运行时。

---

## 1. 背景与结论

| 项目 | 值 |
|------|------|
| Snapshot 路径 | `~/.local/share/opencode/snapshot/<project-hash>/` |
| 本质 | 内嵌 bare git 仓库，每次工具调用前后各一次 commit |
| 内建清理 | `snapshot.cleanup` 定时器，**每小时**执行 `prune=7.days` |
| 实际风险 | 仓库膨胀后，`git gc` / `git pack-objects` 子进程需将所有 loose objects 加载到内存做 delta 压缩，**线性正比于仓库体积** |

### 已验证的因果链

```
高频会话 → 大量 commits → loose objects 堆积（本次 11GB）
        ↓
每小时 snapshot.cleanup 触发 git gc
        ↓
git pack-objects 加载全部 loose objects 到 RAM
        ↓
RSS 飙升（11GB 仓库 → 1.5~2GB RSS）
```

> **virtual memory（80G+）是 Bun/JSC Gigacage 虚拟地址空间预留，非物理内存，无需关注。**
> 真正需要管控的指标是 **snapshot 目录磁盘占用** 和 **git pack-objects RSS**。

---

## 2. 监控指标

| 指标 | 采集方式 | 阈值 |
|------|---------|------|
| Snapshot 磁盘占用 | `du -sh ~/.local/share/opencode/snapshot/` | **> 2GB 告警，> 5GB 立即清理** |
| opencode RSS | `ps -o rss= -p $(pgrep -f 'opencode serve')` | > 1GB 检查是否有 git 子进程 |
| git pack-objects | `ps aux \| grep pack-objects` | 存在即说明 gc 正在运行 |
| DB 体积 | `du -sh ~/.local/share/opencode/opencode.db` | > 100MB 考虑清理历史会话 |

### 一键巡检脚本

```bash
#!/bin/bash
# opencode-health-check.sh
SNAP_DIR="$HOME/.local/share/opencode/snapshot"
DB="$HOME/.local/share/opencode/opencode.db"

echo "=== Snapshot Disk ==="
du -sh "$SNAP_DIR" 2>/dev/null || echo "(not found)"

echo "=== DB Size ==="
du -sh "$DB" 2>/dev/null || echo "(not found)"

echo "=== Session Count ==="
sqlite3 "$DB" "SELECT count(*) FROM session;" 2>/dev/null

echo "=== opencode Process ==="
ps -o pid,rss,%mem,command -p $(pgrep -f 'opencode serve' 2>/dev/null) 2>/dev/null || echo "(not running)"

echo "=== git pack-objects ==="
pgrep -fl pack-objects 2>/dev/null || echo "(none)"
```

---

## 3. 清理操作

### 3.1 快速清理（删除整个 snapshot 目录）

最安全最快的方式。opencode 重启后会自动重建。代价是丢失所有已有会话的 revert 能力。

```bash
# 1. 停止 opencode
kill $(pgrep -f 'opencode serve')

# 2. 删除 snapshot
rm -rf ~/.local/share/opencode/snapshot

# 3. 重启 opencode
# （通过 VS Code Task 或命令行启动）
```

### 3.2 保守清理（只清历史会话 + vacuum DB）

保留 snapshot 目录，只清理数据库中的低价值会话以减缓膨胀速度。

```bash
DB="$HOME/.local/share/opencode/opencode.db"

# 备份
cp "$DB" "$DB.bak-$(date +%Y%m%d)"

# 删除 7 天前的会话及关联数据
sqlite3 "$DB" <<'SQL'
BEGIN;
DELETE FROM part WHERE messageID IN (
  SELECT id FROM message WHERE sessionID IN (
    SELECT id FROM session WHERE createdAt < datetime('now', '-7 days')
  )
);
DELETE FROM message WHERE sessionID IN (
  SELECT id FROM session WHERE createdAt < datetime('now', '-7 days')
);
DELETE FROM session WHERE createdAt < datetime('now', '-7 days');
COMMIT;
VACUUM;
SQL
```

### 3.3 紧急处理（pack-objects 占用过高时）

```bash
# 直接杀掉 git 子进程，opencode 不会崩溃
pkill -f 'git.*pack-objects'
# 然后执行 3.1 快速清理
```

---

## 4. 日常运维节奏

| 频率 | 动作 |
|------|------|
| **每周** | 运行巡检脚本，关注 snapshot 磁盘占用 |
| **snapshot > 2GB** | 执行 3.2 保守清理 |
| **snapshot > 5GB** | 执行 3.1 快速清理 |
| **内存异常时** | 先 `ps aux \| grep pack-objects`，确认后执行 3.3 |

---

## 5. 不建议做的事

| 操作 | 原因 |
|------|------|
| 设置 `gc.auto 0` 禁用 gc | loose objects 无限堆积，磁盘耗尽比内存飙升更危险 |
| 关注 VSZ / 虚拟内存 | Bun/JSC 预留 32~128GB 虚拟地址空间是正常行为 |
| 自动化定时删除 snapshot | 可能在会话执行中途删除，导致 revert 失败 |
| 频繁 VACUUM DB | 正常使用 DB 增长很慢，跟随清理操作执行即可 |

---

## 6. 参考数据（本次排查）

| 指标 | 清理前 | 清理后 |
|------|--------|--------|
| Snapshot 目录 | 11 GB | 0 → 155 MB（使用数日后） |
| opencode.db | 229 MB | 17 MB → 18 MB |
| 会话数 | 275 | 131 → 143 |
| opencode RSS | 1.5~2 GB（gc 期间） | ~367 MB |
| Apple Footprint | — | 248 MB |
