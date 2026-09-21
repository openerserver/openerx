# 模型接入

默认使用 BYOK。进入 **设置 → 模型**，选择厂商，填写该厂商自己的 API Key，测试连接并保存。密钥保存在本机保护的凭证存储中，不随代码分发。删除密钥后仍保持 BYOK 模式。

## 内置目录

目录核对日期：2026-09-21。六家厂商共 22 个预设，定义位于 `packages/contracts/src/model-service.ts`。可用性及额度以各厂商账户为准。

| 厂商 | 主要型号 | 接口与依据 |
| --- | --- | --- |
| DeepSeek | V4.1 Flash、V4 Pro | `https://api.deepseek.com`；[官方模型目录](https://api-docs.deepseek.com/quick_start/pricing/)。 |
| 阿里云百炼 | Qwen 3.8 Max / Flash、3.7 Plus / Flash | `https://dashscope.aliyuncs.com/compatible-mode/v1`；[官方模型目录](https://help.aliyun.com/zh/model-studio/text-generation-model)。 |
| Kimi | K3、K2.7 Code / HighSpeed、K2.6 | `https://api.moonshot.cn/v1`；[官方模型目录](https://platform.kimi.com/docs/models)。 |
| 智谱 | GLM-5.3 / Flash / FlashX、5.2、5 | `https://open.bigmodel.cn/api/paas/v4`；[5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md)、[Flash 系列](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md)。 |
| 火山方舟 | Doubao Seed 2.1 Pro、2.0 Lite 的日期版本 | `https://ark.cn-beijing.volces.com/api/v3`；[官方发布记录](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh)。 |
| 腾讯混元 | Hy4 Preview、Hy3 | `https://tokenhub.tencentmaas.com/v1`；使用广州地域 TokenHub API Key；[官方模型目录](https://intl.cloud.tencent.com/zh/document/product/1300/78934)。 |

DeepSeek Flash 保留一个旧选择记录的兼容入口，两个入口调用同一当前 API 别名。部分厂商保留较早日期版本，以兼容已有选择记录；账户权限或厂商下线仍可能影响可用性。

## 能力与参数

图片输入、工具调用、上下文和输出上限按模型配置。GLM-5.3 系列与 Kimi K3 只提供 low/high/max 思考档位；Kimi K2.7 Code 保持思考开启。腾讯 Hy4 Preview 支持关闭/高，Hy3 支持关闭/低/高。

客户端输出预设并不都等于厂商硬上限。Kimi K2.7 使用保守的 32,768；新版豆包沿用 Pro 65,536、Lite 32,768 的保守请求上限。连接测试用于检查接口和凭据，不能代替完整工具调用或长上下文任务测试。

## 自定义接口

可以在厂商卡片中添加模型 ID，或配置自定义 OpenAI-compatible Chat Completions 地址。填写服务实际提供的模型名称与能力；执行工具任务时必须支持工具调用。自定义网关不因使用相同模型名称就自动继承官方主机的专用参数。

API Key 应来自对应服务商，不应在不同厂商间复用。托管平台模式只适用于另行部署并显式配置的平台端点。
