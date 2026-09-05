# 单安装包 / BYOK 默认部署合同

当前 Windows 桌面安装包默认使用 `byok` 模式。首次启动不访问 OpenERX 模型服务，也不要求登录；
用户必须在“设置 → 模型”中配置自己的 OpenAI-compatible API 地址、API Key 和模型 ID，测试连接并
保存后才能发送消息。

## 默认行为

- 模型执行：本机直接连接用户配置的 OpenAI-compatible `/chat/completions` API；
- Web Search：默认使用本机 App Service 的 `openerx_web_search`；
- 凭证：API Key 只写入操作系统保护的本地凭证库，不写入普通 JSON 配置；
- 服务端：默认路径不读取平台模型目录、不获取平台授权，也不依赖 OpenERX 服务器；
- 未配置：模型显示为不可用，新任务发送按钮保持禁用并引导用户配置 API；
- 删除密钥：保持 BYOK 模式，不自动切换到托管服务。

默认表单预填 DeepSeek API 地址和 `deepseek-v4-flash` 模型 ID，但用户可替换为任意支持
Chat Completions 与所声明工具能力的 OpenAI-compatible API。安装包不内置 API Key。

## 可选托管模式

托管服务模式保留为显式选项，只适用于另行部署了 OpenERX 平台端点的环境。选择托管模式属于用户
主动配置；它不是单安装包的默认路径。

本合同取代早期 V1 文档中“客户端不提供 BYOK”的历史限制；旧文档保留用于说明当时的产品边界。
