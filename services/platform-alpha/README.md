# Platform Alpha composition

M2 的可部署 HTTP 组合层。它只负责把 Identity、Account Sync、Model Gateway 与 Token Usage
服务装配为 `/api/v2` 接口，不持有第二份领域真值。测试执行器与验证码收件箱由测试入口注入。
