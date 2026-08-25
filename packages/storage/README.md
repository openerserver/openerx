# Storage

M1 本地事实源：负责有序 SQLite 迁移、对话、分支、消息、文本 Part、可重放事件和命令幂等记录。
Runtime 会话不会被当作对话历史持久化。
