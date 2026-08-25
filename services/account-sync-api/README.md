# Account Sync API

个人账户范围的云同步、revision、游标、冲突和删除墓碑服务边界。

M2 Account Alpha 实现账户隔离的 SQLite 云真值、幂等操作、单调游标、显式冲突与保留期墓碑。
同步 Schema 会递归拒绝凭证、Cookie、绝对路径、权限 Grant 和 Pi Session 等设备私有字段。
