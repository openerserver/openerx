# 模型目录核对与更新（2026-09-21，Asia/Shanghai）

范围：openerx 与 UWA 的全部 6 家内置 BYOK 厂商。按用户要求用腾讯混元替换百度千帆，共 22 个预设（保留其余 11 个旧引用，新增 11 个）。旧百度配置仍可读取，但不再提供百度预设，也不会把百度密钥转给腾讯。

## 官方核对结果

| 厂商 | 更新 | 官方依据 |
| --- | --- | --- |
| DeepSeek | `deepseek-flash` 当前对应 V4.1 Flash，支持图片；Pro 别名当前对应 V4-Pro-0813。旧 vision 引用改用当前 `deepseek-flash`，显示兼容入口。 | [模型与价格](https://api-docs.deepseek.com/quick_start/pricing/) |
| 通义千问 | 新增 `qwen3.8-flash`，1,000,000 上下文、131,072 输出、图片输入。保留 Qwen 3.8 Max、3.7 Plus、3.7 Flash。 | [模型目录](https://help.aliyun.com/zh/model-studio/text-generation-model)、[3.8 Flash 参数](https://help.aliyun.com/zh/model-studio/qwen3-8-flash) |
| Kimi | 新增 `kimi-k3`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`，保留 K2.6；均支持图片。K3 上下文 1,048,576、预设输出 131,072；K2.7 上下文 262,144。 | [模型列表](https://platform.kimi.com/docs/models)、[参数约束](https://platform.kimi.com/docs/api/models-overview)、[输出参数](https://platform.kimi.com/docs/api/chat) |
| 智谱 | 新增 `glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`，1M 上下文、128K 输出；5.3 仅文本，Flash/FlashX 支持图片。保留 5.2、5。 | [GLM-5.3](https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md)、[Flash/FlashX](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md) |
| 豆包 | 新增 `doubao-seed-2-1-pro-260915`（1M 上下文）、`doubao-seed-2-0-lite-260428`。保留原有 260628 Pro 与 260215 Lite 的引用和版本。 | [官方模型发布记录](https://docs.volcengine.com/docs/ark/model-release-announcement?lang=zh) |
| 腾讯混元 | 新增 `hy4-preview`（1M 上下文、64K 输出）与 `hy3`（256K 上下文、128K 输出），文本输入、工具调用、思考。使用广州 TokenHub 的 `https://tokenhub.tencentmaas.com/v1` 及其 API Key。 | [模型列表](https://intl.cloud.tencent.com/zh/document/product/1300/78934)、[调用入口](https://cloud.tencent.com/document/product/1823/130078)、[思考参数](https://cloud.tencent.com/document/product/1823/131208)、[Chat API](https://cloud.tencent.com/document/product/1823/135872) |

输出预设是客户端单次请求上限，不一律等于厂商硬上限。K3 使用官方默认 131,072；K2.7 沿用 K2.6 的保守 32,768；豆包发布公告确认新版本和上下文，但未列出新版输出上限，因此继续采用已有 Pro 65,536、Lite 32,768 的保守请求上限。

## 接入行为

- GLM-5.3 系列、Kimi K3 的模型选择器仅显示 `low/high/max`；运行时兼容旧会话与后台任务传入的关闭/标准档位，转换为允许的档位，确保 `max` 不被底层 SDK 降为 `high`。
- GLM-5.3 明确启用思考；Kimi K3 使用 `reasoning_effort` 和 `max_completion_tokens`，不发送 K2 专用的 `thinking`。
- Kimi K2.7 Code 始终思考，不发送禁用思考或不支持的 `reasoning_effort`；K2.7/K3 不覆盖厂商固定温度，并保留多轮消息的 reasoning content。
- 腾讯 Hy4 Preview 支持关闭/高强度，Hy3 支持关闭/低/高；请求显式设置 `thinking.type`，思考开启时传入相应 `reasoning_effort`，多轮消息保留 reasoning content。
- 连接探测对上述新模型保留 1,024 token 的思考空间，避免旧的 32 token 探测过早截断。
- 厂商特例同时匹配模型 ID 和官方主机，不把同名自定义网关当作官方服务。
- UWA 保留品牌、中央账户扩展、OpenerX-Enterprise 数据目录及专有回归用例。

## 验证记录

- openerx 公共桌面回归：59 个测试文件、615 条测试通过。
- UWA 公共桌面回归（包含其专有用例）：61 个测试文件、634 条测试通过。
- 两版桌面与 Pi Host TypeScript 检查通过；测试覆盖预设解析、旧配置读取、新模型请求参数、多轮思考内容、最高思考档位和模型设置界面。
- UWA 检查使用 `/opt/homebrew/bin/node`（24.2.0）；该目录默认 shell 的旧 Node 18 无法运行当前依赖。

未调用真实付费模型接口；官方目录核对与模拟请求验证不能替代账户权限/额度下的真实 API 可用性验证。本轮不打包、不替换已安装应用。
