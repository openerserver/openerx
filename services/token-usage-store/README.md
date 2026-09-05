# Token Usage Store

统一记录 UsageRecord、模型选择、实际模型和可获得 Token 字段的服务边界。

M2 Account Alpha 使用稳定 `dedupeKey` 去重，并按消息、对话和账户聚合。每个 Token 分类
分别返回已知合计与未知记录数；未知字段不会被转换成 0。
