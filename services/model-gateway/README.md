# Model Gateway

平台统一模型目录和模型请求网关边界。V2 客户端不提供 BYOK、自定义 Provider 或本地模型入口。

M2 Account Alpha 冻结版本化模型目录、能力预检、显式降级批准和 UsageRecord 写入。上游执行器
由部署环境注入；仓库中的确定性执行器只存在于测试文件。
